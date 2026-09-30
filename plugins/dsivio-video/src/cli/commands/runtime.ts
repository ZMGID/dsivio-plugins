import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureWorker } from "../../build/submit.ts";
import { stopWorker } from "../../build/worker.ts";
import { activity, workerState } from "../../build/observe.ts";
import type { CliOptions } from "../options.ts";
import { integer, stringOption, usage } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
export async function runtimeCommand(options: CliOptions): Promise<number> {
  const action = options.positionals[0]!;
  if (!["up", "down", "status", "logs"].includes(action)) usage("runtime requires up, down, status, or logs.");
  if (options.values.lines !== undefined && action !== "logs") usage("--lines is only valid for runtime logs.");
  const lineLimit = integer(stringOption(options, "lines"), "lines", 50, 1);
  const workspace = openWorkspace(options);
  if (action === "logs") {
    const path = join(workspace.stateDir, "runtime", "worker.log");
    let text = "";
    try { text = await readFile(path, "utf8"); }
    catch (error) { if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const all = text ? text.replace(/\n$/, "").split("\n") : [];
    const logLines = all.slice(-lineLimit);
    result(options, { schema: "dsivio-video.runtime-logs/1", logLines, lineTotal: all.length, hiddenLineTotal: all.length - logLines.length, ...(options.verbose ? { path } : {}) }, [...(options.verbose ? [`Log: ${path}`] : []), ...logLines, ...(all.length > logLines.length ? [`${all.length - logLines.length} earlier lines omitted`] : [])]);
    return 0;
  }
  if (action === "up") await ensureWorker(workspace);
  if (action === "down") {
    await stopWorker(workspace);
    const deadline = Date.now() + 5000;
    while ((await workerState(workspace)).running && Date.now() < deadline) await sleep(50);
  }
  const view = await activity(workspace, { limit: options.limit });
  result(options, { schema: "dsivio-video.runtime-view/1", action, workerState: view.workerState, activeBuilds: view.activeBuilds.length, hiddenBuildTotal: view.hiddenBuildTotal }, [`Worker: ${view.workerState.running ? `running (${view.workerState.pid})` : "stopped"}`, `Active Builds: ${view.activeBuilds.length + view.hiddenBuildTotal}`]);
  return action === "down" && view.workerState.running ? 1 : 0;
}
