import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DvError, spanAt } from "../core/errors.ts";
import type { AuthorGraph, InputSource, RunIntent } from "../core/graph.ts";
import type { HistoryReader } from "../core/history.ts";
import { Workspace } from "../source/workspace.ts";
import { checkRun as checkRunWithRegistry, planRun as planRunWithRegistry } from "./plan.ts";
import { BuildMachine } from "../core/machine.ts";
import { isResourceRef } from "../core/value.ts";
import type { ModuleDef } from "../core/module.ts";
import { readRun } from "../run/parse.ts";

const testModule: ModuleDef = {
  id: "media@1", summary: "Inline test media", surfaces: {}, producers: {},
  types: { Image: { summary: "Inline string or image resource", validate(data) {
    if (typeof data !== "string" && !(isResourceRef(data) && data.mime === "image/png")) throw new DvError("TYPE_INVALID", "Expected inline text or an image/png resource");
  } } },
};
const registry = { findModule: (id: string) => id === testModule.id ? testModule : undefined, findProducer: () => undefined, findFrontend: () => undefined };
function planRun(run: RunIntent, author: AuthorGraph, history: HistoryReader, workspace: Workspace) {
  return planRunWithRegistry(run, author, history, workspace, registry);
}
function checkRun(run: RunIntent, author: AuthorGraph, workspace: Workspace) {
  return checkRunWithRegistry(run, author, workspace, registry);
}

const image = "media@1#Image";
function fixture(t: test.TestContext) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dv-plan-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const span = spanAt(join(dir, "main.dvml"), "", 0);
  const author: AuthorGraph = { source: span.file, sources: [span.file], records: new Map(), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: ["unused@1", "media@1"] };
  author.records.set("prompt", { key: "prompt", value: { type: "text@1#Text", data: "sunlight" }, span });
  author.records.set("unused-record", { key: "unused-record", value: { type: "unused@1#Text", data: "unused" }, span });
  for (const key of ["hero", "video", "unreachable"]) {
    const inputs: Record<string, InputSource> = key === "video" ? { frame: { operation: "hero", port: "result" } } : { prompt: { record: key === "hero" ? "prompt" : "unused-record" } };
    author.operations.set(key, { key, producer: `media@1#${key}`, label: key, inputs, outputs: { result: image }, span });
    author.outputs.set(key, { name: key, type: image, operation: key, port: "result" });
  }
  const run: RunIntent = { file: join(dir, "main.dvrun"), author: span.file, targets: ["video"], targetSpans: new Map(), candidates: new Map(), satisfy: new Map(), satisfySpans: new Map() };
  const calls: string[] = [];
  const history: HistoryReader = { async readOutput(build, output) { calls.push(`${build}:${output}`); return { type: image, value: { type: image, data: { $resource: "res_history", bytes: 3, mime: "image/png" } } }; } };
  return { dir, span, author, run, history, calls, workspace: Workspace.open({ cwd: dir }) };
}

test("reverse reachability prunes operations, records and modules", async (t) => {
  const f = fixture(t);
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  assert.deepEqual(plan.definition.steps.map((step) => step.key), ["hero", "video"]);
  assert.deepEqual(Object.keys(plan.definition.seeds), ["prompt"]);
  assert.deepEqual(Object.keys(plan.definition.outputs).sort(), ["hero", "video"]);
  assert.deepEqual(plan.definition.modules, ["media@1", "text@1"]);
  assert.deepEqual(plan.unreachable, [{ key: "unreachable", label: "unreachable" }]);
});

test("file satisfaction cuts upstream work and registers bytes for submit", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, "frame.png"), "png bytes");
  f.run.candidates.set("fixed", { kind: "file", name: "fixed", path: join(f.dir, "frame.png"), mime: "image/png", type: image, span: f.span });
  f.run.satisfy.set("hero", "fixed");
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  assert.deepEqual(plan.definition.steps.map((step) => step.key), ["video"]);
  assert.deepEqual(Object.keys(plan.definition.seeds), [plan.definition.outputs.hero!.record]);
  const asset = [...plan.assets.values()][0]!;
  assert.equal(asset.path, join(f.dir, "frame.png"));
  assert.equal(asset.ref.bytes, 9);
  assert.deepEqual(plan.definition.seeds[plan.definition.outputs.hero!.record]!.data, asset.ref);
  assert.deepEqual(plan.overrides, [{ output: "hero", candidate: "fixed" }]);
});

