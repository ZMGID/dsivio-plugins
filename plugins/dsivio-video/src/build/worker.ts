import { mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExecuteContext } from "../core/capability.ts";
import type { Fact } from "../core/graph.ts";
import { valueClass } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import { BuildMachine } from "../core/machine.ts";
import { findCapability, findModule, findProducer } from "../modules/index.ts";
import { idempotencyKey } from "./ids.ts";
import { ProjectStore } from "./resources.ts";
import { operationEvidence, ResultsRepository } from "./results.ts";
import type { ResultManifest } from "./results.ts";
import { BuildStore } from "./store.ts";
import type { BuildRecord, Operation } from "./store.ts";
import { executeCommand, validateExecutionValue } from "./execute.ts";
import type { ExecutionRegistry } from "./execute.ts";
import { frozenRequest } from "../gateway/validate.ts";

export interface BuildWorkspace { root: string; stateDir: string }
export interface BuildRegistry extends ExecutionRegistry {}
export interface WorkerOptions {
  registry?: BuildRegistry;
  signal?: AbortSignal;
  concurrency?: number;
  idleTimeoutMs?: number;
  tickMs?: number;
  unavailableRetryMs?: number;
}
export function workerWorkspace(workspace: BuildWorkspace | string): BuildWorkspace {
  return typeof workspace === "string" ? { root: workspace, stateDir: join(workspace, ".dsivio-video") } : workspace;
}
export async function stopWorker(workspace: BuildWorkspace | string): Promise<boolean> {
  const store = new BuildStore(workerWorkspace(workspace).stateDir);
  try { return store.requestWorkerStop(); } finally { store.close(); }
}

