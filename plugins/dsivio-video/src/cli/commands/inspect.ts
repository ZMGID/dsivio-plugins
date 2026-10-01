import { DvError } from "../../core/errors.ts";
import { ResultsRepository } from "../../build/results.ts";
import type { CliOptions } from "../options.ts";
import { stringOption } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
import { evidenceLine, outputDescription } from "../result-view.ts";
export async function inspectCommand(options: CliOptions): Promise<number> {
  const repository = new ResultsRepository(openWorkspace(options).stateDir);
  const manifest = await repository.read(options.positionals[0]!);
  if (!manifest) throw new DvError("RESULT_NOT_FOUND", `Result ${options.positionals[0]} was not found.`);
  const selected = stringOption(options, "output");
  if (selected && !Object.hasOwn(manifest.outputs, selected)) throw new DvError("OUTPUT_NOT_FOUND", `Output ${selected} is not available in ${manifest.id}.`);
  const entries = Object.entries(manifest.outputs);
  const visible = entries.filter(([name]) => selected ? name === selected : options.verbose || manifest.targets.includes(name));
  const outputs = await Promise.all(visible.slice(0, options.limit).map(([name, output]) => outputDescription(repository, manifest, name, output)));
  const evidence = (options.verbose ? manifest.operations : manifest.operations.filter((operation) => operation.error)).slice(0, options.limit);
  const view = { id: manifest.id, title: manifest.title, author: manifest.author, run: manifest.run, createdAt: manifest.createdAt, completedAt: manifest.completedAt, outcome: manifest.outcome, failure: manifest.failure, targets: manifest.targets, targetTotal: manifest.targets.length, outputTotal: entries.length, outputs, otherOutputTotal: entries.length - visible.length, omittedOutputs: Math.max(0, visible.length - options.limit), evidence, omittedEvidence: Math.max(0, (options.verbose ? manifest.operations.length : manifest.operations.filter((operation) => operation.error).length) - options.limit) };
  result(options, { schema: "dsivio-video.result-view/1", resultView: view }, [`Result: ${manifest.id} — ${manifest.outcome}`, `Created: ${manifest.createdAt}`, `Author: ${manifest.author}`, `Run: ${manifest.run}`, `Targets: ${manifest.targets.join(", ")}; available outputs: ${entries.length}`, ...(manifest.failure ? [`${manifest.failure.code}: ${manifest.failure.message}`] : []), ...outputs.map((output) => `  ${output.name}: ${output.nominalType} (${output.valueClass})${output.bytes === undefined ? "" : `; ${output.mime}, ${output.bytes} bytes`}`), ...evidence.map((operation) => `  ${evidenceLine(operation)}`), ...(view.otherOutputTotal || view.omittedOutputs ? [`Other outputs: ${view.otherOutputTotal}; omitted: ${view.omittedOutputs}`] : [])]);
  return 0;
}