test("stored values require their type wrapper and match exact types", async (t) => {
  const f = fixture(t);
  const path = join(f.dir, "value.json");
  f.run.candidates.set("fixed", { kind: "value", name: "fixed", path, type: image, span: f.span });
  f.run.satisfy.set("hero", "fixed");
  writeFileSync(path, JSON.stringify({ type: image, data: "stored" }));
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  assert.equal(plan.definition.seeds[plan.definition.outputs.hero!.record]!.data, "stored");
  writeFileSync(path, JSON.stringify({ type: "other@1#Image", data: "wrong" }));
  await assert.rejects(planRun(f.run, f.author, f.history, f.workspace), { code: "CANDIDATE_RESULT_TYPE_MISMATCH" });
  writeFileSync(path, JSON.stringify("bare"));
  await assert.rejects(planRun(f.run, f.author, f.history, f.workspace), { code: "RUN_VALUE" });
});

test("history consumed by another step becomes a reused seed", async (t) => {
  const f = fixture(t);
  f.run.candidates.set("old", { kind: "build", name: "old", build: "previous", output: "saved", span: f.span });
  f.run.satisfy.set("hero", "old");
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  const record = plan.definition.outputs.hero!.record;
  assert.deepEqual(plan.definition.steps.map((step) => step.key), ["video"]);
  assert.deepEqual(plan.definition.reused[record], { build: "previous", output: "saved" });
  assert.equal(plan.assets.size, 0);
  assert.deepEqual(f.calls, ["previous:saved"]);
  assert.deepEqual(plan.definition.forwarded, {});
  assert.equal(new BuildMachine(plan.definition).ready()[0]!.step, "video");
});

test("whole historical target is forwarded without seeds or steps", async (t) => {
  const f = fixture(t);
  f.run.candidates.set("old", { kind: "build", name: "old", build: "previous", output: "saved", span: f.span });
  f.run.satisfy.set("video", "old");
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  assert.deepEqual(plan.definition.forwarded, { video: { build: "previous", output: "saved" } });
  assert.deepEqual(plan.definition.seeds, {});
  assert.deepEqual(plan.definition.steps, []);
  assert.deepEqual(plan.definition.reused, {});
  assert.equal(new BuildMachine(plan.definition).state, "complete");
});

test("unused bad candidates stay inert, unknown targets and wrong candidates fail", async (t) => {
  const f = fixture(t);
  f.run.candidates.set("unused", { kind: "value", name: "unused", type: image, path: "./missing.json", span: f.span });
  await planRun(f.run, f.author, f.history, f.workspace);
  f.run.targets = ["missing"];
  await assert.rejects(planRun(f.run, f.author, f.history, f.workspace), { code: "UNKNOWN_AUTHOR_OUTPUT" });
  f.run.targets = ["video"];
  f.run.candidates.set("wrong", { kind: "file", name: "wrong", type: "other@1#Image", path: "./missing.png", mime: "image/png", span: f.span });
  f.run.satisfy.set("hero", "wrong");
  await assert.rejects(planRun(f.run, f.author, f.history, f.workspace), { code: "CANDIDATE_RESULT_TYPE_MISMATCH" });
});

test("selected candidate symlinks cannot escape workspace", async (t) => {
  const f = fixture(t);
  const external = mkdtempSync(join(tmpdir(), "dv-outside-"));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(join(external, "frame.png"), "bytes");
  symlinkSync(join(external, "frame.png"), join(f.dir, "escape.png"));
  f.run.candidates.set("escape", { kind: "file", name: "escape", type: image, path: "./escape.png", mime: "image/png", span: f.span });
  f.run.satisfy.set("hero", "escape");
  await assert.rejects(planRun(f.run, f.author, f.history, f.workspace), { code: "SOURCE_ASSET_OUTSIDE_ROOT" });
});