export async function runWorker(workspace: BuildWorkspace | string, options: WorkerOptions = {}): Promise<void> {
  const project = workerWorkspace(workspace);
  const concurrency = options.concurrency ?? 6;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new DvError("WORKER_CONCURRENCY", "Worker concurrency must be a positive integer");
  const store = new BuildStore(project.stateDir);
  const token = randomBytes(16).toString("hex");
  if (!store.acquireWorker(token, process.pid)) { store.close(); return; }
  const resources = new ProjectStore(project.stateDir);
  const results = new ResultsRepository(project.stateDir);
  const registry = options.registry ?? { findProducer, findCapability, findModule };
  const stopped = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stopped.signal]) : stopped.signal;
  let heartbeatError: unknown;
  const heartbeat = setInterval(() => {
    try { if (!store.heartbeatWorker(token)) stopped.abort(); }
    catch (error) { heartbeatError = error; stopped.abort(); }
  }, Math.min(options.tickMs ?? 100, 2000));
  const log = (message: string): void => { console.log(`${new Date().toISOString()} ${message}`); };
  let idleSince = Date.now();

  const executionContext = (build: BuildRecord, command: string): ExecuteContext => ({
    buildId: build.id, commandKey: command, idempotencyKey: idempotencyKey(build.id, command),
    projectRoot: project.root, store: resources,
    workDir: join(project.stateDir, "runtime", "work", build.id, idempotencyKey(build.id, command).split(":")[1]!),
    signal, log,
  });
  const accept = (build: BuildRecord, machine: BuildMachine, fact: Fact, operation?: Operation): void => {
    if (!store.ownsWorker(token)) throw new DvError("WORKER_OWNERSHIP_LOST", "The worker no longer owns this project's execution lease");
    if (fact.kind === "produced") for (const value of Object.values(fact.outputs)) validateExecutionValue(registry, value);
    if (fact.kind === "fulfilled") validateExecutionValue(registry, fact.value);
    machine.validate(fact);
    store.commitFact(build.id, fact, operation, token);
    machine.accept(fact);
    log(`${build.id} ${fact.command} ${fact.kind}`);
  };
  const fail = (build: BuildRecord, machine: BuildMachine, command: string, error: unknown, op?: Operation): void => {
    const code = error instanceof DvError ? error.code : "EXECUTION_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    if (op) { op.phase = "failed"; op.error = { code, message }; }
    accept(build, machine, { kind: "failed", command, code, message }, op);
  };
  const publications = new Map<string, Promise<void>>();
  const publish = (build: BuildRecord, machine: BuildMachine, finalize = false): Promise<void> => {
    const pending = (publications.get(build.id) ?? Promise.resolve()).then(async () => {
      if (!store.ownsWorker(token)) return;
      const existing = await results.read(build.id);
      if (!store.ownsWorker(token)) return;
      const previous = JSON.stringify(existing);
      const manifest: ResultManifest = existing ?? {
        id: build.id, title: build.title, author: build.author, run: build.run, targets: build.definition.targets,
        createdAt: build.created, completedAt: null, outcome: "open", failure: null, outputs: {}, operations: [],
      };
      for (const [name, forward] of Object.entries(build.definition.forwarded)) Object.defineProperty(manifest.outputs, name, { value: { forward }, enumerable: true, writable: true, configurable: true });
      for (const [name, binding] of Object.entries(build.definition.outputs)) {
        const value = machine.valueOf(binding.record);
        if (value) Object.defineProperty(manifest.outputs, name, { value: { type: value.type, class: valueClass(value), value: value.data }, enumerable: true, writable: true, configurable: true });
      }
      manifest.operations = store.operations(build.id).map((operation) => operationEvidence(build.definition, operation));
      const current = store.read(build.id)!;
      const failure = store.facts(build.id).find((fact) => fact.kind === "failed");
      manifest.outcome = !finalize ? "open" : current.outcome !== "open" ? current.outcome : machine.state === "failed" ? "failed" : current.cancelRequested ? "cancelled" : machine.state === "complete" ? "complete" : "open";
      if (failure?.kind === "failed") manifest.failure = { code: failure.code, message: failure.message };
      if (manifest.outcome !== "open") {
        manifest.completedAt = new Date().toISOString();
        store.decide(build.id, manifest.outcome, manifest.failure?.message ?? current.stopReason);
      }
      if (!existing || previous !== JSON.stringify(manifest)) await results.write(manifest);
      if (!store.ownsWorker(token)) return;
      if (manifest.outcome !== "open") {
        store.finish(build.id, manifest.outcome, manifest.failure?.message ?? current.stopReason);
        await rm(join(project.stateDir, "runtime", "work", build.id), { recursive: true, force: true });
        log(`${build.id} ${manifest.outcome}`);
      }
    });
    publications.set(build.id, pending);
    return pending;
  };

  try {
    // A side effect whose handle was never committed must not be issued again.
    for (const build of store.working()) {
      const machine = new BuildMachine(build.definition);
      for (const fact of store.facts(build.id)) machine.accept(fact);
      for (const op of store.operations(build.id)) {
        if (op.phase !== "submitting" || op.handle !== null) continue;
        try {
          const command = machine.ready().find(command => command.key === op.command);
          const capability = command?.kind === "fulfil" ? registry.findCapability(command.need.capability) : undefined;
          const recovered = capability?.executor.kind === "async" ? await capability.executor.recover?.(op.request, executionContext(build, op.command)) : null;
          if (recovered) { op.phase = "submitted"; op.handle = recovered.handle; op.task = recovered.task ?? null; op.receipt = recovered.receipt ?? null; op.nextWake = 0; if (!store.saveOperation(op, token)) stopped.abort(); }
          else fail(build, machine, op.command, new DvError("SUBMISSION_INTERRUPTED", "Submission ended without a persisted task handle or recoverable durable receipt; it will not be resubmitted"), op);
        } catch (error) { fail(build, machine, op.command, error, op); }
      }
    }
    while (!signal.aborted) {
      if (!store.heartbeatWorker(token)) break;
      const builds = store.working();
      if (builds.length === 0) {
        if (Date.now() - idleSince >= (options.idleTimeoutMs ?? 30_000) && store.releaseWorkerIfIdle(token)) break;
      } else idleSince = Date.now();
      const contexts: { build: BuildRecord; machine: BuildMachine }[] = [];
      const actions: (() => Promise<void>)[] = [];
      for (const build of builds) {
        const machine = new BuildMachine(build.definition);
        for (const fact of store.facts(build.id)) machine.accept(fact);
        contexts.push({ build, machine });
        if (build.cancelRequested || build.outcome !== "open" || machine.state !== "running") continue;
        let ready = machine.ready();
        while (!signal.aborted && ready.some((command) => command.kind === "produce") && machine.state === "running" && !store.read(build.id)!.cancelRequested) {
          for (const command of ready) {
            if (command.kind !== "produce" || machine.state !== "running") continue;
            try {
              const fact = await executeCommand(machine, command, {
                registry, resolveContext: { projectRoot: project.root, signal, gatewayBackend: build.definition.gatewayBackend },
                executeContext: executionContext(build, command.key),
              });
              accept(build, machine, fact);
            } catch (error) {
              if (!store.ownsWorker(token)) { stopped.abort(); break; }
              fail(build, machine, command.key, error);
            }
          }
          ready = machine.ready();
        }
        await publish(build, machine);
        for (const command of machine.ready()) {
          if (command.kind !== "fulfil") continue;
          let op = store.operations(build.id).find((item) => item.command === command.key);
          if (!op) {
            const snapshot = build.definition.gatewaySnapshots?.[command.key];
            op = { build: build.id, command: command.key, phase: "queued", request: snapshot ? frozenRequest(command.need.request, snapshot) : command.need.request, summary: {}, backend: build.definition.gatewayBackend ?? null, handle: null, task: null, receipt: null, nextWake: 0, progress: null, error: null };
            if (!store.saveOperation(op, token)) { stopped.abort(); break; }
          }
          if (op.nextWake > Date.now() || (op.phase !== "queued" && op.phase !== "submitted")) continue;
          const operation = op;
          actions.push(async () => {
            if (signal.aborted || store.read(build.id)!.cancelRequested || machine.state !== "running") return;
            const ctx = executionContext(build, command.key);
            let retrySafe = true;
            try {
              const capability = registry.findCapability(command.need.capability);
              if (!capability) throw new DvError("CAPABILITY_UNKNOWN", `Capability not found: ${command.need.capability}`);
              await mkdir(ctx.workDir, { recursive: true });
              if (operation.phase === "queued" && capability.executor.kind === "immediate") {
                const fact = await executeCommand(machine, command, {
                  registry, resolveContext: { projectRoot: project.root, signal, gatewayBackend: build.definition.gatewayBackend }, executeContext: ctx,
                  onResolved(resolution) {
                    if (signal.aborted || store.read(build.id)!.cancelRequested || machine.state !== "running") throw new DvError("ABORTED", "Command cancelled before submission");
                    operation.request = resolution.request;
                    operation.summary = resolution.summary;
                    operation.backend = resolution.backend;
                    operation.phase = "submitting";
                    if (!store.beginSubmission(operation, token)) {
                      if (!store.ownsWorker(token) || store.workerOwner()?.stopRequested) stopped.abort();
                      throw new DvError("ABORTED", "Worker submission interrupted");
                    }
                    retrySafe = false;
                  },
                });
                if (fact.kind === "failed") throw new DvError(fact.code, fact.message);
                if (!store.ownsWorker(token)) { stopped.abort(); return; }
                operation.phase = "done";
                accept(build, machine, fact, operation);
              } else if (operation.phase === "queued") {
                if (capability.executor.kind !== "async") throw new DvError("OPERATION_INVALID", "Queued operation has no asynchronous executor");
                const resolution = await capability.resolve(operation.request, { projectRoot: project.root, signal, gatewayBackend: build.definition.gatewayBackend });
                if (!resolution.ok) throw new DvError(resolution.code, resolution.reason);
                if (signal.aborted || store.read(build.id)!.cancelRequested || machine.state !== "running") return;
                operation.request = resolution.request;
                operation.summary = resolution.summary;
                operation.backend = resolution.backend;
                operation.phase = "submitting";
                if (!store.beginSubmission(operation, token)) {
                  if (!store.ownsWorker(token) || store.workerOwner()?.stopRequested) stopped.abort();
                  return;
                }
                const submitted = await capability.executor.submit(operation.request, ctx);
                if (!store.ownsWorker(token)) { stopped.abort(); return; }
                operation.handle = submitted.handle;
                operation.receipt = submitted.receipt ?? null;
                operation.task = submitted.task ?? null;
                operation.phase = "submitted";
                operation.nextWake = Date.now();
                if (!store.saveOperation(operation, token)) { stopped.abort(); return; }
              } else {
                if (capability.executor.kind !== "async" || operation.handle === null) throw new DvError("OPERATION_INVALID", "Submitted operation has no asynchronous task handle");
                const polled = await capability.executor.poll(operation.handle, ctx);
                if (!store.ownsWorker(token)) { stopped.abort(); return; }
                if (polled.receipt !== undefined) operation.receipt = polled.receipt;
                if (polled.state === "cancelled") {
                  operation.phase = "failed";
                  operation.error = { code: "GATEWAY_CANCELLED", message: "The media task was cancelled; no output is published" };
                  store.saveOperation(operation, token);
                  store.cancel(build.id, operation.error.message);
                  return;
                }
                if (store.read(build.id)!.cancelRequested) return;
                if (polled.state === "pending") {
                  operation.nextWake = Date.now() + Math.max(0, polled.retryAfterMs);
                  operation.progress = polled.progress ?? null;
                  if (!store.saveOperation(operation, token)) { stopped.abort(); return; }
                } else if (polled.state === "failed") throw new DvError(polled.code, polled.message);
                else { operation.phase = "done"; accept(build, machine, { kind: "fulfilled", command: command.key, value: polled.value }, operation); }
              }
            } catch (error) {
              if (!store.ownsWorker(token)) { stopped.abort(); return; }
              if (signal.aborted || (error instanceof Error && error.name === "AbortError") ||
                (error !== null && typeof error === "object" && "code" in error && (error.code === "ABORTED" || error.code === "ABORT_ERR"))) {
                stopped.abort();
                return;
              }
              if (retrySafe && error instanceof DvError && error.code === "GATEWAY_UNAVAILABLE" && (operation.phase === "queued" || operation.phase === "submitting")) {
                operation.phase = "queued";
                operation.nextWake = Date.now() + (options.unavailableRetryMs ?? 15_000);
                operation.progress = "Waiting for the gateway";
                if (!store.saveOperation(operation, token)) { stopped.abort(); return; }
              } else fail(build, machine, command.key, error, operation);
            }
            await publish(build, machine);
          });
        }
      }
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, actions.length) }, async () => {
        while (cursor < actions.length && !signal.aborted) { const action = actions[cursor++]!; await action(); }
      }));
      for (const { build, machine } of contexts) await publish(build, machine, true);
      if (!signal.aborted) {
        try { await sleep(Math.min(options.tickMs ?? 100, 2000), undefined, { signal }); }
        catch (error) { if (!(signal.aborted && error instanceof Error && error.name === "AbortError")) throw error; }
      }
    }
    if (heartbeatError) throw heartbeatError;
  } finally {
    clearInterval(heartbeat);
    store.releaseWorker(token);
    store.close();
  }
}
