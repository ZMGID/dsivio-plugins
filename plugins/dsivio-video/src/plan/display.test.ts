import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthorGraph, RunIntent } from "../core/graph.ts";
import type { ModuleDef } from "../core/module.ts";
import type { HistoryReader } from "../core/history.ts";
import { spanAt } from "../core/errors.ts";
import { BuildMachine } from "../core/machine.ts";
import { Workspace } from "../source/workspace.ts";
import { planDisplayRun } from "./display.ts";

const module: ModuleDef = { id: "test@1", summary: "Display selection fixture", types: { Text: { summary: "text", validate(data) { assert.equal(typeof data, "string"); } } }, surfaces: {}, producers: {} };
const registry = { findModule: (id: string) => id === module.id ? module : undefined, findProducer: () => undefined, findFrontend: () => undefined };
const history: HistoryReader = { async readOutput() { return undefined; } };
function fixture(t: test.TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dv-display-plan-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const span = spanAt(join(root, "main.dvml"), "", 0); const type = "test@1#Text";
  const graph: AuthorGraph = { source: span.file, sources: [span.file], records: new Map([["clock", { key: "clock", value: { type, data: "30" }, span }]]), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: [module.id] };
  graph.operations.set("track", { key: "track", producer: "test@1#track", label: "track", inputs: { clock: { record: "clock" } }, outputs: { visual: type }, span });
  graph.operations.set("film", { key: "film", producer: "test@1#film", label: "film", inputs: { track: { operation: "track", port: "visual" } }, outputs: { composition: type }, span });
  graph.operations.set("encode", { key: "encode", producer: "test@1#encode", label: "encode", inputs: { composition: { operation: "film", port: "composition" } }, outputs: { video: type }, span });
  graph.outputs.set("track.visual", { name: "track.visual", type, operation: "track", port: "visual" });
  graph.outputs.set("film.composition", { name: "film.composition", type, operation: "film", port: "composition" });
  graph.outputs.set("delivery.video", { name: "delivery.video", type, operation: "encode", port: "video" });
  const run: RunIntent = { file: join(root, "main.dvrun"), author: span.file, targets: ["delivery.video"], targetSpans: new Map(), candidates: new Map(), satisfy: new Map(), satisfySpans: new Map() };
  return { root, span, type, graph, run, workspace: Workspace.open({ cwd: root, workspace: root }) };
}
test("display machine completes on explicit roots without executing the encoding target", async t => {
  const f = fixture(t);
  const plan = await planDisplayRun(f.run, f.graph, history, f.workspace, [{ operation: "film", port: "composition" }, { record: "clock" }], registry);
  assert.deepEqual(f.run.targets, ["delivery.video"]);
  assert.deepEqual(plan.definition.steps.map(step => step.key), ["film", "track"]);
  const machine = new BuildMachine(plan.definition);
  machine.accept({ kind: "produced", command: "produce:track", outputs: { visual: { type: f.type, data: "picture" } }, needs: {} });
  machine.accept({ kind: "produced", command: "produce:film", outputs: { composition: { type: f.type, data: "composition" } }, needs: {} });
  assert.equal(machine.state, "complete");
});
test("Candidate override remains a seed and provenance does not resurrect bypassed author work", async t => {
  const f = fixture(t); const candidateFile = join(f.root, "stored.json"); writeFileSync(candidateFile, JSON.stringify({ type: f.type, data: "selected" }));
  f.run.candidates.set("chosen", { kind: "value", name: "chosen", path: candidateFile, type: f.type, span: f.span }); f.run.satisfy.set("track.visual", "chosen");
  const plan = await planDisplayRun(f.run, f.graph, history, f.workspace, [{ operation: "film", port: "composition" }], registry);
  assert.deepEqual(plan.definition.steps.map(step => step.key), ["film"]);
  assert.deepEqual(plan.overrides, [{ output: "track.visual", candidate: "chosen" }]);
  assert.deepEqual(plan.executionEdges, [{ operation: "film", port: "track", source: { record: plan.definition.outputs["track.visual"]!.record } }]);
  const machine = new BuildMachine(plan.definition);
  const consumed = machine.inputsFor("film").track;
  assert(consumed && !Array.isArray(consumed) && "data" in consumed);
  assert.equal(consumed.data, "selected");
});
