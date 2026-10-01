import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DvError } from "../core/errors.ts";
import type { ModuleDef, SurfaceDef, Binding } from "../core/module.ts";
import type { ElementNode, RawElement } from "../markup/ast.ts";
import { Workspace } from "../source/workspace.ts";
import { compileAuthor, compileAuthorDetailed } from "./compile.ts";
import { isResourceRef } from "../core/value.ts";

const type = "test@1#Text";
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "dv-compile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let compiledSheets = 0;
  const attr = (node: ElementNode | RawElement, name: string) => node.attributes.find((attr) => attr.name === name)!.value;
  const literal = (node: ElementNode | RawElement, name: string) => { const value = attr(node, name); assert.equal(value.kind, "literal"); return value.kind === "literal" ? value.text : ""; };
  const doc = { summary: "Test", attributes: [], outputs: [] };
  const value: SurfaceDef = { mode: "structured", doc, elaborate(node, ctx) { ctx.record(literal(node, "id"), { type, data: literal(node, "value") }, node.span); } };
  const copy: SurfaceDef = { mode: "structured", doc, elaborate(node, ctx) { const ref = attr(node, "input"); assert.equal(ref.kind, "ref"); const input = ctx.lookup(ref.kind === "ref" ? ref.name : "", ref.span); ctx.operation({ producer: "test@1#copy", label: literal(node, "id"), inputs: { input }, publish: { result: literal(node, "id") }, span: node.span }); } };
  const module: ModuleDef = { id: "test@1", summary: "Test", types: {
    Text: { summary: "Text", validate(data) { if (typeof data !== "string") throw new Error("expected text"); } },
    Other: { summary: "Other nominal text", validate(data) { if (typeof data !== "string") throw new Error("expected other text"); } },
    Asset: { summary: "Asset", validate(data) { if (!isResourceRef(data)) throw new Error("expected resource"); } },
  }, surfaces: { Value: value, Copy: copy,
    Bad: { mode: "structured", doc, elaborate(node, ctx) { ctx.record("bad", { type, data: 7 }, node.span); } },
    Wrong: { mode: "structured", doc, elaborate(node, ctx) { const input = ctx.record(null, { type: "test@1#Other", data: "x" }, node.span); ctx.operation({ producer: "test@1#copy", label: "wrong", inputs: { input }, publish: { result: "wrong" }, span: node.span }); } },
    Ports: { mode: "structured", doc, elaborate(node, ctx) { ctx.operation({ producer: "test@1#copy", label: "ports", inputs: {}, publish: {}, span: node.span }); } },
    Cycle: { mode: "structured", doc, elaborate(node, ctx) { const operation = `${createHash("sha256").update(ctx.file).digest("hex").slice(0, 16)}:operation:0`; const input: Binding = { kind: "output", key: `${operation}.result`, type, operation, port: "result" }; ctx.operation({ producer: "test@1#copy", label: "cycle", inputs: { input }, publish: { result: "cycle" }, span: node.span }); } },
    Raw: { mode: "raw", doc, elaborate(node, ctx) { assert.equal(node.kind, "raw"); ctx.record("raw", { type, data: node.kind === "raw" ? node.body : "" }, node.span); } },
    Asset: { mode: "structured", doc, elaborate(node, ctx) { const binding = ctx.asset(literal(node, "src"), "test@1#Asset", "image/png", node.span); assert.equal(binding.kind, "record"); if (binding.kind === "record") ctx.record(literal(node, "id"), binding.value, node.span); } },
  }, producers: { copy: { inputs: { input: { type } }, outputs: { result: type }, run(inputs) { const input = inputs.input; assert.ok(input && !Array.isArray(input) && "data" in input); return { outputs: { result: input } }; } } }, frontends: { "fake/dvs@1": { summary: "Fake sheet", compile(sheet, ctx) { compiledSheets++; ctx.record("hello", { type, data: "sheet" }, sheet.rules[0]!.span); } } } };
  const registry = { findModule: (id: string) => id === module.id ? module : undefined, findProducer: (ref: string) => ref === "test@1#copy" ? module.producers.copy : undefined, findFrontend: (using: string) => module.frontends?.[using] };
  const source = (name: string, body: string) => { const file = join(dir, name); writeFileSync(file, `<?dvml using="dsivio-video/markup@1"?><dvml>${body}</dvml>`); return file; };
  return { dir, workspace: Workspace.open({ cwd: dir }), registry, source, sheetCount: () => compiledSheets };
}

