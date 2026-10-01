import type { AuthorGraph, InputSource, RunIntent } from "../core/graph.ts";
import type { HistoryReader } from "../core/history.ts";
import type { AuthorRegistry } from "../elaborate/compile.ts";
import type { Workspace } from "../source/workspace.ts";
import type { ExecutionEdge } from "../studio/companion.ts";
import { planRun } from "./plan.ts";
import type { Plan } from "./plan.ts";
import * as builtins from "../modules/index.ts";

export interface DisplayPlan extends Plan { rootRecords: string[]; executionEdges: readonly ExecutionEdge[] }
/** Candidate selection and dependency pruning are shared with the ordinary Run planner. */
export async function planDisplayRun(run: RunIntent, author: AuthorGraph, history: HistoryReader, workspace: Workspace, roots: readonly InputSource[], registry: AuthorRegistry = builtins): Promise<DisplayPlan> {
  const plan = await planRun(run, author, history, workspace, registry, roots);
  // Only the display roots determine machine completion; the author's Run is never rewritten.
  plan.definition.targets = roots.map((root, index) => {
    const name = `__display_${index}`;
    const type = "record" in root ? author.records.get(root.record)!.value.type : author.operations.get(root.operation)!.outputs[root.port]!;
    plan.definition.outputs[name] = { record: plan.rootRecords![index]!, type };
    return name;
  });
  const executionEdges: ExecutionEdge[] = [];
  for (const step of plan.definition.steps) {
    const operation = author.operations.get(step.key)!;
    for (const [port, records] of Object.entries(step.inputs)) {
      const original = operation.inputs[port]!;
      const sources = Array.isArray(original) ? original : [original];
      const selected = Array.isArray(records) ? records : [records];
      selected.forEach((record, index) => {
        // A selected Candidate is a seed, not an edge to the bypassed author operation.
        const source: InputSource = Object.hasOwn(plan.definition.seeds, record) || Object.hasOwn(plan.definition.reused, record)
          ? { record } : sources[index]!;
        executionEdges.push({ operation: step.key, port, ...(Array.isArray(records) ? { index } : {}), source });
      });
    }
  }
  return { ...plan, rootRecords: plan.rootRecords!, executionEdges };
}
