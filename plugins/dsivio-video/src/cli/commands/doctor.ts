import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dsivioCommand, runDsivio } from "../../gateway/dsivio.ts";
import { workerState } from "../../build/observe.ts";
import type { CliOptions } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
interface DiagnosticRow { name: string; status: "ok" | "warn" | "error"; message: string }
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
  const modelCounts: Record<string, number> = {};
  try {
    const command = await dsivioCommand();
    rows.push({ name: "dsivio-command", status: "ok", message: command });
    const reply = await runDsivio(["media", "models"], workspace.root, AbortSignal.timeout(10_000));
    if (reply.code === 6) rows.push({ name: "models", status: "error", message: "Open Dsivio (its CLI returned exit 6)." });
    else if (reply.code !== 0) rows.push({ name: "models", status: "error", message: `Models query exited ${reply.code}: ${reply.stderr || reply.stdout}` });
    else {
      const models: unknown = JSON.parse(reply.stdout);
      if (!Array.isArray(models) || models.some((model) => typeof model !== "object" || model === null || !("kind" in model) || typeof model.kind !== "string")) throw new Error("Models response must be an array with kind fields.");
      for (const model of models) modelCounts[model.kind] = (modelCounts[model.kind] ?? 0) + 1;
      for (const kind of ["image", "video"]) rows.push({ name: `models-${kind}`, status: (modelCounts[kind] ?? 0) > 0 ? "ok" : "warn", message: `${modelCounts[kind] ?? 0} enabled ${kind} models` });
    }
  } catch (error) { rows.push({ name: "dsivio", status: "error", message: `Cannot query Dsivio; open Dsivio. ${String(error)}` }); }
  try {
    const worker = await workerState(workspace);
    rows.push({ name: "worker", status: worker.running ? "ok" : "warn", message: worker.running ? `Worker running (${worker.pid})` : "Worker stopped; builds start it automatically" });
  } catch (error) { rows.push({ name: "worker", status: "error", message: String(error) }); }
  const valid = rows.every((row) => row.status !== "error");
  result(options, { schema: "dsivio-video.doctor-view/1", valid, projectRoot: workspace.root, diagnosticTotal: rows.length, diagnosticRows: rows, modelCounts }, rows.map((row) => `${row.status} ${row.name}: ${row.message}`));
  return valid ? 0 : 1;
}