test("local references, imported prefixes, source cache, and raw surfaces", (t) => {
  const f = fixture(t);
  f.source("child.dvml", '<import from="test@1"/><Value id="message" value="child"/><Copy id="made" input={message}/>');
  const file = f.source("main.dvml", '<import from="test@1" as="t"/><import source="./child.dvml" as="one"/><import source="./child.dvml" as="two"/><t:Value id="local" value="local"/><t:Copy id="from-child" input={one.message}/><t:Copy id="from-output" input={two.made}/><t:Raw><literal not xml &</t:Raw>');
  const graph = compileAuthor(file, f.workspace, f.registry);
  assert.equal(graph.sources.length, 2);
  assert.equal(graph.operations.size, 3);
  assert.equal(graph.publicRecords.get("one.message"), graph.publicRecords.get("two.message"));
  assert.equal(graph.outputs.get("one.made")!.operation, graph.outputs.get("two.made")!.operation);
  assert.equal(graph.records.get(graph.publicRecords.get("raw")!)!.value.data, "<literal not xml &");
  assert.equal([...graph.operations.values()].find((op) => op.label === "from-child")!.inputs.input && "record" in [...graph.operations.values()].find((op) => op.label === "from-child")!.inputs.input!, true);
});

test("dvs imports use their frontend and are compiled once", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, "kit.dvs"), '<?dvml using="fake/dvs@1"?><sheet version="1">test.hello { value: "hi"; }</sheet>');
  const file = f.source("main.dvml", '<import from="test@1"/><import source="./kit.dvs" as="kit"/><import source="./kit.dvs" as="again"/><Copy id="out" input={kit.hello}/>');
  const graph = compileAuthor(file, f.workspace, f.registry);
  assert.equal(f.sheetCount(), 1);
  assert.equal(graph.records.get(graph.publicRecords.get("again.hello")!)!.value.data, "sheet");
});

test("source cycles and source-order unknown references are rejected", (t) => {
  const f = fixture(t);
  const a = f.source("a.dvml", '<import source="./b.dvml" as="b"/>');
  f.source("b.dvml", '<import source="./a.dvml" as="a"/>');
  assert.throws(() => compileAuthor(a, f.workspace, f.registry), { code: "SOURCE_IMPORT_CYCLE" });
  const unknown = f.source("unknown.dvml", '<import from="test@1"/><Copy id="out" input={later}/><Value id="later" value="x"/>');
  assert.throws(() => compileAuthor(unknown, f.workspace, f.registry), { code: "MARKUP_REFERENCE" });
});

test("duplicate records and logical outputs, bad types and ports fail with codes", (t) => {
  const f = fixture(t);
  for (const [body, code] of [
    ['<Value id="x" value="a"/><Value id="x" value="b"/>', "MARKUP_RECORD_DUPLICATE"],
    ['<Value id="x" value="a"/><Copy id="out" input={x}/><Copy id="out" input={x}/>', "DUPLICATE_LOGICAL_OUTPUT_ID"],
    ["<Bad/>", "TYPE_REFINEMENT_REJECTED"], ["<Wrong/>", "AUTHOR_INPUT_TYPE_MISMATCH"], ["<Ports/>", "AUTHOR_PORT_BINDING_MISMATCH"], ["<Missing/>", "MARKUP_UNKNOWN_SURFACE"], ["<Cycle/>", "AUTHOR_COMPONENT_CYCLE"],
  ]) {
    const file = f.source("main.dvml", `<import from="test@1"/>${body}`);
    assert.throws(() => compileAuthor(file, f.workspace, f.registry), (error) => error instanceof DvError && error.code === code && error.span !== undefined);
  }
});

test("local records and outputs cannot shadow imported public names", (t) => {
  const f = fixture(t);
  f.source("child.dvml", '<import from="test@1"/><Value id="message" value="child"/>');
  for (const [body, code] of [
    ['<Value id="kit.message" value="shadow"/>', "MARKUP_RECORD_DUPLICATE"],
    ['<Copy id="kit.message" input={kit.message}/>', "DUPLICATE_LOGICAL_OUTPUT_ID"],
  ]) {
    const file = f.source("main.dvml", `<import from="test@1"/><import source="./child.dvml" as="kit"/>${body}`);
    assert.throws(() => compileAuthor(file, f.workspace, f.registry), { code });
  }
});