test("reachable authored assets are retained and unused resources are pruned", async (t) => {
  const f = fixture(t);
  const used = { $resource: "res_used", bytes: 2, mime: "text/plain" };
  const unused = { $resource: "res_unused", bytes: 4, mime: "text/plain" };
  f.author.records.get("prompt")!.value.data = used;
  f.author.records.get("unused-record")!.value.data = unused;
  f.author.assets.set(used.$resource, { path: join(f.dir, "used.txt"), ref: used });
  f.author.assets.set(unused.$resource, { path: join(f.dir, "unused.txt"), ref: unused });
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  assert.deepEqual([...plan.assets.keys()], ["res_used"]);
});

test("history with an incompatible exact type cannot satisfy a target", async (t) => {
  const f = fixture(t);
  f.run.candidates.set("old", { kind: "build", name: "old", build: "old", output: "saved", span: f.span });
  f.run.satisfy.set("video", "old");
  const wrongHistory: HistoryReader = { async readOutput() { return { type: "other@1#Image", value: { type: "other@1#Image", data: "wrong" } }; } };
  await assert.rejects(planRun(f.run, f.author, wrongHistory, f.workspace), { code: "CANDIDATE_RESULT_TYPE_MISMATCH" });
});

test("a historical target consumed downstream is a seed, regardless of target order", async (t) => {
  const f = fixture(t);
  f.run.candidates.set("old", { kind: "build", name: "old", build: "old", output: "saved", span: f.span });
  f.run.satisfy.set("hero", "old");
  for (const targets of [["hero", "video"], ["video", "hero"]]) {
    f.run.targets = targets;
    const plan = await planRun(f.run, f.author, f.history, f.workspace);
    assert.deepEqual(plan.definition.forwarded, {});
    assert.deepEqual(plan.definition.reused[plan.definition.outputs.hero!.record], { build: "old", output: "saved" });
    assert.deepEqual(plan.definition.steps.map((step) => step.key), ["video"]);
  }
});

test("shared dependencies in list ports do not become false cycles", async (t) => {
  const f = fixture(t);
  f.author.operations.get("video")!.inputs = { frames: [{ operation: "hero", port: "result" }, { operation: "hero", port: "result" }] };
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  assert.deepEqual(plan.definition.steps.find((step) => step.key === "video")!.inputs.frames, ["hero.result", "hero.result"]);
});

test("overriding one result does not collide with another result of a shared operation", async (t) => {
  const f = fixture(t);
  f.author.operations.get("hero")!.outputs.extra = image;
  f.author.outputs.set("extra", { name: "extra", type: image, operation: "hero", port: "extra" });
  f.run.targets = ["hero", "extra"];
  writeFileSync(join(f.dir, "frame.png"), "png");
  f.run.candidates.set("fixed", { kind: "file", name: "fixed", path: "./frame.png", mime: "image/png", type: image, span: f.span });
  f.run.satisfy.set("hero", "fixed");
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  const machine = new BuildMachine(plan.definition);
  machine.accept({ kind: "produced", command: "produce:hero", outputs: { extra: { type: image, data: "selected" } }, needs: { result: { capability: "never-execute", request: {} } } });
  assert.equal(machine.state, "complete");
  assert.equal(machine.valueOf(plan.definition.outputs.extra!.record)!.data, "selected");
  assert.notEqual(machine.valueOf(plan.definition.outputs.hero!.record)!.data, "unselected");
  assert.throws(() => machine.accept({ kind: "fulfilled", command: "fulfil:hero.result", value: { type: image, data: "unselected" } }), { code: "MACHINE_UNKNOWN_COMMAND" });
});

test("prototype-named public targets remain pending until their real output exists", async (t) => {
  const f = fixture(t);
  f.author.outputs.set("__proto__", { name: "__proto__", type: image, operation: "hero", port: "result" });
  f.run.targets = ["__proto__"];
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  const machine = new BuildMachine(plan.definition);
  assert.equal(machine.state, "running");
  machine.accept({ kind: "produced", command: "produce:hero", outputs: { result: { type: image, data: "real" } }, needs: {} });
  assert.equal(machine.state, "complete");
  assert.equal(machine.valueOf(plan.definition.outputs.__proto__!.record)!.data, "real");
  f.run.candidates.set("old", { kind: "build", name: "old", build: "old", output: "saved", span: f.span });
  f.run.satisfy.set("__proto__", "old");
  const forwarded = await planRun(f.run, f.author, f.history, f.workspace);
  assert.deepEqual(JSON.parse(JSON.stringify(forwarded.definition.forwarded)), JSON.parse('{"__proto__":{"build":"old","output":"saved"}}'));
  assert.equal(new BuildMachine(forwarded.definition).state, "complete");
});

