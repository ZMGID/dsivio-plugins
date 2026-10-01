import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DvError } from "../core/errors.ts";
import { asrDirectory, asrPython, asrRoot, asrSources, readAsrConfiguration } from "./install.ts";
import type { AsrConfiguration } from "./install.ts";
import { healthAsr, record, transcribeAsr } from "./client.ts";
import type { AsrHealth, AsrReply } from "./client.ts";

interface RunningAsr { pid: number; port: number }
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
export async function startAsr(): Promise<{ port: number; config: AsrConfiguration; health: AsrHealth }> {
  const config = await readAsrConfiguration();
  if (!config) throw new DvError("TRANSCRIBE_UNAVAILABLE", "Neither Dsivio transcription nor a local ASR installation is available.", { hint: "Run dsivio-video setup asr." });
  const existing = await readRunning();
  if (existing) {
    try { return { port: existing.port, config, health: await healthAsr(existing.port, config) }; }
    catch (error) {
      if (!(error instanceof DvError) || error.code !== "ASR_UNAVAILABLE") throw error;
    }
  }
  await mkdir(asrRoot, { recursive: true });
  const lock = join(asrRoot, "start.lock");
  try { await mkdir(lock); }
  catch (error) { throw new DvError("BUSY", `Cannot acquire ASR startup lock: ${String(error)}`, { cause: error, hint: "Another process may be starting ASR; retry when it finishes." }); }
  let child: ChildProcess | undefined;
  try {
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
      const environment: NodeJS.ProcessEnv = {};
      for (const name of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[name] !== undefined) environment[name] = process.env[name];
      child = spawn(asrPython, [join(asrSources, "server.py"), "--port", String(port), "--model", config.model, "--device", config.device, "--compute", config.compute, "--batch-size", String(config.batchSize), "--cache", config.cache, "--allow-root", tmpdir()], { detached: true, stdio: ["ignore", log.fd, log.fd], env: environment });
      child.once("error", (error) => { spawnError = error; });
      child.unref();
    } finally { await log.close(); }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null) throw new DvError("ASR_START_FAILED", `ASR exited during startup: ${spawnError?.message ?? child.exitCode}`, { hint: `See ${join(asrDirectory, "service.log")}.`, cause: spawnError });
      try {
        const health = await healthAsr(port, config, AbortSignal.timeout(1000));
        await writeFile(join(asrRoot, "run.json"), JSON.stringify({ pid: child.pid, port }) + "\n", { mode: 0o600 });
        return { port, config, health };
      } catch (error) {
        if (!(error instanceof DvError) || !["ASR_UNAVAILABLE", "ASR_TIMEOUT"].includes(error.code)) throw error;
      }
      await delay(200);
    }
    throw new DvError("ASR_START_FAILED", "ASR did not become ready within two minutes.", { hint: `See ${join(asrDirectory, "service.log")}.` });
  } catch (error) {
    child?.kill();
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_START_FAILED", `Cannot start ASR: ${String(error)}`, { cause: error });
  } finally { await rm(lock, { recursive: true, force: true }); }
}
export async function stopAsr(): Promise<void> {
  const running = await readRunning();
  const config = await readAsrConfiguration();
  if (!running) return;
  if (!config) throw new DvError("ASR_STATE_INVALID", "Cannot verify the service identity without its installation configuration.");
  try {
    await healthAsr(running.port, config);
    process.kill(running.pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof DvError && error.code === "ASR_UNAVAILABLE") && !(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
  await rm(join(asrRoot, "run.json"), { force: true });
}
export async function transcribeLocal(audioPath: string, language: string): Promise<{ health: AsrHealth; reply: AsrReply }> {
  const service = await startAsr();
  return transcribeAsr(service.port, service.config, audioPath, language);
}