test("source assets must be regular files and repeated paths share one resource", (t) => {
  const f = fixture(t);
  const directory = f.source("directory.dvml", '<import from="test@1"/><Asset id="a" src="./"/>');
  assert.throws(() => compileAuthor(directory, f.workspace, f.registry), { code: "SOURCE_ASSET_NOT_FILE" });
  writeFileSync(join(f.dir, "asset.png"), Buffer.from([0, 1, 2, 3]));
  const file = f.source("main.dvml", '<import from="test@1"/><Asset id="a" src="./asset.png"/><Asset id="b" src="./asset.png"/>');
  const graph = compileAuthor(file, f.workspace, f.registry);
  assert.equal(graph.assets.size, 1);
  const first = graph.records.get(graph.publicRecords.get("a")!)!.value;
  const second = graph.records.get(graph.publicRecords.get("b")!)!.value;
  assert.deepEqual(first, second);
  assert.equal([...graph.assets.values()][0]!.ref.bytes, 4);
});

test("entry frontend and root failures retain source spans", (t) => {
  const f = fixture(t);
  const file = join(f.dir, "bad.dvml");
  for (const [text, code] of [
    ['<?dvml using="unknown@1"?><dvml></dvml>', "UNKNOWN_FRONTEND"],
    ['<?dvml using="dsivio-video/markup@1"?><dvrun version="1"></dvrun>', "MARKUP_ROOT"],
  ]) {
    writeFileSync(file, text!);
    assert.throws(() => compileAuthor(file, f.workspace, f.registry), (error) => error instanceof DvError && error.code === code && error.span?.file.endsWith("bad.dvml") === true && error.span.line === 1);
  }
});

test("detailed authoring retains exact imported ownership and per-owner child identities", (t) => {
  const f = fixture(t);
  f.source("child.dvml", '<import from="test@1"/><Value id="message" value="中😀"/>');
  const file = f.source("main.dvml", '<import from="test@1" as="t"/><import source="./child.dvml" as="one"/><t:Value id="left" value="a"><t:Child id="shared"/></t:Value><t:Value id="right" value="b"><t:Child id="shared"/></t:Value><t:Copy id="use" input={one.message}/>');
  const { graph, authoring } = compileAuthorDetailed(file, f.workspace, f.registry);
  const reference = authoring.references.find(r => r.authorKey === "main.dvml#use" && r.attribute === "input")!;
  assert.equal(reference.bindingKey, graph.publicRecords.get("one.message"));
  const owner = authoring.relations.find(r => r.bindingKey === reference.bindingKey && r.role === "output")!;
  assert.equal(owner.authorKey, "child.dvml#message");
  assert.equal(authoring.elements.get("main.dvml#left/shared")!.moduleId, "test@1");
  assert.equal(authoring.elements.get("main.dvml#right/shared")!.moduleId, "test@1");
  const author = authoring.elements.get(owner.authorKey)!;
  const unit = authoring.units.get(author.sourceUnit)!;
  const value = author.attributes.find(a => a.name === "value")!;
  assert.equal(unit.text.slice(value.valueSpan.start, value.valueSpan.end), '"中😀"');
});

test("detailed overlay compilation uses edited content without changing disk source or prior index", (t) => {
  const f = fixture(t);
  const file = f.source("main.dvml", '<import from="test@1"/><Value id="message" value="old"/>');
  const before = compileAuthorDetailed(file, f.workspace, f.registry);
  const original = f.workspace.readText(file);
  const edited = original.replace('value="old"', 'value="新😀"');
  const after = compileAuthorDetailed(file, f.workspace, f.registry, { overlay: new Map([[file, edited]]) });
  assert.equal(after.graph.records.get(after.graph.publicRecords.get("message")!)!.value.data, "新😀");
  assert.equal(before.graph.records.get(before.graph.publicRecords.get("message")!)!.value.data, "old");
  assert.equal(f.workspace.readText(file), original);
  assert.notEqual([...after.authoring.units.values()][0]!.sourceVersion, [...before.authoring.units.values()][0]!.sourceVersion);
});
