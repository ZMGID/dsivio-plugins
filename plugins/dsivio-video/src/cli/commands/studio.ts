import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DvError } from "../../core/errors.ts";
import { preflightStudio } from "../../studio/display.ts";
import { resolveStudioWorkspace, StudioSession, studioError } from "../../studio/session.ts";
import { startStudioServer } from "../../studio/server.ts";
import type { CliOptions, CommandSpec } from "../options.ts";
import { integer, stringOption, usage } from "../options.ts";
import { result } from "../output.ts";

export const studioSpec: CommandSpec = { usage: "studio --run <run.dvrun> [--port <1..65535>] [--workspace <root>]", min: 0, max: 0, options: { run: "string", port: "string" } };
interface SessionRecord { pid: number; port: number; sessionId: string }
async function existing(recordFile: string, runFile: string): Promise<SessionRecord | undefined> {
  let raw: string;
  try { raw = await readFile(recordFile, "utf8"); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw new DvError("STUDIO_SESSION_IO", "Cannot read Studio session record", { cause: error }); }
  let record: SessionRecord | undefined;
  try { const parsed: unknown = JSON.parse(raw); if (parsed && typeof parsed === "object" && "pid" in parsed && "port" in parsed && "sessionId" in parsed && Number.isSafeInteger(parsed.pid) && Number(parsed.pid) > 0 && Number.isSafeInteger(parsed.port) && Number(parsed.port) >= 1 && Number(parsed.port) <= 65535 && typeof parsed.sessionId === "string") record = { pid: Number(parsed.pid), port: Number(parsed.port), sessionId: parsed.sessionId }; }
  catch (error) { if (!(error instanceof SyntaxError)) throw studioError(error); }
  if (record) {
    let alive = true;
    try { process.kill(record.pid, 0); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") alive = false; else if (!(error && typeof error === "object" && "code" in error && error.code === "EPERM")) throw studioError(error); }
    if (alive) {
      try { const response = await fetch(`http://127.0.0.1:${record.port}/__studio/health`, { signal: AbortSignal.timeout(1500), redirect: "error" }); const health: unknown = await response.json(); if (response.ok && health && typeof health === "object" && "sessionId" in health && "runFile" in health && health.sessionId === record.sessionId && health.runFile === runFile) return record; }
      catch (error) { if (!(error instanceof Error)) throw studioError(error); /* Failed health means this record does not identify a live Studio session. */ }
    }
  }
  if (await readFile(recordFile, "utf8") === raw) await rm(recordFile, { force: true });
  return undefined;
}
export async function studioCommand(options: CliOptions): Promise<number> {
  const run = stringOption(options, "run"); if (!run?.trim()) usage("studio requires --run <run.dvrun>.");
  const port = integer(stringOption(options, "port"), "port", 5179, 1); if (port > 65535) usage("--port must be 1..65535.");
  const cwd = process.env.INIT_CWD || process.cwd();
  const workspace = resolveStudioWorkspace({ cwd, workspace: options.workspace, assetRoots: options.assetRoots });
  const path = resolve(cwd, run); const runFile = workspace.resolveSource(path, `./${basename(path)}`);
  const recordFile = join(workspace.stateDir, "studio", "sessions", `${createHash("sha256").update(runFile).digest("hex")}.json`);
  const prior = await existing(recordFile, runFile);
  const print = (actualPort: number, sessionId: string, reused: boolean): void => {
    const url = `http://127.0.0.1:${actualPort}/`;
    result(options, { schema: "dsivio-video.studio-session/1", projectRoot: workspace.root, runFile, url, commentsUrl: `${url}#comments`, sessionId, reused }, [`Project: ${workspace.root}`, `Run: ${runFile}`, `${reused ? "Existing Studio" : "Studio"}: ${url}`, `Comments: ${url}#comments`]);
  };
  if (prior) { print(prior.port, prior.sessionId, true); return 0; }
  await preflightStudio(runFile, workspace);
  const host = await startStudioServer(new StudioSession(workspace, runFile), port);
  await mkdir(join(workspace.stateDir, "studio", "sessions"), { recursive: true });
  const record: SessionRecord = { pid: process.pid, port: host.port, sessionId: host.session.sessionId };
  try { await writeFile(recordFile, JSON.stringify(record), { flag: "wx" }); }
  catch (error) {
    await host.close();
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") { const active = await existing(recordFile, runFile); if (active) { print(active.port, active.sessionId, true); return 0; } }
    throw new DvError("STUDIO_SESSION_CONFLICT", "Another Studio session changed coordination during startup", { cause: error });
  }
  print(host.port, host.session.sessionId, false);
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const close = (): void => {
      if (closing) return; closing = true;
      process.off("SIGINT", close); process.off("SIGTERM", close);
      void (async () => { try { await host.close(); const current = JSON.parse(await readFile(recordFile, "utf8")) as SessionRecord; if (current.sessionId === record.sessionId) await rm(recordFile, { force: true }); resolve(); } catch (error) { reject(studioError(error)); } })();
    };
    process.once("SIGINT", close); process.once("SIGTERM", close);
  });
  return 0;
}
