import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { gatewayModels, selectBackend } from "../../gateway/backend.ts";
import { asrOwnerStatus } from "../../asr/backend.ts";
import { locateTool, toolNames, toolVersion } from "../../tools/index.ts";
import { DvError } from "../../core/errors.ts";
import { workerState } from "../../build/observe.ts";
import type { CliOptions } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
interface DiagnosticRow { name: string; status: "ok" | "warn" | "error"; message: string; path?: string; source?: string; version?: string }
export async function doctorCommand(options: CliOptions): Promise<number> {
  const workspace = openWorkspace(options);
  const rows: DiagnosticRow[] = [];
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  rows.push({ name: "node", status: major > 22 || (major === 22 && minor >= 18) ? "ok" : "error", message: `Node ${process.versions.node}; requires >=22.18` });
  try {
    await mkdir(workspace.stateDir, { recursive: true });
    const probe = join(workspace.stateDir, `.doctor-${randomUUID()}`);
    const handle = await open(probe, "wx");
    await handle.close();
    await unlink(probe);
    rows.push({ name: "state", status: "ok", message: `${workspace.stateDir} is writable` });
  } catch (error) { rows.push({ name: "state", status: "error", message: `State directory is not writable: ${String(error)}` }); }
  for (const name of toolNames) {
    try {
      const tool = await locateTool(name, { projectRoot: workspace.root });
      const version = await toolVersion(name, { projectRoot: workspace.root });
      rows.push({ name, status: "ok", message: `${version}; ${tool.path} (source: ${tool.source})`, path: tool.path, source: tool.source, version });
    } catch (error) {
      if (!(error instanceof DvError)) throw error;
      // ffmpeg/ffprobe are needed by every media step; the downloader and Python only by fetch and local ASR.
      const required = name === "ffmpeg" || name === "ffprobe";
      rows.push({ name, status: required ? "error" : "warn", message: `${error.message}${error.hint ? `; ${error.hint}` : ""}` });
    }
  }
  const modelCounts: Record<string, number> = {};
  try {
    const ctx = { projectRoot: workspace.root, signal: AbortSignal.timeout(10_000) };
    const owner = await selectBackend(ctx), models = await gatewayModels(ctx);
    rows.push({ name: "gateway", status: "ok", message: `Selected owner: ${owner}; no paid request made` });
    for (const model of models) modelCounts[model.kind] = (modelCounts[model.kind] ?? 0) + 1;
    for (const kind of ["image", "video", "speech", "transcribe"]) rows.push({ name: `models-${kind}`, status: (modelCounts[kind] ?? 0) > 0 ? "ok" : "warn", message: `${modelCounts[kind] ?? 0} configured ${kind} models (remote account access not probed)` });
    const asr = await asrOwnerStatus(workspace.root);
    rows.push({ name: "asr", status: asr.state === "ready" || asr.ready === true ? "ok" : "warn", message: `owner ${String(asr.owner)}; installation ${String(asr.state ?? (asr.ready ? "installed" : "not installed"))}; runtime ${JSON.stringify(asr.runtime ?? null)}` });
  } catch (error) { rows.push({ name: "gateway", status: "error", message: String(error) }); }
  try {
    const worker = await workerState(workspace);
    rows.push({ name: "worker", status: worker.running ? "ok" : "warn", message: worker.running ? `Worker running (${worker.pid})` : "Worker stopped; builds start it automatically" });
  } catch (error) { rows.push({ name: "worker", status: "error", message: String(error) }); }
  const valid = rows.every((row) => row.status !== "error");
  result(options, { schema: "dsivio-video.doctor-view/1", valid, projectRoot: workspace.root, diagnosticTotal: rows.length, diagnosticRows: rows, modelCounts }, rows.map((row) => `${row.status} ${row.name}: ${row.message}`));
  return valid ? 0 : 1;
}
