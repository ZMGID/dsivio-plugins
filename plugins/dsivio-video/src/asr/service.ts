import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DvError } from "../core/errors.ts";
import { asrDirectory, asrPython, asrRoot, asrSources, readAsrConfiguration } from "./install.ts";
import type { AsrConfiguration } from "./install.ts";
import { healthAsr, record, shutdownAsr, transcribeAsr } from "./client.ts";
import type { AsrHealth, AsrReply } from "./client.ts";

interface RunningAsr { pid: number; port: number }
interface StartupOwner { pid: number; startedAt: string }
async function readRunning(): Promise<RunningAsr | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(asrRoot, "run.json"), "utf8"));
    if (!record(value) || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || !Number.isSafeInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535) throw new DvError("ASR_STATE_INVALID", "ASR run.json is invalid.");
    return { pid: Number(value.pid), port: Number(value.port) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_STATE_INVALID", `Cannot read ASR state: ${String(error)}`, { cause: error });
  }
}
async function readStartupOwner(path: string): Promise<StartupOwner | undefined> {
  try {
    const metadata = await stat(path);
    const value: unknown = JSON.parse(await readFile(metadata.isDirectory() ? join(path, "owner.json") : path, "utf8"));
    if (!record(value) || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) throw new DvError("ASR_STATE_INVALID", "ASR startup lock has invalid ownership metadata.", { hint: `Inspect ${path}.` });
    return { pid: Number(value.pid), startedAt: value.startedAt };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_STATE_INVALID", `Cannot read ASR startup ownership: ${String(error)}`, { cause: error });
  }
}
async function acquireStartupLock(path: string, owner: StartupOwner): Promise<void> {
  // Publish complete metadata atomically: an interrupted write never leaves an ownerless lock.
  const temporary = join(asrRoot, `.start-${randomUUID()}.json`);
  await writeFile(temporary, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  try {
    try { await link(temporary, path); return; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    const previous = await readStartupOwner(path);
    if (previous) {
      try { process.kill(previous.pid, 0); throw new DvError("BUSY", "Another process is starting ASR.", { hint: "Retry after its startup finishes." }); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
    } else {
      // Recover ownerless directories left by the earlier implementation, not fresh publications.
      const metadata = await stat(path);
      if (Date.now() - metadata.mtimeMs < 30_000) throw new DvError("BUSY", "An ASR startup lock is being published.", { hint: "Retry after startup finishes." });
    }
    await rm(path, { recursive: true, force: true });
    try { await link(temporary, path); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new DvError("BUSY", "Another process acquired ASR startup ownership.", { cause: error }); throw error; }
  } finally { await rm(temporary, { force: true }); }
}
export async function startAsr(signal?: AbortSignal): Promise<{ port: number; config: AsrConfiguration; health: AsrHealth }> {
  const config = await readAsrConfiguration();
  if (!config) throw new DvError("TRANSCRIBE_UNAVAILABLE", "Neither Dsivio transcription nor a local ASR installation is available.", { hint: "Run dsivio-video setup asr." });
  const existing = await readRunning();
  if (existing) {
    try { return { port: existing.port, config, health: await healthAsr(existing.port, config, signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : undefined) }; }
    catch (error) { if (!(error instanceof DvError) || error.code !== "ASR_UNAVAILABLE") throw error; }
  }
  await mkdir(asrRoot, { recursive: true });
  const lock = join(asrRoot, "start.lock");
  const owner: StartupOwner = { pid: process.pid, startedAt: new Date().toISOString() };
  const controller = new AbortController();
  const interrupt = () => controller.abort(new DvError("ABORTED", "ASR startup was interrupted."));
  const startupSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let child: ChildProcess | undefined;
  let acquired = false;
  try {
    startupSignal.throwIfAborted();
    await acquireStartupLock(lock, owner);
    acquired = true;
    startupSignal.throwIfAborted();
    const socket = createServer();
    const listening = Promise.withResolvers<number>();
    socket.once("error", listening.reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (address === null || typeof address === "string") { listening.reject(new DvError("ASR_START_FAILED", "Cannot allocate a loopback port.")); return; }
      socket.close((error) => error ? listening.reject(error) : listening.resolve(address.port));
    });
    const port = await listening.promise;
    const log = await open(join(asrDirectory, "service.log"), "a", 0o600);
    let spawnError: Error | undefined;
    try {
      startupSignal.throwIfAborted();
      const environment: NodeJS.ProcessEnv = {};
      for (const name of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[name] !== undefined) environment[name] = process.env[name];
      child = spawn(asrPython, [join(asrSources, "server.py"), "--port", String(port), "--model", config.model, "--device", config.device, "--compute", config.compute, "--batch-size", String(config.batchSize), "--cache", config.cache, "--allow-root", tmpdir()], { detached: true, stdio: ["ignore", log.fd, log.fd], env: environment });
      child.once("error", (error) => { spawnError = error; });
      child.unref();
    } finally { await log.close(); }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      startupSignal.throwIfAborted();
      if (spawnError || child.exitCode !== null) throw new DvError("ASR_START_FAILED", `ASR exited during startup: ${spawnError?.message ?? child.exitCode}`, { hint: `See ${join(asrDirectory, "service.log")}.`, cause: spawnError });
      try {
        const health = await healthAsr(port, config, AbortSignal.any([startupSignal, AbortSignal.timeout(1000)]));
        startupSignal.throwIfAborted();
        await writeFile(join(asrRoot, "run.json"), JSON.stringify({ pid: child.pid, port }) + "\n", { mode: 0o600 });
        return { port, config, health };
      } catch (error) { if (startupSignal.aborted || !(error instanceof DvError) || !["ASR_UNAVAILABLE", "ASR_TIMEOUT"].includes(error.code)) throw error; }
      await delay(200, undefined, { signal: startupSignal });
    }
    throw new DvError("ASR_START_FAILED", "ASR did not become ready within two minutes.", { hint: `See ${join(asrDirectory, "service.log")}.` });
  } catch (error) {
    child?.kill();
    if (startupSignal.aborted) throw new DvError("ABORTED", "ASR startup was interrupted.", { cause: error });
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_START_FAILED", `Cannot start ASR: ${String(error)}`, { cause: error });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (acquired) {
      const current = await readStartupOwner(lock);
      if (current?.pid === owner.pid && current.startedAt === owner.startedAt) await rm(lock, { recursive: true, force: true });
    }
  }
}
export async function stopAsr(configuration?: AsrConfiguration): Promise<void> {
  const running = await readRunning();
  if (!running) return;
  try { process.kill(running.pid, 0); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") { await rm(join(asrRoot, "run.json"), { force: true }); return; }
    throw new DvError("ASR_STATE_INVALID", `Cannot verify the recorded ASR process: ${String(error)}`, { cause: error });
  }
  const config = configuration ?? await readAsrConfiguration();
  if (!config) throw new DvError("ASR_STATE_INVALID", "A previous ASR process is still running without this version's installation configuration.", { hint: "Let the previous service finish and exit after its idle timeout, then run dsivio-video setup asr again." });
  try {
    await shutdownAsr(running.port, config);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try { process.kill(running.pid, 0); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") { await rm(join(asrRoot, "run.json"), { force: true }); return; } throw error; }
      await delay(50);
    }
    throw new DvError("ASR_STOP_FAILED", "Idle ASR did not exit within ten seconds.", { hint: "The existing configuration has not been replaced." });
  } catch (error) {
    if (!(error instanceof DvError && error.code === "ASR_UNAVAILABLE")) throw error;
    await rm(join(asrRoot, "run.json"), { force: true });
  }
}
export async function transcribeLocal(audioPath: string, language: string, signal?: AbortSignal): Promise<{ health: AsrHealth; reply: AsrReply }> {
  let temporary: string | undefined;
  try {
    signal?.throwIfAborted();
    let input = await realpath(audioPath);
    const root = await realpath(tmpdir());
    const metadata = await stat(input);
    if (!metadata.isFile() || metadata.size > 512 * 1024 * 1024) throw new DvError("INVALID_INPUT", "ASR audio must be a regular WAV file no larger than 512 MiB.");
    const local = relative(root, input);
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      temporary = await mkdtemp(join(tmpdir(), "dsivio-video-asr-"));
      const staged = join(temporary, "audio.wav");
      await copyFile(input, staged);
      input = staged;
    }
    signal?.throwIfAborted();
    const service = await startAsr(signal);
    return await transcribeAsr(service.port, service.config, input, language, 600_000, signal);
  } catch (error) {
    if (signal?.aborted) throw new DvError("ABORTED", "ASR request was interrupted.", { cause: error });
    if (error instanceof DvError) throw error;
    throw new DvError("INVALID_AUDIO_PATH", `Cannot prepare ASR audio: ${String(error)}`, { cause: error });
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
