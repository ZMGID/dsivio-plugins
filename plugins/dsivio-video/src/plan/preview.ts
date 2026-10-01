import { DvError } from "../core/errors.ts";
import type { Resolution, ResolveContext, CapabilityDef } from "../core/capability.ts";
import type { ExecutionDefinition } from "../core/graph.ts";
import type { InputValue, ProducerDef, ProducerInputs, ProducerResult } from "../core/module.ts";
import type { Value } from "../core/value.ts";
import * as builtins from "../modules/index.ts";

export interface PreviewRegistry {
  findProducer(ref: string): ProducerDef | undefined;
  findCapability(name: string): CapabilityDef | undefined;
}

export type NeedPreview =
  | { kind: "request"; step: string; label: string; port: string; capability: string; resolution: Resolution }
  | { kind: "waiting"; step: string; label: string; waitingFor: string[] }
  | { kind: "issue"; step: string; label: string; code: string; message: string };

export async function previewNeeds(definition: ExecutionDefinition, ctx: ResolveContext, registry: PreviewRegistry = builtins): Promise<NeedPreview[]> {
  const values = new Map<string, Value>(Object.entries(definition.seeds));
  const pendingNames = new Map<string, { name: string; type: string }>();
  for (const step of definition.steps) for (const [port, record] of Object.entries(step.results)) pendingNames.set(record, { name: `${step.label}.${port}`, type: step.resultTypes[port]! });
  for (const [name, output] of Object.entries(definition.outputs)) pendingNames.set(output.record, { name, type: output.type });
  const done = new Set<string>();
  const rows = new Map<string, NeedPreview[]>();
  let changed = true;
  let allowPending = false;
  while (changed) {
    changed = false;
    for (const step of definition.steps) {
      if (done.has(step.key)) continue;
      const producer = registry.findProducer(step.producer);
      if (!producer) {
        rows.set(step.key, [{ kind: "issue", step: step.key, label: step.label, code: "UNKNOWN_PRODUCER", message: `Unknown producer ${step.producer}` }]);
        done.add(step.key);
        changed = true;
        continue;
      }
      const missing = Object.values(step.inputs).flat().filter((record) => !values.has(record));
      if (missing.length && (!allowPending || !producer.previewsPending)) continue;
      const inputs: ProducerInputs = {};
      const inputValue = (record: string): InputValue => {
        const value = values.get(record);
        if (value) return value;
        const pending = pendingNames.get(record);
        if (!pending) throw new DvError("PREVIEW_UNKNOWN_INPUT", `No source for input ${record}`);
        return { $pending: pending.name, type: pending.type };
      };
      for (const [port, record] of Object.entries(step.inputs)) inputs[port] = Array.isArray(record) ? record.map(inputValue) : inputValue(record);
      let result: ProducerResult;
      try {
        result = producer.run(inputs);
        const ports = [...Object.keys(result.outputs ?? {}), ...Object.keys(result.needs ?? {})];
        if (ports.length !== Object.keys(step.resultTypes).length || new Set(ports).size !== ports.length || ports.some((port) => !Object.hasOwn(step.resultTypes, port))) throw new DvError("PRODUCER_RESULT_NORMAL_FORM", `Producer ${step.producer} returned incorrect output ports`);
        for (const [port, value] of Object.entries(result.outputs ?? {})) if (value.type !== step.resultTypes[port]) throw new DvError("OPERATION_RESULT_MISMATCH", `Producer ${step.producer} returned the wrong type for ${port}`);
      } catch (cause) {
        rows.set(step.key, [{ kind: "issue", step: step.key, label: step.label, code: cause instanceof DvError ? cause.code : "PRODUCER_RUN_FAILED", message: cause instanceof Error ? cause.message : String(cause) }]);
        done.add(step.key);
        changed = true;
        continue;
      }
      for (const [port, value] of Object.entries(result.outputs ?? {})) {
        const record = step.results[port];
        if (record !== undefined) values.set(record, value);
      }
      const previews: NeedPreview[] = [];
      for (const [port, need] of Object.entries(result.needs ?? {})) {
        if (!Object.hasOwn(step.results, port)) continue;
        const capability = registry.findCapability(need.capability);
        const resolution: Resolution = !capability ? { ok: false, code: "UNKNOWN_CAPABILITY", reason: `Unknown capability ${need.capability}` } : capability.returns !== step.resultTypes[port] ? { ok: false, code: "CAPABILITY_RESULT_TYPE_MISMATCH", reason: `Capability ${need.capability} does not return ${step.resultTypes[port]}` } : await capability.resolve(need.request, ctx);
        previews.push({ kind: "request", step: step.key, label: step.label, port, capability: need.capability, resolution });
        if (resolution.ok && need.capability.startsWith("gateway/")) {
          definition.gatewayBackend = resolution.backend as "dsivio" | "standalone";
          (definition.gatewaySnapshots ??= {})[`fulfil:${step.key}.${port}`] = resolution.request;
        }
      }
      rows.set(step.key, previews);
      done.add(step.key);
      changed = true;
    }
    if (!changed && !allowPending) {
      allowPending = true;
      changed = true;
    }
  }
  return definition.steps.flatMap((step) => {
    const ready = rows.get(step.key);
    if (ready) return ready;
    const missing = [...new Set(Object.values(step.inputs).flat().filter((record) => !values.has(record)).map((record) => pendingNames.get(record)?.name ?? record))];
    return [{ kind: "waiting" as const, step: step.key, label: step.label, waitingFor: missing }];
  });
}
