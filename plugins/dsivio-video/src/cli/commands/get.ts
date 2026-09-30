import { ResultsRepository } from "../../build/results.ts";
import type { CliOptions } from "../options.ts";
import { stringOption, usage } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
export async function getCommand(options: CliOptions): Promise<number> {
  const outputName = stringOption(options, "output");
  const to = stringOption(options, "to");
  if (!outputName || !to) usage("get requires --output <name> and --to <path>.");
  const buildId = options.positionals[0]!;
  const exported = await new ResultsRepository(openWorkspace(options).stateDir).exportOutput(buildId, outputName, to);
  result(options, { schema: "dsivio-video.export-view/1", buildId, outputName, nominalType: exported.type, valueClass: exported.class, exportPath: exported.path }, [`Exported ${outputName} to ${exported.path}`, ...(options.verbose ? [`Type: ${exported.type}; kind: ${exported.class}`] : [])]);
  return 0;
}
