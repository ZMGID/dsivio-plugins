import { join } from "node:path";
import { dsivioCommand } from "../../tools/dsivio.ts";
import { locateTool, toolNames } from "../../tools/index.ts";
import type { LocatedTool, ToolName } from "../../tools/types.ts";
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
  const tools: (LocatedTool | { name: ToolName; path: null; source: null; error: string; hint?: string })[] = [];
  for (const name of toolNames) {
    try { tools.push(await locateTool(name, { projectRoot: workspace.root })); }
    catch (error) {
      if (!(error instanceof DvError)) throw error;
      tools.push({ name, path: null, source: null, error: error.message, ...(error.hint ? { hint: error.hint } : {}) });
    }
  }
  const data = { schema: "dsivio-video.paths/1", projectRoot: workspace.root, stateDir: workspace.stateDir, store: join(workspace.stateDir, "store"), runtimeDb: join(workspace.stateDir, "runtime", "state.db"), results: join(workspace.stateDir, "results"), workerLog: join(workspace.stateDir, "runtime", "worker.log"), config: join(workspace.stateDir, "config.json"), dsivio, commandError, tools };
  result(options, data, [
    ...Object.entries(data).filter(([key]) => key !== "schema" && key !== "tools").map(([key, value]) => `${key}: ${value ?? "not found"}`),
    ...tools.map((tool) => `${tool.name}: ${tool.path !== null ? `${tool.path} (source: ${tool.source})` : `${tool.error}${tool.hint ? `; ${tool.hint}` : ""}`}`),
  ]);
  return 0;
}
