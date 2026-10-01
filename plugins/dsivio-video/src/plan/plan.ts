import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, relative } from "node:path";
import { DvError, spanAt } from "../core/errors.ts";
import type { SourceSpan } from "../core/errors.ts";
import type { AuthorGraph, CandidateDecl, ExecutionDefinition, InputSource, SourceAsset, Step } from "../core/graph.ts";
import type { RunIntent } from "../core/graph.ts";
import type { HistoryReader } from "../core/history.ts";
import { resourcesIn } from "../core/value.ts";
import { validateValue } from "../core/validate.ts";
import type { Value } from "../core/value.ts";
import type { Workspace } from "../source/workspace.ts";
import type { AuthorRegistry } from "../elaborate/compile.ts";
import * as builtins from "../modules/index.ts";

export interface Plan {
  definition: ExecutionDefinition;
  overrides: { output: string; candidate: string }[];
  unreachable: { key: string; label: string }[];
  assets: Map<string, SourceAsset>;
  /** Explicit display roots resolved by the same Candidate selection and pruning pass. */
  rootRecords?: string[];
}

export interface RunCheck {
  targets: string[];
  overrides: Plan["overrides"];
  unreachable: Plan["unreachable"];
  unresolvedHistory: { output: string; candidate: string; type: string; build: string; sourceOutput: string }[];
}

export function checkRun(run: RunIntent, author: AuthorGraph, workspace: Workspace, registry: AuthorRegistry = builtins): RunCheck {
  const { plan, unresolvedHistory } = selectRun(run, author, workspace, registry);
  return { targets: [...run.targets], overrides: plan.overrides, unreachable: plan.unreachable, unresolvedHistory };
}

export async function planRun(run: RunIntent, author: AuthorGraph, history: HistoryReader, workspace: Workspace, registry: AuthorRegistry = builtins, roots?: readonly InputSource[]): Promise<Plan> {
  const { plan, unresolvedHistory } = selectRun(run, author, workspace, registry, roots);
  const historicalValues = new Map<string, Value>();
  for (const row of unresolvedHistory) {
    const candidate = run.candidates.get(row.candidate)!;
    let value = historicalValues.get(row.candidate);
    if (!value) {
      const result = await history.readOutput(row.build, row.sourceOutput);
      if (!result) throw new DvError("UNKNOWN_HISTORY_OUTPUT", `Missing historical output ${row.build}:${row.sourceOutput}`, { span: candidate.span });
      if (result.type !== result.value.type) throw new DvError("CANDIDATE_RESULT_TYPE_MISMATCH", "Historical metadata and value types differ", { span: candidate.span });
      value = result.value;
      historicalValues.set(row.candidate, value);
    }
    if (value.type !== row.type) throw new DvError("CANDIDATE_RESULT_TYPE_MISMATCH", `${row.candidate} has type ${value.type}, expected ${row.type}`, { span: candidate.span });
    const record = plan.definition.outputs[row.output]!.record;
    if (Object.hasOwn(plan.definition.reused, record)) bindSeed(plan.definition, record, value, candidate.span);
  }
  return plan;
}

function bindSeed(definition: ExecutionDefinition, record: string, value: Value, span: SourceSpan): void {
  if (Object.hasOwn(definition.seeds, record)) {
    if (definition.seeds[record] !== value) throw new DvError("DUPLICATE_RECORD", `Record ${record} already has a binding`, { span });
    return;
  }
  Object.defineProperty(definition.seeds, record, { value, enumerable: true, writable: true, configurable: true });
}

