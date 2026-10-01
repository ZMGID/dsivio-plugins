import { createHash, randomUUID } from "node:crypto";
import { access, link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DvError } from "../core/errors.ts";
import { locateTool, runTool } from "../tools/index.ts";
import { asrRuntime, stopAsr } from "./service.ts";
import type { AsrRuntime } from "./service.ts";

export const ASR_PROTOCOL = "dsivio-video.asr/1";
export const ASR_SERVICE_VERSION = "0.2.0";
export const WHISPERX_VERSION = "3.8.6";
export const asrRoot = join(homedir(), ".dsivio-video", "asr");
export const asrDirectory = join(asrRoot, ASR_SERVICE_VERSION);
export const asrSources = fileURLToPath(new URL("../../services/asr/", import.meta.url));
export const asrPython = join(asrDirectory, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export interface AsrConfiguration {
  model: string; languages: string[]; device: string; compute: string; batchSize: number; cache: string; serviceVersion: string;
  python?: string; installationId?: string; sourceRevision?: string;
}
export interface AsrStatus {
  ready: boolean; path: string; model?: string; languages?: string[]; serviceVersion: string;
  operationId: string | null; installationId: string | null; state: "notInstalled" | "installing" | "ready" | "failed";
  progress: { stage: string; message: string } | null; error: { code: string; message: string } | null;
  runtime: AsrRuntime;
}
export interface AsrInstallOptions { model?: string; languages?: string[]; onProgress?: (line: string) => void; signal?: AbortSignal }
let operation: { id: string; key: string; controller: AbortController; promise: Promise<AsrStatus>; announced: Promise<void> } | undefined;
const statePath = join(asrRoot, "installation.json");
export async function asrSourceRevision(): Promise<string> {
  const hash = createHash("sha256");
  for (const name of ["server.py", "prepare.py", "requirements.txt"]) { hash.update(name); hash.update(await readFile(join(asrSources, name))); }
  return `sha256:${hash.digest("hex")}`;
}
export async function readAsrConfiguration(): Promise<AsrConfiguration | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(asrDirectory, "config.json"), "utf8"));
    if (typeof value !== "object" || value === null || !("model" in value) || typeof value.model !== "string" || !("languages" in value) || !Array.isArray(value.languages) || value.languages.length === 0 || value.languages.some((item) => typeof item !== "string" || !/^[a-z]{2,3}$/.test(item) || ["auto", "und"].includes(item)) || !("serviceVersion" in value) || value.serviceVersion !== ASR_SERVICE_VERSION || !("device" in value) || value.device !== "cpu" || !("compute" in value) || value.compute !== "int8" || !("batchSize" in value) || value.batchSize !== 8 || !("cache" in value) || typeof value.cache !== "string") throw new DvError("ASR_CONFIG_INVALID", "ASR installation configuration is invalid", { hint: "Run dsivio-video setup asr." });
    const config = value as AsrConfiguration;
    await access(config.python ?? asrPython);
    return config;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_CONFIG_INVALID", `Cannot read ASR installation: ${String(error)}`, { cause: error });
  }
}
async function publishState(state: AsrStatus): Promise<void> {
  const temporary = join(asrRoot, `.status-${randomUUID()}`);
  await writeFile(temporary, JSON.stringify(state) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, statePath);
}
export async function asrStatus(): Promise<AsrStatus> {
  const config = await readAsrConfiguration();
  let saved: Partial<AsrStatus> = {};
  try { saved = JSON.parse(await readFile(statePath, "utf8")) as Partial<AsrStatus>; }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new DvError("ASR_STATE_INVALID", "Cannot read ASR install status.", { cause: error }); }
  return { ready: config !== undefined, path: asrDirectory, serviceVersion: ASR_SERVICE_VERSION, ...(config ? { model: config.model, languages: config.languages } : {}), operationId: saved.operationId ?? null, installationId: config?.installationId ?? null, state: saved.state ?? (config ? "ready" : "notInstalled"), progress: saved.progress ?? null, error: saved.error ?? null, runtime: asrRuntime(), ...(saved.state === "installing" ? { model: saved.model, languages: saved.languages } : {}) };
}
export async function ensureInstalled(options: AsrInstallOptions & { autoInstall?: boolean } = {}): Promise<AsrStatus> {
  const config = await readAsrConfiguration();
  const desired = options.languages ?? ["en", "zh"];
  if (config && config.model === (options.model ?? "small") && desired.every((language) => config.languages.includes(language)) && config.sourceRevision === await asrSourceRevision()) return asrStatus();
  if (options.autoInstall === false) throw new DvError("ASR_INSTALL_REQUIRED", "Local ASR model or language resources need installation.", { hint: "Run dsivio-video setup asr." });
  let status = await installAsr(options);
  const operationId = status.operationId;
  const deadline = Date.now() + 30 * 60_000;
  while (status.state === "installing" || status.operationId !== operationId) {
    if (Date.now() >= deadline) throw new DvError("ASR_INSTALL_TIMEOUT", "ASR install operation did not finish within thirty minutes.");
    await delay(500, undefined, { signal: options.signal });
    const owner = JSON.parse(await readFile(join(asrRoot, "install.lock"), "utf8").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return "{}";
      throw error;
    })) as { pid?: number };
    if (owner.pid) {
      try { process.kill(owner.pid, 0); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") throw new DvError("ASR_INSTALL_FAILED", "ASR install owner exited before completion."); throw error; }
    }
    status = await asrStatus();
  }
  if (status.state !== "ready") throw new DvError(status.error?.code ?? "ASR_INSTALL_FAILED", status.error?.message ?? "ASR installation did not become ready.");
  return status;
}
export async function beginAsrInstall(options: AsrInstallOptions = {}): Promise<AsrStatus> {
  const pending = installAsr(options);
  // Surface any asynchronous failure through the same persisted status.
  void pending.catch(() => undefined);
  await Promise.race([pending, operation?.announced ?? pending]);
  return asrStatus();
}
export async function cancelAsrInstall(operationId: string): Promise<AsrStatus> {
  if (!operation || operation.id !== operationId) throw new DvError("ASR_INSTALL_NOT_OWNED", "This process does not own that install operation.");
  operation.controller.abort(new DvError("ASR_INSTALL_CANCELLED", "ASR installation was cancelled."));
  try { await operation.promise; } catch { /* Persisted failed status is authoritative. */ }
  return asrStatus();
}
export async function installAsr(options: AsrInstallOptions = {}): Promise<AsrStatus> {
  const model = options.model ?? "small";
  const languages = [...new Set(options.languages ?? ["en", "zh"])].sort();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(model)) throw new DvError("CLI_USAGE", "ASR model must be a model name, not a path.");
  if (languages.length === 0 || languages.some((language) => !/^[a-z]{2,3}$/.test(language) || ["auto", "und"].includes(language))) throw new DvError("CLI_USAGE", "ASR languages must be lowercase two- or three-letter codes.");
  if (model.endsWith(".en") && languages.some((language) => language !== "en")) throw new DvError("CLI_USAGE", "English-only ASR models require languages: [en].");
  const key = JSON.stringify([model, languages]);
  if (operation) {
    if (operation.key !== key) throw new DvError("ASR_INSTALL_CONFLICT", "Another configuration is being installed.");
    return operation.promise;
  }
  const id = randomUUID();
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const announced = Promise.withResolvers<void>();
  const promise = installOwned(id, model, languages, { ...options, signal }, announced.resolve).finally(announced.resolve);
  operation = { id, key, controller, promise, announced: announced.promise };
  try { return await promise; } finally { if (operation?.id === id) operation = undefined; }
}
async function installOwned(id: string, model: string, languages: string[], options: AsrInstallOptions, announce: () => void): Promise<AsrStatus> {
  await mkdir(asrRoot, { recursive: true, mode: 0o700 });
  await mkdir(asrDirectory, { recursive: true, mode: 0o700 });
  const lock = join(asrRoot, "install.lock");
  const publication = join(asrRoot, `.install-${id}`);
  const lockValue = { pid: process.pid, operationId: id, model, languages };
  await writeFile(publication, JSON.stringify(lockValue), { mode: 0o600, flag: "wx" });
  let acquired = false;
  let staging: string | undefined;
  let activated = false;
  let status: AsrStatus = { ready: false, path: asrDirectory, operationId: id, installationId: null, serviceVersion: ASR_SERVICE_VERSION, model, languages, state: "installing", progress: null, error: null, runtime: asrRuntime() };
  try {
    try { await link(publication, lock); acquired = true; }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const owner = JSON.parse(await readFile(lock, "utf8")) as typeof lockValue;
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new DvError("ASR_STATE_INVALID", "Invalid ASR install lock owner.");
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (failure) { if (failure instanceof Error && "code" in failure && failure.code === "ESRCH") alive = false; else throw failure; }
      if (alive) {
        if (owner.model !== model || JSON.stringify(owner.languages) !== JSON.stringify(languages)) throw new DvError("ASR_INSTALL_CONFLICT", "Another configuration is being installed.");
        return { ...await asrStatus(), operationId: owner.operationId, state: "installing", model, languages };
      }
      const recovery = join(asrRoot, "install-reclaim.lock");
      try { await link(publication, recovery); }
      catch (failure) {
        if (failure instanceof Error && "code" in failure && failure.code === "EEXIST") throw new DvError("ASR_BUSY", "Another process is recovering interrupted ASR installation ownership.", { hint: `Retry after recovery finishes; inspect ${recovery} if its owner has exited.` });
        throw failure;
      }
      try {
        const current = JSON.parse(await readFile(lock, "utf8")) as typeof lockValue;
        if (current.operationId !== owner.operationId || current.pid !== owner.pid) {
          if (current.model !== model || JSON.stringify(current.languages) !== JSON.stringify(languages)) throw new DvError("ASR_INSTALL_CONFLICT", "Another configuration acquired installation ownership.");
          return { ...await asrStatus(), operationId: current.operationId, state: "installing", model, languages };
        }
        await rm(lock);
        await link(publication, lock); acquired = true;
      } finally { await rm(recovery, { force: true }); }
    }
    options.signal?.throwIfAborted();
    const previous = await readAsrConfiguration();
    const revision = await asrSourceRevision();
    if (previous && previous.model === model && languages.every((language) => previous.languages.includes(language)) && (!previous.sourceRevision || previous.sourceRevision === revision)) {
      if (!previous.sourceRevision) {
        status.progress = { stage: "verification", message: "Verifying existing offline installation" };
        await publishState(status);
        announce();
        await runTool(previous.python ?? asrPython, [join(asrSources, "prepare.py"), "--verify-only", "--model", model, "--languages", ...languages, "--cache", previous.cache], { signal: options.signal, timeoutMs: 30 * 60_000, onStderrLine: options.onProgress });
        previous.sourceRevision = revision;
        previous.installationId = "legacy";
        const temporary = join(asrDirectory, `config-${id}.json`);
        await writeFile(temporary, JSON.stringify(previous) + "\n", { mode: 0o600, flag: "wx" });
        await rename(temporary, join(asrDirectory, "config.json"));
      }
      options.onProgress?.("Reusing installed offline WhisperX model and alignment resources");
      status = { ...status, ready: true, installationId: previous.installationId ?? "legacy", state: "ready", progress: { stage: "reused", message: "Installed model and languages reused without downloads" } };
      await publishState(status);
      announce();
      return { ...status, runtime: asrRuntime() };
    }
    if (asrRuntime().state === "busy") throw new DvError("ASR_BUSY", "Cancel the active ASR task before replacing its installation.");
    await publishState(status);
    announce();
    staging = await mkdtemp(join(asrDirectory, "installation-"));
    const venv = join(staging, "venv");
    const python = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const cache = join(staging, "cache");
    const progress = async (stage: string, message: string): Promise<void> => { status.progress = { stage, message }; await publishState(status); options.onProgress?.(message); };
    const runOptions = { timeoutMs: 30 * 60_000, maxStdoutBytes: 16 * 1024 * 1024, signal: options.signal, onStderrLine: options.onProgress, onStdoutChunk: options.onProgress ? (chunk: Buffer) => options.onProgress!(chunk.toString("utf8").trimEnd()) : undefined };
    await progress("environment", "Creating isolated ASR Python environment");
    await runTool(await locateTool("python"), ["-m", "venv", venv], runOptions);
    await progress("dependencies", "Installing pinned WhisperX dependencies");
    await runTool(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", join(asrSources, "requirements.txt")], runOptions);
    await progress("models", "Preparing ASR, alignment and sentence resources");
    await runTool(python, [join(asrSources, "prepare.py"), "--model", model, "--languages", ...languages, "--cache", cache], runOptions);
    await progress("verification", "Verifying offline inference and every alignment language");
    await runTool(python, [join(asrSources, "prepare.py"), "--verify-only", "--model", model, "--languages", ...languages, "--cache", cache], runOptions);
    options.signal?.throwIfAborted();
    await stopAsr();
    const config: AsrConfiguration = { model, languages, device: "cpu", compute: "int8", batchSize: 8, cache, python, installationId: id, sourceRevision: revision, serviceVersion: ASR_SERVICE_VERSION };
    const temporary = join(asrDirectory, `config-${id}.json`);
    await writeFile(temporary, JSON.stringify(config) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, join(asrDirectory, "config.json"));
    activated = true;
    status = { ...status, ready: true, installationId: id, state: "ready", progress: { stage: "ready", message: "Offline ASR verified" } };
    await publishState(status);
    return { ...status, runtime: asrRuntime() };
  } catch (error) {
    if (acquired) {
      const previous = await readAsrConfiguration();
      status = { ...status, ready: previous !== undefined, installationId: previous?.installationId ?? null, state: "failed", error: { code: options.signal?.aborted ? "ASR_INSTALL_CANCELLED" : error instanceof DvError ? error.code : "ASR_INSTALL_FAILED", message: options.signal?.aborted ? "Installation cancelled; previous environment preserved" : error instanceof Error ? error.message : String(error) } };
      await publishState(status);
    }
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_INSTALL_FAILED", `ASR installation failed: ${String(error)}`, { cause: error });
  } finally {
    if (staging && !activated) await rm(staging, { recursive: true, force: true });
    await rm(publication, { force: true });
    if (acquired) await rm(lock, { force: true });
  }
}
