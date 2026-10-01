import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, asrDirectory, asrRoot, asrSources, ensureInstalled, readAsrConfiguration } from "./install.ts";
import type { AsrConfiguration } from "./install.ts";
import { cancelAsr, healthAsr, record, shutdownAsr, transcribeAsr } from "./client.ts";
import type { AsrHealth, AsrReply } from "./client.ts";

export interface AsrRuntime { state: "stopped" | "starting" | "ready" | "busy" | "stopping"; pid: number | null; activeTaskId: string | null }
export interface AsrSession { port: number; token: string; config: AsrConfiguration; health: AsrHealth }
interface OwnedService { child: ChildProcess; session: AsrSession; directory: string; exited: Promise<void>; exitObserved: boolean }
let owned: OwnedService | undefined;
let starting: Promise<AsrSession> | undefined;
let runtime: AsrRuntime = { state: "stopped", pid: null, activeTaskId: null };
export function asrRuntime(): AsrRuntime { return { ...runtime }; }
function onExit(): void { owned?.child.kill("SIGTERM"); }
function onBeforeExit(): void { if (owned && runtime.state === "ready") void stopAsr().catch(() => owned?.child.kill("SIGTERM")); }
process.on("exit", onExit);
process.on("beforeExit", onBeforeExit);

async function terminate(service: OwnedService): Promise<void> {
  if (!service.exitObserved) service.child.kill("SIGTERM");
  const timeout = setTimeout(() => { if (!service.exitObserved) service.child.kill("SIGKILL"); }, 5000);
  try { await service.exited; } finally { clearTimeout(timeout); }
  await rm(service.directory, { recursive: true, force: true });
}
export async function startAsr(signal?: AbortSignal): Promise<AsrSession> {
  signal?.throwIfAborted();
  if (owned && !owned.exitObserved) {
    if (runtime.state === "stopping") throw new DvError("ASR_BUSY", "ASR is stopping.");
    const service = owned;
    const current = await readAsrConfiguration();
    signal?.throwIfAborted();
    if (owned === service && !service.exitObserved) {
      const active = service.session.config;
      const matches = current !== undefined && current.model === active.model
        && current.device === active.device && current.compute === active.compute && current.batchSize === active.batchSize
        && current.cache === active.cache && current.python === active.python
        && current.installationId === active.installationId && current.sourceRevision === active.sourceRevision
        && current.languages.length === active.languages.length && current.languages.every((language) => active.languages.includes(language));
      if (matches) return service.session;
      if (runtime.state === "busy") throw new DvError("ASR_BUSY", "Installation changed while the owned ASR service is busy; cancel its active task first.");
      await stopAsr();
    }
  }
  if (starting) return starting;
  starting = startOwned(signal);
  try { return await starting; } finally { starting = undefined; }
}
async function startOwned(signal?: AbortSignal): Promise<AsrSession> {
  const config = await readAsrConfiguration();
  if (!config) throw new DvError("ASR_INSTALL_REQUIRED", "Local ASR is not installed.", { hint: "Run dsivio-video setup asr." });
  await mkdir(asrRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(asrRoot, "session-"));
  const token = randomBytes(32).toString("base64url");
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, token, { mode: 0o600, flag: "wx" });
  const ready = Promise.withResolvers<number>();
  const exited = Promise.withResolvers<void>();
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[name] !== undefined) environment[name] = process.env[name];
  const log = await open(join(asrDirectory, "service.log"), "a", 0o600);
  let child: ChildProcess;
  try {
    child = spawn(config.python ?? join(asrDirectory, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"), [join(asrSources, "server.py"), "--port", "0", "--model", config.model, "--device", config.device, "--compute", config.compute, "--batch-size", String(config.batchSize), "--cache", config.cache, "--allow-root", directory, "--token-file", tokenFile, "--parent-pid", String(process.pid), "--supervised-stdin"], { stdio: ["pipe", "pipe", log.fd], env: environment });
  } finally { await log.close(); }
  runtime = { state: "starting", pid: child.pid ?? null, activeTaskId: null };
  let buffer = "";
  let service: OwnedService | undefined;
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 64 * 1024) { ready.reject(new DvError("ASR_START_FAILED", "ASR startup output exceeds its limit.")); return; }
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let value: unknown;
      try { value = JSON.parse(line); } catch { continue; }
      if (!record(value) || value.protocol !== ASR_PROTOCOL || value.serviceVersion !== ASR_SERVICE_VERSION || value.pid !== child.pid || !Number.isSafeInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535) continue;
      ready.resolve(Number(value.port));
    }
  });
  child.once("error", (error) => { ready.reject(error); exited.resolve(); });
  child.once("exit", (code, exitSignal) => {
    if (service) service.exitObserved = true;
    if (owned === service || !service && runtime.pid === child.pid) { owned = undefined; runtime = { state: "stopped", pid: null, activeTaskId: null }; }
    ready.reject(new DvError("ASR_START_FAILED", `ASR exited during startup (${code ?? exitSignal}).`));
    exited.resolve();
    void rm(directory, { recursive: true, force: true });
  });
  const startupSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(new DvError(startupSignal.reason?.name === "TimeoutError" ? "ASR_START_FAILED" : "ABORTED", "ASR startup was interrupted.", { cause: startupSignal.reason }));
  startupSignal.addEventListener("abort", abort, { once: true });
  if (startupSignal.aborted) abort();
  try {
    const port = await Promise.race([ready.promise, aborted.promise]);
    const health = await healthAsr(port, config, startupSignal, token);
    startupSignal.throwIfAborted();
    const session: AsrSession = { port, token, config, health };
    service = { child, session, directory, exited: exited.promise, exitObserved: false };
    owned = service;
    runtime = { state: "ready", pid: child.pid ?? null, activeTaskId: null };
    const temporary = join(directory, "run.tmp");
    await writeFile(temporary, JSON.stringify({ pid: child.pid, port, protocol: ASR_PROTOCOL, serviceVersion: ASR_SERVICE_VERSION }) + "\n", { mode: 0o600 });
    await rename(temporary, join(directory, "run.json"));
    // Keep the child supervised without preventing the owner from completing.
    // beforeExit closes the owned child; the Python parent watcher is a backstop.
    child.unref();
    (child.stdout as Socket).unref();
    (child.stdin as Socket).unref();
    return session;
  } catch (error) {
    child.kill("SIGTERM");
    await exited.promise;
    await rm(directory, { recursive: true, force: true });
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_START_FAILED", `Cannot start ASR: ${String(error)}`, { cause: error });
  } finally { startupSignal.removeEventListener("abort", abort); }
}
export async function stopAsr(): Promise<void> {
  const service = owned;
  if (!service) return;
  if (runtime.state === "busy") throw new DvError("ASR_BUSY", `Cancel active transcription ${runtime.activeTaskId} before stopping ASR.`);
  runtime.state = "stopping";
  try { await shutdownAsr(service.session.port, service.session.config, service.session.token); }
  catch (error) { if (!(error instanceof DvError && error.code === "ASR_UNAVAILABLE") && !service.exitObserved) { runtime.state = "ready"; throw error; } }
  await terminate(service);
}
export async function cancelLocalAsr(taskId: string): Promise<{ outcome: "confirmed" | "too-late"; taskId: string }> {
  const service = owned;
  if (!service || runtime.activeTaskId !== taskId) return { outcome: "too-late", taskId };
  try {
    const outcome = await cancelAsr(service.session.port, taskId, service.session.token);
    if (outcome === "too-late") return { outcome, taskId };
  }
  catch (error) { if (!(error instanceof DvError && error.code === "ASR_UNAVAILABLE")) throw error; }
  if (owned === service && !service.exitObserved) runtime.state = "stopping";
  await terminate(service);
  return { outcome: "confirmed", taskId };
}
export async function transcribeLocal(audioPath: string, language: string, signal?: AbortSignal, options: { sampleFrames?: number; timestamps?: "word" | "segment"; taskId?: string; autoInstall?: boolean; model?: string; languages?: string[]; onProgress?: (line: string) => void } = {}): Promise<{ health: AsrHealth; reply: AsrReply }> {
  signal?.throwIfAborted();
  if (!/^[a-z]{2,3}$/.test(language) || ["auto", "und"].includes(language)) throw new DvError("INVALID_INPUT", "ASR requires a lowercase two- or three-letter language code.");
  const requestedModel = options.model ?? "small";
  await ensureInstalled({ model: requestedModel, languages: options.languages ?? ["en", "zh", language], autoInstall: options.autoInstall, onProgress: options.onProgress, signal });
  const session = await startAsr(signal);
  if (session.config.model !== requestedModel || session.health.model !== requestedModel || !session.config.languages.includes(language)) throw new DvError("ASR_CONFIG_MISMATCH", "ASR installation changed after selecting the requested model or language.");
  const service = owned!;
  if (runtime.state !== "ready") throw new DvError("ASR_BUSY", `ASR is processing ${runtime.activeTaskId ?? "another operation"}.`);
  const taskId = options.taskId ?? randomUUID();
  runtime = { state: "busy", pid: service.child.pid ?? null, activeTaskId: taskId };
  const input = join(service.directory, `${randomUUID()}.wav`);
  try {
    const source = await realpath(audioPath);
    const metadata = await stat(source);
    if (!metadata.isFile() || metadata.size > 512 * 1024 * 1024) throw new DvError("INVALID_INPUT", "ASR audio must be a regular WAV file no larger than 512 MiB.");
    await copyFile(source, input);
    signal?.throwIfAborted();
    const result = await transcribeAsr(session.port, session.config, input, language, 600_000, signal, { token: session.token, taskId, sampleFrames: options.sampleFrames, timestamps: options.timestamps });
    const engine = result.reply.engine;
    if (engine?.backend !== "local" || engine.model !== requestedModel || engine.protocol !== session.health.protocol || engine.serviceVersion !== session.health.serviceVersion || engine.whisperxVersion !== session.health.whisperxVersion) throw new DvError("ASR_CONFIG_MISMATCH", "Transcript engine identity differs from the frozen local inference request.");
    return result;
  } catch (error) {
    // Aborting fetch alone cannot confirm cancellation. Stop and await our child.
    if (signal?.aborted || error instanceof DvError && ["ASR_TIMEOUT", "ASR_UNAVAILABLE"].includes(error.code)) await terminate(service);
    if (signal?.aborted) throw new DvError("ABORTED", "ASR inference was cancelled and its owned child exited.", { cause: error });
    if (error instanceof DvError) throw error;
    throw new DvError("INVALID_AUDIO_PATH", `Cannot prepare ASR audio: ${String(error)}`, { cause: error });
  } finally {
    await rm(input, { force: true });
    if (owned === service && !service.exitObserved) runtime = { state: "ready", pid: service.child.pid ?? null, activeTaskId: null };
  }
}