test("structural checks retain selected history obligations without reading history", (t) => {
  const f = fixture(t);
  f.run.candidates.set("old", { kind: "build", name: "old", build: "not-created", output: "saved", span: f.span });
  f.run.candidates.set("unused", { kind: "value", name: "unused", type: image, path: "./missing.json", span: f.span });
  f.run.satisfy.set("hero", "old");
  const checked = checkRun(f.run, f.author, f.workspace);
  assert.deepEqual(checked.targets, ["video"]);
  assert.deepEqual(checked.overrides, [{ output: "hero", candidate: "old" }]);
  assert.deepEqual(checked.unresolvedHistory, [{ output: "hero", candidate: "old", type: image, build: "not-created", sourceOutput: "saved" }]);
  assert.equal("definition" in checked, false);
});

test("structural checks validate local branches after deferred history", (t) => {
  const f = fixture(t);
  f.run.candidates.set("old", { kind: "build", name: "old", build: "not-created", output: "saved", span: f.span });
  f.run.satisfy.set("hero", "old");
  f.author.operations.get("video")!.inputs.texture = { operation: "unreachable", port: "result" };
  f.run.candidates.set("local", { kind: "value", name: "local", type: image, path: "./local.json", span: f.span });
  f.run.satisfy.set("unreachable", "local");
  writeFileSync(join(f.dir, "local.json"), JSON.stringify("not a stored value"));
  assert.throws(() => checkRun(f.run, f.author, f.workspace), { code: "RUN_VALUE" });
  writeFileSync(join(f.dir, "local.json"), JSON.stringify({ type: image, data: "valid" }));
  assert.deepEqual(checkRun(f.run, f.author, f.workspace).overrides, [{ output: "hero", candidate: "old" }, { output: "unreachable", candidate: "local" }]);
});

test("candidate/output names cannot collide through colon-delimited identities", async (t) => {
  const f = fixture(t);
  f.author.outputs = new Map([
    ["z.image", { name: "z.image", type: image, operation: "hero", port: "result" }],
    ["y:z.image", { name: "y:z.image", type: image, operation: "video", port: "result" }],
  ]);
  f.run.targets = ["z.image", "y:z.image"];
  for (const [candidate, output, data] of [["x:y", "z.image", "first"], ["x", "y:z.image", "second"]] as const) {
    const path = join(f.dir, `${data}.json`);
    writeFileSync(path, JSON.stringify({ type: image, data }));
    f.run.candidates.set(candidate, { kind: "value", name: candidate, path, type: image, span: f.span });
    f.run.satisfy.set(output, candidate);
  }
  const plan = await planRun(f.run, f.author, f.history, f.workspace);
  const first = plan.definition.outputs["z.image"]!.record;
  const second = plan.definition.outputs["y:z.image"]!.record;
  assert.notEqual(first, second);
  assert.equal(plan.definition.seeds[first]!.data, "first");
  assert.equal(plan.definition.seeds[second]!.data, "second");
});

test("a different seed cannot overwrite an existing selected record binding", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, "fixed.json"), JSON.stringify({ type: image, data: "selected" }));
  f.run.candidates.set("fixed", { kind: "value", name: "fixed", path: "./fixed.json", type: image, span: f.span });
  f.run.satisfy.set("hero", "fixed");
  const first = await planRun(f.run, f.author, f.history, f.workspace);
  const record = first.definition.outputs.hero!.record;
  f.author.records.set(record, { key: record, value: { type: image, data: "overwrite" }, span: f.span });
  f.author.operations.get("video")!.inputs.extra = { record };
  await assert.rejects(planRun(f.run, f.author, f.history, f.workspace), { code: "DUPLICATE_RECORD" });
});