function selectRun(run: RunIntent, author: AuthorGraph, workspace: Workspace, registry: AuthorRegistry, roots?: readonly InputSource[]): { plan: Plan; unresolvedHistory: RunCheck["unresolvedHistory"] } {
  const definition: ExecutionDefinition = { schema: "dsivio-video.definition/1", author: author.source, run: run.file, targets: [...run.targets], seeds: {}, forwarded: {}, reused: {}, steps: [], outputs: {}, modules: [] };
  const plan: Plan = { definition, overrides: [], unreachable: [], assets: new Map() };
  const steps = new Map<string, Step>();
  const resolving = new Set<string>();
  const chosen = new Map<string, string>();
  const values = new Map<string, Value>();
  const unresolvedHistory = new Map<string, RunCheck["unresolvedHistory"][number]>();
  const usedNames = new Set<string>();
  const selectedRecords = new Set<string>();
  const modules = new Set<string>();
  const outputKey = (operation: string, port: string): string => `${operation}.${port}`;
  for (const target of run.targets) if (!author.outputs.has(target)) throw new DvError("UNKNOWN_AUTHOR_OUTPUT", `Unknown target ${target}`, { span: run.targetSpans.get(target) ?? spanAt(run.file, "", 0) });
  const candidateTypes = new Map<string, string>();
  for (const [name, candidateName] of run.satisfy) {
    const output = author.outputs.get(name);
    if (!output) throw new DvError("UNKNOWN_AUTHOR_OUTPUT", `Unknown satisfied output ${name}`, { span: run.satisfySpans.get(name) ?? spanAt(run.file, "", 0) });
    const candidate = run.candidates.get(candidateName);
    if (!candidate) throw new DvError("UNKNOWN_CANDIDATE", `Unknown candidate ${candidateName}`, { span: run.satisfySpans.get(name) ?? spanAt(run.file, "", 0) });
    const priorType = candidateTypes.get(candidateName);
    if (priorType !== undefined && priorType !== output.type) throw new DvError("CANDIDATE_RESULT_TYPE_MISMATCH", `Candidate ${candidateName} cannot satisfy both ${priorType} and ${output.type}`, { span: candidate.span });
    candidateTypes.set(candidateName, output.type);
    if (candidate.kind !== "build" && candidate.type !== output.type) throw new DvError("CANDIDATE_RESULT_TYPE_MISMATCH", `${candidateName} has type ${candidate.type}, expected ${output.type}`, { span: candidate.span });
  }
  const candidateValue = (candidate: Exclude<CandidateDecl, { kind: "build" }>): Value => {
    const cached = values.get(candidate.name);
    if (cached) return cached;
    const locator = isAbsolute(candidate.path) ? `./${relative(dirname(run.file), candidate.path)}` : candidate.path;
    const path = workspace.resolveAsset(run.file, locator);
    const bytes = workspace.statFile(path, candidate.span);
    let stored: Value;
    if (candidate.kind === "file") {
      const ref = { $resource: `res_${randomBytes(16).toString("hex")}`, bytes, mime: candidate.mime };
      plan.assets.set(ref.$resource, { path, ref });
      stored = { type: candidate.type, data: ref };
    } else {
      let value: unknown;
      try { value = JSON.parse(workspace.readText(path, { asset: true, span: candidate.span })); }
      catch (cause) { throw new DvError("RUN_VALUE", `Cannot read stored value ${candidate.name}`, { span: candidate.span, cause }); }
      if (typeof value !== "object" || value === null || !("type" in value) || typeof value.type !== "string" || !("data" in value)) throw new DvError("RUN_VALUE", "Value candidate must contain {type,data}", { span: candidate.span });
      if (value.type !== candidate.type) throw new DvError("CANDIDATE_RESULT_TYPE_MISMATCH", `Stored value type ${value.type} does not match ${candidate.type}`, { span: candidate.span });
      stored = value as Value;
    }
    const hash = stored.type.lastIndexOf("#");
    const type = registry.findModule(stored.type.slice(0, hash))?.types[stored.type.slice(hash + 1)];
    validateValue(stored, hash < 0 ? undefined : type, candidate.span);
    values.set(candidate.name, stored);
    return stored;
  };
  const seed = (record: string, value: Value, span: SourceSpan): void => {
    bindSeed(definition, record, value, span);
    modules.add(value.type.slice(0, value.type.lastIndexOf("#")));
    for (const { ref } of resourcesIn(value.data)) {
      const asset = author.assets.get(ref.$resource);
      if (asset) plan.assets.set(ref.$resource, asset);
    }
  };
  const resolveName = (name: string, consumed: boolean): string => {
    const output = author.outputs.get(name)!;
    modules.add(output.type.slice(0, output.type.lastIndexOf("#")));
    usedNames.add(name);
    const prior = chosen.get(name);
    const candidateName = run.satisfy.get(name);
    const record = prior ?? (candidateName ? `candidate:${JSON.stringify([candidateName, name])}` : outputKey(output.operation, output.port));
    if (candidateName) {
      const candidate = run.candidates.get(candidateName)!;
      if (!prior) plan.overrides.push({ output: name, candidate: candidateName });
      chosen.set(name, record);
      if (candidate.kind === "build") {
        unresolvedHistory.set(name, { output: name, candidate: candidateName, type: output.type, build: candidate.build, sourceOutput: candidate.output });
        if (!consumed && run.targets.includes(name) && !Object.hasOwn(definition.reused, record)) Object.defineProperty(definition.forwarded, name, { value: { build: candidate.build, output: candidate.output }, enumerable: true, writable: true, configurable: true });
        else {
          delete definition.forwarded[name];
          definition.reused[record] = { build: candidate.build, output: candidate.output };
        }
      } else seed(record, candidateValue(candidate), candidate.span);
    } else {
      chosen.set(name, record);
      selectedRecords.add(record);
      resolveOperation(output.operation);
    }
    Object.defineProperty(definition.outputs, name, { value: { record, type: output.type }, enumerable: true, writable: true, configurable: true });
    return record;
  };
  const resolveInput = (source: InputSource): string => {
    if ("record" in source) {
      const record = author.records.get(source.record);
      if (!record) throw new DvError("UNKNOWN_AUTHOR_RECORD", `Unknown record ${source.record}`);
      seed(source.record, record.value, record.span);
      return source.record;
    }
    const names = [...author.outputs.values()].filter((output) => output.operation === source.operation && output.port === source.port).map((output) => output.name).sort();
    const name = names.find((name) => run.satisfy.has(name)) ?? names[0];
    if (name) return resolveName(name, true);
    selectedRecords.add(outputKey(source.operation, source.port));
    resolveOperation(source.operation);
    return outputKey(source.operation, source.port);
  };
  const resolveOperation = (key: string): void => {
    if (resolving.has(key)) throw new DvError("AUTHOR_COMPONENT_CYCLE", `Operation cycle at ${key}`);
    if (steps.has(key)) return;
    const operation = author.operations.get(key);
    if (!operation) throw new DvError("UNKNOWN_AUTHOR_COMPONENT", `Unknown operation ${key}`);
    resolving.add(key);
    const step: Step = { key, producer: operation.producer, label: operation.label, inputs: {}, results: {}, resultTypes: { ...operation.outputs } };
    for (const [port, input] of Object.entries(operation.inputs)) step.inputs[port] = Array.isArray(input) ? input.map(resolveInput) : resolveInput(input);
    for (const [port, type] of Object.entries(operation.outputs)) {
      step.results[port] = outputKey(key, port);
      modules.add(type.slice(0, type.lastIndexOf("#")));
    }
    modules.add(operation.producer.slice(0, operation.producer.lastIndexOf("#")));
    resolving.delete(key);
    steps.set(key, step);
  };
  if (roots) plan.rootRecords = roots.map(resolveInput);
  else for (const target of run.targets) resolveName(target, false);
  for (const [name, output] of author.outputs) {
    if (usedNames.has(name)) continue;
    const record = outputKey(output.operation, output.port);
    if (selectedRecords.has(record)) Object.defineProperty(definition.outputs, name, { value: { record, type: output.type }, enumerable: true, writable: true, configurable: true });
  }
  definition.steps = [...steps.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const step of definition.steps) for (const [port, record] of Object.entries(step.results)) if (!selectedRecords.has(record)) delete step.results[port];
  const boundRecords = new Set(Object.keys(definition.seeds));
  for (const record of Object.keys(definition.reused)) {
    if (boundRecords.has(record)) throw new DvError("DUPLICATE_RECORD", `Record ${record} already has a binding`, { span: spanAt(run.file, "", 0) });
    boundRecords.add(record);
  }
  for (const step of definition.steps) for (const record of Object.values(step.results)) {
    if (boundRecords.has(record)) throw new DvError("DUPLICATE_RECORD", `Record ${record} already has a binding`, { span: author.operations.get(step.key)!.span });
    boundRecords.add(record);
  }
  definition.modules = [...modules].sort();
  plan.overrides.sort((a, b) => a.output.localeCompare(b.output));
  plan.unreachable = [...author.operations.values()].filter((operation) => !steps.has(operation.key)).map(({ key, label }) => ({ key, label }));
  return { plan, unresolvedHistory: [...unresolvedHistory.values()] };
}
