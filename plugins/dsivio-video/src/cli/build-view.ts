import { setTimeout as sleep } from "node:timers/promises";
import { buildView, workerState } from "../build/observe.ts";
import type { BuildView } from "../build/observe.ts";
import type { Workspace } from "../source/workspace.ts";
import type { CliOptions } from "./options.ts";

export function publicBuildView(view: BuildView | null, options: CliOptions) {
  if (!view) return null;
  const { operations, ...summary } = view;
  return { ...summary, ...(options.verbose ? { operations: operations.slice(0, options.limit), omittedOperations: Math.max(0, operations.length - options.limit) } : {}) };
}
export function buildLines(view: BuildView, options: CliOptions): string[] {
  const lines = [`Build: ${view.id}${view.title ? ` — ${view.title}` : ""}`, `Targets: ${view.targets.join(", ")}`, `Work: ${view.work.state}; result: ${view.result.state}`, `Steps: ${view.work.steps.done}/${view.work.steps.total}`, ...(view.work.state === "done" || ["complete", "failed", "cancelled"].includes(view.result.state) ? [`Needs: ${view.work.needs.done}/${view.work.needs.total}`] : [`Needs completed: ${view.work.needs.done} (${view.work.needs.total} discovered so far)`]), ...view.operationGroups.map((group) => `  ${group.backend ?? "local"}: ${group.phase} (${group.total})${group.progress ? ` — ${group.progress}` : ""}${group.error ? ` — ${group.error}` : ""}`), ...(view.failure ? [`${view.failure.code}: ${view.failure.message}`] : []), ...view.attention.map((hint) => `Attention: ${hint}`)];
  if (options.verbose) {
    for (const operation of view.operations.slice(0, options.limit)) lines.push(`  operation ${operation.command}: ${operation.phase}; backend ${operation.backend ?? "local"}${operation.progress ? `; ${operation.progress}` : ""}${operation.receipt ? `; receipt ${operation.receipt}` : ""}${operation.error ? `; ${operation.error.code}: ${operation.error.message}` : ""}`);
    if (view.operations.length > options.limit) lines.push(`  … ${view.operations.length - options.limit} operations omitted`);
  }
  return lines;
}
export async function followBuild(id: string, workspace: Workspace, maxWaitMs: number): Promise<BuildView | null> {
  const deadline = Date.now() + maxWaitMs;
  let previous = "";
  while (true) {
    const view = await buildView(id, workspace);
    if (!view) return null;
    const operations = view.operationGroups.map((group) => `${group.backend ?? "local"} ${group.phase} (${group.total})${group.progress ? ` ${group.progress}` : ""}`).join("; ");
    const progress = `${view.work.state} ${view.result.state}${operations ? `; ${operations}` : ""}; steps ${view.work.steps.done}/${view.work.steps.total}`;
    if (progress !== previous) { process.stderr.write(`Build ${id}: ${progress}\n`); previous = progress; }
    if (view.work.state === "done" || ["complete", "failed", "cancelled"].includes(view.result.state) || view.attention.length || Date.now() >= deadline) return view;
    if (!(await workerState(workspace)).running) { view.attention.push("Worker stopped; run dsivio-video runtime up."); return view; }
    await sleep(Math.min(250, Math.max(0, deadline - Date.now())));
  }
}
