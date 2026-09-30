import { resolve } from "node:path";
import { readHeader } from "../../markup/header.ts";
import { compileAuthor } from "../../elaborate/compile.ts";
import { readRun } from "../../run/parse.ts";
import { checkRun } from "../../plan/plan.ts";
import type { CliOptions } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
export async function checkCommand(options: CliOptions): Promise<number> {
  const workspace = openWorkspace(options);
  const file = resolve(options.positionals[0]!);
  const header = readHeader(file, workspace.readText(file));
  if (header.using === "dsivio-video/run@1") {
    const run = readRun(file, workspace);
    const author = compileAuthor(run.author, workspace);
    const checked = checkRun(run, author, workspace);
    const historical = [...run.candidates.values()].filter((candidate) => candidate.kind === "build");
    const data = { format: "dsivio-video.check/1", ok: true, sourceKind: "run", run: run.file, author: author.source, frontend: header.using, outputCount: author.outputs.size, targetCount: run.targets.length, targets: run.targets, candidates: [...run.candidates.values()].map(({ span: _span, ...candidate }) => candidate), satisfactions: [...run.satisfy].map(([output, candidate]) => ({ output, candidate })), historicalOutputCount: historical.length, ...(options.verbose ? { unresolvedHistoricalOutputs: checked.unresolvedHistory.slice(0, options.limit), omittedHistoricalOutputs: Math.max(0, checked.unresolvedHistory.length - options.limit) } : {}) };
    const outputs = [...author.outputs.values()].sort((a, b) => a.name.localeCompare(b.name));
    result(options, data, ["Check passed (run)", `Source: ${run.file}`, `Author: ${author.source}`, `Outputs: ${author.outputs.size}`, `Targets: ${run.targets.join(", ")}`, `Candidates: ${run.candidates.size}; satisfactions: ${run.satisfy.size}; unresolved selected history: ${checked.unresolvedHistory.length}`, ...(options.verbose ? [...outputs.slice(0, options.limit).map((output) => `  ${output.name}: ${output.type}`), ...(outputs.length > options.limit ? [`  … ${outputs.length - options.limit} outputs omitted`] : []), ...checked.unresolvedHistory.slice(0, options.limit).map((item) => `  unresolved ${item.output}: ${item.build}:${item.sourceOutput} via ${item.candidate}`), ...(checked.unresolvedHistory.length > options.limit ? [`  … ${checked.unresolvedHistory.length - options.limit} historical outputs omitted`] : [])] : [])]);
  } else {
    const author = compileAuthor(file, workspace);
    const outputs = [...author.outputs.values()].filter((output) => !output.name.includes(".__") && !/\.binding-\d+$|\.bindings$/.test(output.name)).sort((a, b) => a.name.localeCompare(b.name)).map(({ name, type }) => ({ name, type }));
    const values = [...author.publicRecords].filter(([name]) => !name.includes(".__") && !/\.binding-\d+$|\.bindings$/.test(name)).sort(([a], [b]) => a.localeCompare(b)).map(([name, key]) => ({ name, type: author.records.get(key)!.value.type }));
    const data = { format: "dsivio-video.check/1", ok: true, sourceKind: "author", source: author.source, frontend: header.using, units: author.sources.length, assets: author.assets.size, modules: author.modules.length, outputCount: outputs.length, ...(options.verbose ? { outputs: outputs.slice(0, options.limit), omittedOutputs: Math.max(0, outputs.length - options.limit), details: { modules: author.modules, values: values.slice(0, options.limit), omittedValues: Math.max(0, values.length - options.limit) } } : {}) };
    result(options, data, ["Check passed (author)", `Source: ${author.source}`, `Outputs: ${outputs.length}`, ...(options.verbose ? [`Frontend: ${header.using}`, `Units: ${author.sources.length}; assets: ${author.assets.size}; modules: ${author.modules.length}`, ...outputs.slice(0, options.limit).map((output) => `  output ${output.name}: ${output.type}`), ...(outputs.length > options.limit ? [`  … ${outputs.length - options.limit} outputs omitted`] : []), ...values.slice(0, options.limit).map((value) => `  value ${value.name}: ${value.type}`), ...(values.length > options.limit ? [`  … ${values.length - options.limit} values omitted`] : [])] : [])]);
  }
  return 0;
}