test("selected candidates execute the real type owner's validator", async (t) => {
  const f = fixture(t);
  const realImage = "dsivio-video/media@1#Image";
  f.author.outputs.get("hero")!.type = realImage;
  f.author.operations.get("hero")!.outputs.result = realImage;
  writeFileSync(join(f.dir, "bad.mp4"), "video bytes");
  f.run.candidates.set("bad", { kind: "file", name: "bad", path: "./bad.mp4", type: realImage, mime: "video/mp4", span: f.span });
  f.run.satisfy.set("hero", "bad");
  await assert.rejects(planRunWithRegistry(f.run, f.author, f.history, f.workspace), { code: "TYPE_REFINEMENT_REJECTED" });
  writeFileSync(join(f.dir, "bad.json"), JSON.stringify({ type: realImage, data: "not an image" }));
  f.run.candidates.set("bad", { kind: "value", name: "bad", path: "./bad.json", type: realImage, span: f.span });
  await assert.rejects(planRunWithRegistry(f.run, f.author, f.history, f.workspace), { code: "TYPE_REFINEMENT_REJECTED" });
  assert.throws(() => checkRunWithRegistry(f.run, f.author, f.workspace), { code: "TYPE_REFINEMENT_REJECTED" });
});

test("directories cannot become file or value candidates", async (t) => {
  const f = fixture(t);
  for (const kind of ["file", "value"] as const) {
    f.run.candidates.set("directory", kind === "file" ? { kind, name: "directory", path: "./", type: image, mime: "image/png", span: f.span } : { kind, name: "directory", path: "./", type: image, span: f.span });
    f.run.satisfy.set("hero", "directory");
    await assert.rejects(planRun(f.run, f.author, f.history, f.workspace), { code: "SOURCE_ASSET_NOT_FILE" });
  }
});

test("unknown run names point to their target or satisfy declaration", async (t) => {
  const f = fixture(t);
  writeFileSync(f.author.source, "author");
  const header = '<?dvml using="dsivio-video/run@1"?>\n<dvrun version="1">\n<author source="./main.dvml"/>\n';
  writeFileSync(f.run.file, `${header}<target output="missing"/>\n</dvrun>`);
  const unknownTarget = readRun(f.run.file, f.workspace);
  await assert.rejects(planRun(unknownTarget, f.author, f.history, f.workspace), (error) => error instanceof DvError && error.code === "UNKNOWN_AUTHOR_OUTPUT" && error.span?.file === unknownTarget.file && error.span.line === 4);
  writeFileSync(f.run.file, `${header}<target output="video"/>\n<satisfy output="missing" candidate="old"/>\n</dvrun>`);
  const unknownSatisfaction = readRun(f.run.file, f.workspace);
  assert.throws(() => checkRun(unknownSatisfaction, f.author, f.workspace), (error) => error instanceof DvError && error.code === "UNKNOWN_AUTHOR_OUTPUT" && error.span?.line === 5);
  writeFileSync(f.run.file, `${header}<target output="video"/>\n<satisfy output="hero" candidate="missing"/>\n</dvrun>`);
  const unknownCandidate = readRun(f.run.file, f.workspace);
  assert.throws(() => checkRun(unknownCandidate, f.author, f.workspace), (error) => error instanceof DvError && error.code === "UNKNOWN_CANDIDATE" && error.span?.line === 5);
});

test("selected values can be read from explicit asset roots with strict UTF-8", async (t) => {
  const f = fixture(t);
  const assets = realpathSync(mkdtempSync(join(tmpdir(), "dv-value-assets-")));
  t.after(() => rmSync(assets, { recursive: true, force: true }));
  const path = join(assets, "stored.json");
  const workspace = Workspace.open({ cwd: f.dir, assetRoots: [assets] });
  writeFileSync(path, JSON.stringify({ type: image, data: "external" }));
  f.run.candidates.set("external", { kind: "value", name: "external", path, type: image, span: f.span });
  f.run.satisfy.set("hero", "external");
  const plan = await planRun(f.run, f.author, f.history, workspace);
  assert.equal(plan.definition.seeds[plan.definition.outputs.hero!.record]!.data, "external");
  writeFileSync(path, Buffer.from([123, 34, 116, 121, 112, 101, 34, 58, 34, 255, 34, 125]));
  await assert.rejects(planRun(f.run, f.author, f.history, workspace), { code: "RUN_VALUE" });
});
