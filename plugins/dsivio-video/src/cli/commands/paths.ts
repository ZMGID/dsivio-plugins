import { join } from "node:path";
import { dsivioCommand } from "../../gateway/dsivio.ts";
import { DvError } from "../../core/errors.ts";
import type { CliOptions } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
export async function pathsCommand(options: CliOptions): Promise<number> {
  const workspace = openWorkspace(options);
  let dsivio: string | null = null;
  let commandError: string | null = null;
  try { dsivio = await dsivioCommand(); }
  catch (error) { if (!(error instanceof DvError)) throw error; commandError = error.message; }
  const data = { schema: "dsivio-video.paths/1", projectRoot: workspace.root, stateDir: workspace.stateDir, store: join(workspace.stateDir, "store"), runtimeDb: join(workspace.stateDir, "runtime", "state.db"), results: join(workspace.stateDir, "results"), workerLog: join(workspace.stateDir, "runtime", "worker.log"), config: join(workspace.stateDir, "config.json"), dsivio, commandError };
  result(options, data, Object.entries(data).filter(([key]) => key !== "schema").map(([key, value]) => `${key}: ${value ?? "not found"}`));
  return 0;
}
