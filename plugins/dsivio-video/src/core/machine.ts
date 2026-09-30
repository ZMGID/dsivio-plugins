import { DvError } from "./errors.ts";
import type { Command, ExecutionDefinition, Fact, MachineState, Step } from "./graph.ts";
import type { NeedRequest, ProducerInputs } from "./module.ts";
import { canonicalJson } from "./value.ts";
import type { Value } from "./value.ts";

export class BuildMachine {
  readonly definition: ExecutionDefinition;
  private readonly records = new Map<string, Value>();
  private readonly steps = new Map<string, Step>();
  private readonly accepted = new Set<string>();
  private readonly needs = new Map<string, { step: string; port: string; need: NeedRequest }>();
  private failed = false;

  constructor(definition: ExecutionDefinition) {
    this.definition = definition;
    for (const [record, value] of Object.entries(definition.seeds)) this.records.set(record, value);
    for (const step of definition.steps) {
      if (this.steps.has(step.key)) throw new DvError("MACHINE_DUPLICATE_STEP", `Duplicate step ${step.key}`);
      this.steps.set(step.key, step);
    }
  }

  get state(): MachineState {
    if (this.failed) return "failed";
    return this.definition.targets.every((target) => Object.hasOwn(this.definition.forwarded, target) || (Object.hasOwn(this.definition.outputs, target) && this.records.has(this.definition.outputs[target]!.record))) ? "complete" : "running";
  }

  ready(): Command[] {
    if (this.state !== "running") return [];
    const commands: Command[] = [];
    for (const step of this.definition.steps) {
      const key = `produce:${step.key}`;
      if (!this.accepted.has(key) && Object.values(step.inputs).flat().every((record) => this.records.has(record))) commands.push({ kind: "produce", key, step: step.key });
      for (const port of Object.keys(step.results)) {
        const key = `fulfil:${step.key}.${port}`;
        const entry = this.needs.get(key);
        if (entry && !this.accepted.has(key)) commands.push({ kind: "fulfil", key, ...entry });
      }
    }
    return commands;
  }

  inputsFor(key: string): ProducerInputs {
    const step = this.steps.get(key);
    if (!step) throw new DvError("MACHINE_UNKNOWN_STEP", `Unknown step ${key}`);
    const input = (record: string): Value => {
      const value = this.records.get(record);
      if (!value) throw new DvError("MACHINE_INPUT_PENDING", `Input ${record} is not available`);
      return value;
    };
    const result: ProducerInputs = {};
    for (const [port, record] of Object.entries(step.inputs)) result[port] = Array.isArray(record) ? record.map(input) : input(record);
    return result;
  }

  valueOf(record: string): Value | undefined { return this.records.get(record); }

  validate(fact: Fact): void {
    if (this.accepted.has(fact.command)) throw new DvError("MACHINE_DUPLICATE_FACT", `Command ${fact.command} already has a fact`);
    let command: Command | undefined;
    for (const step of this.definition.steps) {
      if (fact.command === `produce:${step.key}`) {
        if (!Object.values(step.inputs).flat().every((record) => this.records.has(record))) throw new DvError("MACHINE_INPUT_PENDING", `Step ${step.key} has missing inputs`);
        command = { kind: "produce", key: fact.command, step: step.key };
        break;
      }
    }
    if (!command) {
      const need = this.needs.get(fact.command);
      if (need) command = { kind: "fulfil", key: fact.command, ...need };
    }
    if (!command) throw new DvError("MACHINE_UNKNOWN_COMMAND", `Unknown command ${fact.command}`);
    if (fact.kind === "failed") return;
    const step = this.steps.get(command.step)!;
    const checkValue = (port: string, value: Value): void => {
      if (value.type !== step.resultTypes[port]) throw new DvError("MACHINE_OUTPUT_TYPE_MISMATCH", `Port ${port} expects ${step.resultTypes[port]}, received ${value.type}`);
      try { canonicalJson(value.data); }
      catch (cause) { throw new DvError("MACHINE_INVALID_VALUE", `Invalid value for port ${port}`, { cause }); }
      const record = step.results[port];
      if (record !== undefined && this.records.has(record)) throw new DvError("MACHINE_RECORD_CONFLICT", `Record ${record} already exists`);
    };
    if (command.kind === "produce") {
      if (fact.kind !== "produced") throw new DvError("MACHINE_FACT_KIND", "Produce commands require produced facts");
      const ports = [...Object.keys(fact.outputs), ...Object.keys(fact.needs)];
      const expected = Object.keys(step.resultTypes);
      if (ports.length !== expected.length || new Set(ports).size !== ports.length || ports.some((port) => !Object.hasOwn(step.resultTypes, port))) throw new DvError("MACHINE_PORT_BINDING_MISMATCH", `Produced ports do not match step ${step.key}`);
      for (const [port, value] of Object.entries(fact.outputs)) checkValue(port, value);
      for (const [port, need] of Object.entries(fact.needs)) {
        if (!need.capability.trim()) throw new DvError("MACHINE_INVALID_NEED", `Need ${port} has an empty capability`);
        try { canonicalJson(need.request); }
        catch (cause) { throw new DvError("MACHINE_INVALID_NEED", `Need ${port} has an invalid request`, { cause }); }
      }
    } else {
      if (fact.kind !== "fulfilled") throw new DvError("MACHINE_FACT_KIND", "Fulfil commands require fulfilled facts");
      checkValue(command.port, fact.value);
    }
  }

  accept(fact: Fact): void {
    this.validate(fact);
    if (fact.kind === "failed") this.failed = true;
    else if (fact.kind === "produced") {
      const step = this.steps.get(fact.command.slice("produce:".length))!;
      for (const [port, value] of Object.entries(fact.outputs)) {
        const record = step.results[port];
        if (record !== undefined) this.records.set(record, value);
      }
      for (const [port, need] of Object.entries(fact.needs)) if (Object.hasOwn(step.results, port)) this.needs.set(`fulfil:${step.key}.${port}`, { step: step.key, port, need });
    } else {
      const need = this.needs.get(fact.command)!;
      this.records.set(this.steps.get(need.step)!.results[need.port]!, fact.value);
    }
    this.accepted.add(fact.command);
  }
}
