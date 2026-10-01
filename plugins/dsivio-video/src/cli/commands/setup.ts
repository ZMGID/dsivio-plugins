import { installAsr, asrStatus } from "../../asr/install.ts";
import { DvError } from "../../core/errors.ts";
import { locateTool, toolNames, toolVersion } from "../../tools/index.ts";
import type { LocatedTool, ToolName } from "../../tools/types.ts";
import { usage } from "../options.ts";
import type { CliOptions } from "../options.ts";
import { result } from "../output.ts";
import { openWorkspace } from "../project.ts";

export async function setupCommand(options: CliOptions): Promise<number> {
  const action = options.positionals[0];
  if (action !== "asr" && action !== "status") usage("setup requires asr or status.");
  if (action === "asr") {
    const model = typeof options.values.model === "string" ? options.values.model : undefined;
    const status = await installAsr({ ...(model ? { model } : {}), onProgress: (line) => process.stderr.write(`${line}\n`) });
    result(options, { schema: "dsivio-video.setup/1", asr: status }, [`ASR ready: ${status.path}`, `Model: ${status.model}`, `Languages: ${status.languages?.join(", ") ?? "none"}`]);
    return 0;
  }
  if (options.values.model !== undefined) usage("--model is only valid with setup asr.");
  const workspace = openWorkspace(options);
  const tools: (LocatedTool & { version: string } | { name: ToolName; path: null; source: null; error: string; hint?: string })[] = [];
  for (const name of toolNames) {
    try {
      const tool = await locateTool(name, { projectRoot: workspace.root });
      tools.push({ ...tool, version: await toolVersion(name, { projectRoot: workspace.root }) });
    } catch (error) {
      if (!(error instanceof DvError)) throw error;
      tools.push({ name, path: null, source: null, error: error.message, ...(error.hint ? { hint: error.hint } : {}) });
    }
  }
  const asr = await asrStatus();
  result(options, { schema: "dsivio-video.setup-status/1", tools, asr }, [
    ...tools.map((tool) => `${tool.name}: ${tool.path !== null ? `${tool.version}; ${tool.path} (source: ${tool.source})` : `${tool.error}${tool.hint ? `; ${tool.hint}` : ""}`}`),
    `ASR: ${asr.ready ? "ready" : "not prepared"}; ${asr.path}${asr.model ? `; model: ${asr.model}` : ""}`,
    ...(asr.ready ? [] : ["Run dsivio-video setup asr to prepare local transcription."]),
  ]);
  return 0;
}
