import { mkdir } from "node:fs/promises";
import type { CapabilityDef, ExecuteContext, ResolveContext, Resolution } from "../core/capability.ts";
import type { Command, Fact } from "../core/graph.ts";
import type { BuildMachine } from "../core/machine.ts";
import type { ModuleDef, ProducerDef } from "../core/module.ts";
import type { Json, Value } from "../core/value.ts";
import { canonicalJson } from "../core/value.ts";
import { DvError } from "../core/errors.ts";

export interface ExecutionRegistry {
  findProducer(ref: string): ProducerDef | undefined;
  findCapability(name: string): CapabilityDef | undefined;
  findModule?(id: string): ModuleDef | undefined;
}
export interface ExecutionPolicy {
  beforeResolve(command: Extract<Command, { kind: "fulfil" }>): void;
  afterResolve(command: Extract<Command, { kind: "fulfil" }>, capability: CapabilityDef, resolution: Extract<Resolution, { ok: true }>): void;
}
export interface ExecutionCache {
  execute(capability: CapabilityDef, request: Json, context: ExecuteContext, validate: (value: Value) => void, run: (context: ExecuteContext) => Promise<Value>): Promise<Value>;
}
export interface CommandContext {
  registry: ExecutionRegistry;
  resolveContext: ResolveContext;
  executeContext: ExecuteContext;
  policy?: ExecutionPolicy;
  cache?: ExecutionCache;
  /** Worker persists the resolved operation before an immediate executor starts. */
  onResolved?(resolution: Extract<Resolution, { ok: true }>): void | Promise<void>;
}

export const STUDIO_LOCAL_CAPABILITIES: readonly string[] = Object.freeze([
  "local/inspect", "local/normalize", "local/transform", "local/extract-audio", "local/extract-frame",
  "local/still-video", "local/speech-audio", "local/align", "local/font-face", "local/raster", "local/prepare-audio-playback",
]);
function unavailable(command: Extract<Command, { kind: "fulfil" }>): DvError {
  return new DvError("STUDIO_CAPABILITY_MISSING", `Studio cannot prepare ${command.need.capability} for ${command.step}.${command.port}. Generate it through a normal Build and select its Result.`);
}
export const studioExecutionPolicy: ExecutionPolicy = {
  beforeResolve(command) { if (!STUDIO_LOCAL_CAPABILITIES.includes(command.need.capability)) throw unavailable(command); },
  afterResolve(command, capability, resolution) {
    if (resolution.cost !== "local" || capability.executor.kind !== "immediate") throw unavailable(command);
  },
};

export function validateExecutionValue(registry: ExecutionRegistry, value: Value): void {
  try {
    canonicalJson(value.data);
    if (registry.findModule) {
      const hash = value.type.lastIndexOf("#");
      const definition = registry.findModule(value.type.slice(0, hash))?.types[value.type.slice(hash + 1)];
      if (!definition) throw new DvError("TYPE_UNKNOWN", `Type not found: ${value.type}`);
      definition.validate(value.data);
    }
  } catch (cause) {
    if (cause instanceof DvError) throw cause;
    throw new DvError("TYPE_INVALID", `Invalid value of type ${value.type}`, { cause });
  }
}

/** Executes one ready command without accepting or persisting its fact. Async submit/poll belongs to the worker. */
export async function executeCommand(machine: BuildMachine, command: Command, context: CommandContext): Promise<Fact> {
  let fact: Fact;
  try {
    if (context.executeContext.signal.aborted) throw new DvError("ABORTED", "Command cancelled");
    if (command.kind === "produce") {
      const step = machine.definition.steps.find(item => item.key === command.step);
      const producer = step && context.registry.findProducer(step.producer);
      if (!producer) throw new DvError("PRODUCER_UNKNOWN", `Producer not found: ${step?.producer ?? command.step}`);
      const result = producer.run(machine.inputsFor(command.step));
      for (const value of Object.values(result.outputs ?? {})) validateExecutionValue(context.registry, value);
      fact = { kind: "produced", command: command.key, outputs: result.outputs ?? {}, needs: result.needs ?? {} };
    } else {
      context.policy?.beforeResolve(command);
      const capability = context.registry.findCapability(command.need.capability);
      if (!capability) throw new DvError("CAPABILITY_UNKNOWN", `Capability not found: ${command.need.capability}`);
      const resolution = await capability.resolve(command.need.request, context.resolveContext);
      if (!resolution.ok) throw new DvError(resolution.code, resolution.reason);
      context.policy?.afterResolve(command, capability, resolution);
      if (capability.executor.kind !== "immediate") throw new DvError("EXECUTOR_ASYNC", `Asynchronous capability requires the Build worker: ${capability.name}`);
      const executor = capability.executor;
      if (context.executeContext.signal.aborted) throw new DvError("ABORTED", "Command cancelled");
      await context.onResolved?.(resolution);
      const validate = (value: Value): void => {
        if (value.type !== capability.returns) throw new DvError("CAPABILITY_OUTPUT_TYPE", `${capability.name} must return ${capability.returns}, received ${value.type}`);
        validateExecutionValue(context.registry, value);
        machine.validate({ kind: "fulfilled", command: command.key, value });
      };
      const run = async (execution: ExecuteContext): Promise<Value> => {
        await mkdir(execution.workDir, { recursive: true });
        const value = await executor.run(resolution.request, execution);
        if (execution.signal.aborted) throw new DvError("ABORTED", "Command cancelled");
        validate(value);
        return value;
      };
      const value = context.cache
        ? await context.cache.execute(capability, resolution.request, context.executeContext, validate, run)
        : await run(context.executeContext);
      validate(value);
      fact = { kind: "fulfilled", command: command.key, value };
    }
    machine.validate(fact);
  } catch (cause) {
    const aborted = context.executeContext.signal.aborted || (cause instanceof Error && cause.name === "AbortError") ||
      (cause !== null && typeof cause === "object" && "code" in cause && (cause.code === "ABORTED" || cause.code === "ABORT_ERR"));
    const error = cause instanceof DvError ? cause : new DvError(aborted ? "ABORTED" : "EXECUTION_FAILED", cause instanceof Error ? cause.message : String(cause), { cause });
    fact = { kind: "failed", command: command.key, code: error.code, message: error.message };
    machine.validate(fact);
  }
  return fact;
}
