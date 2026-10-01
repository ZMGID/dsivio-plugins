import { BuildStore, WORKER_LEASE_MS } from "./store.ts";
import { operationEvidence, ResultsRepository } from "./results.ts";
import { workerWorkspace } from "./worker.ts";
import type { BuildWorkspace } from "./worker.ts";
import type { OperationEvidence, ResultManifest } from "./results.ts";
import type { Fact } from "../core/graph.ts";
import { DvError } from "../core/errors.ts";
import { BuildMachine } from "../core/machine.ts";

export interface BuildView {
  id: string;
  title: string | null;
  targets: string[];
  work: { state: "unknown" | "submitting" | "working" | "done"; outcome: ResultManifest["outcome"]; stopReason: string | null; cancelRequested: boolean; needs: { total: number; done: number }; steps: { total: number; done: number } };
  result: { state: "missing" | "unavailable" | ResultManifest["outcome"]; outputTotal: number };
  operations: OperationEvidence[];
  operationGroups: { backend: string | null; phase: string; progress: string | null; error: string | null; total: number }[];
  attention: string[];
  remoteCancellation: string;
  failure: { code: string; message: string } | null;
}

export interface WorkerState { running: boolean; pid: number | null; startedAt: string | null; heartbeatAt: number | null; stopRequested: boolean }
export interface ActivityView {
  schema: string;
  observedAt: string;
  workerState: WorkerState;
  activeBuilds: BuildView[];
  hiddenBuildTotal: number;
}

export async function workerState(workspace: BuildWorkspace | string): Promise<WorkerState> {
  const store = new BuildStore(workerWorkspace(workspace).stateDir);
  try {
    const owner = store.workerOwner();
    return { running: !!owner && owner.heartbeatAt >= Date.now() - WORKER_LEASE_MS, pid: owner?.pid ?? null, startedAt: owner?.startedAt ?? null, heartbeatAt: owner?.heartbeatAt ?? null, stopRequested: owner?.stopRequested ?? false };
  } finally { store.close(); }
}

export async function buildView(buildId: string, workspace: BuildWorkspace | string): Promise<BuildView | null> {
  const project = workerWorkspace(workspace);
  const store = new BuildStore(project.stateDir);
  try {
    const build = store.read(buildId);
    const attention: string[] = [];
    let result: ResultManifest | undefined;
    let unavailable = false;
    try { result = await new ResultsRepository(project.stateDir).read(buildId); }
    catch (error) {
      if (!(error instanceof DvError)) throw error;
      unavailable = true;
      attention.push(`Result unavailable: ${error.message}. Repair the result file; do not resubmit generation.`);
    }
    if (!build && !result && !unavailable) return null;
    const facts = store.facts(buildId);
    const operations = store.operations(buildId);
    const groups: BuildView["operationGroups"] = [];
    for (const op of operations) {
      const group = groups.find((item) => item.backend === op.backend && item.phase === op.phase && item.progress === op.progress && item.error === (op.error?.code ?? null));
      if (group) group.total++;
      else groups.push({ backend: op.backend, phase: op.phase, progress: op.progress, error: op.error?.code ?? null, total: 1 });
    }
    if (build?.state === "working" && build.outcome !== "open") attention.push("The outcome is decided but the result is not finalized. Repair result storage and restart the runtime; generation will not run again.");
    else if (build?.state === "working" && !(await workerState(project)).running) attention.push("Worker is stopped. Start the runtime to resume persisted tasks.");
    const failure = facts.find((fact): fact is Extract<Fact, { kind: "failed" }> => fact.kind === "failed");
    const needTotal = facts.reduce((total, fact) => {
      if (fact.kind !== "produced") return total;
      const step = build?.definition.steps.find((item) => fact.command === `produce:${item.key}`);
      return total + Object.keys(fact.needs).filter((port) => step && Object.hasOwn(step.results, port)).length;
    }, 0);
    const machine = build ? new BuildMachine(build.definition) : undefined;
    if (machine) for (const fact of facts) machine.accept(fact);
    const stepTotal = build?.definition.steps.length ?? 0;
    const produced = new Set(facts.filter((fact) => fact.kind === "produced").map((fact) => fact.command));
    const stepDone = build?.definition.steps.filter((step) => produced.has(`produce:${step.key}`) && Object.values(step.results).every((record) => machine?.valueOf(record) !== undefined)).length ?? 0;
    return {
      id: buildId, title: build?.title ?? result?.title ?? null, targets: build?.definition.targets ?? result?.targets ?? [],
      work: { state: build?.state === "staged" ? "submitting" : build?.state ?? "unknown", outcome: failure ? "failed" : build?.outcome ?? result?.outcome ?? "open", stopReason: build?.stopReason ?? null, cancelRequested: build?.cancelRequested ?? false,
        needs: { total: needTotal, done: facts.filter((fact) => fact.kind === "fulfilled").length }, steps: { total: stepTotal, done: stepDone } },
      result: { state: unavailable ? "unavailable" : result?.outcome ?? "missing", outputTotal: result ? Object.keys(result.outputs).length : 0 },
      operations: build ? operations.map((operation) => operationEvidence(build.definition, operation)) : result?.operations ?? [], operationGroups: groups, attention,
      remoteCancellation: "Build cancellation stops consuming media tasks; cancel an individual task explicitly through its gateway. It does not imply remote cancellation or a refund.",
      failure: result?.failure ?? (failure ? { code: failure.code, message: failure.message } : null),
    };
  } finally { store.close(); }
}

export async function activity(workspace: BuildWorkspace | string, options: { limit?: number } = {}): Promise<ActivityView> {
  const project = workerWorkspace(workspace);
  const store = new BuildStore(project.stateDir);
  let ids: string[];
  try { ids = store.working().map((build) => build.id); } finally { store.close(); }
  const rows = await Promise.all(ids.slice(0, options.limit ?? 20).map((id) => buildView(id, project)));
  return { schema: "dsivio-video.activity/1", observedAt: new Date().toISOString(), workerState: await workerState(project), activeBuilds: rows.filter((row): row is BuildView => row !== null), hiddenBuildTotal: Math.max(0, ids.length - (options.limit ?? 20)) };
}

export async function cancelBuild(id: string, reason: string, workspace: BuildWorkspace | string): Promise<{ cancelRequested: boolean; buildView: BuildView | null }> {
  const project = workerWorkspace(workspace);
  const store = new BuildStore(project.stateDir);
  let requested = false;
  try {
    if (!store.facts(id).some((fact) => fact.kind === "failed")) requested = store.cancel(id, reason);
  } finally { store.close(); }
  return { cancelRequested: requested, buildView: await buildView(id, project) };
}
