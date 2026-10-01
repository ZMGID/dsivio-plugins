import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDvs } from "../../markup/dvs.ts";
import text, { BINDINGS, compileTemplate, normalizeText, render, TEMPLATE, TEXT } from "./index.ts";
import { validateBindings, validateText } from "./render.ts";
import type { RenderBindings } from "./render.ts";
import { validateTemplate } from "./template.ts";
import type { TextTemplate } from "./template.ts";
import { RECIPE } from "../recipe/index.ts";
import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, OperationSpec, ProducerInputs } from "../../core/module.ts";
import type { Attribute, DvsSheet, ElementNode, MarkupNode } from "../../markup/ast.ts";
import type { Json, Value } from "../../core/value.ts";

const span = { file: "main.dvml", start: 0, end: 1, line: 1, column: 1 };
function sheet(entries: [string, Record<string, Json>][]): DvsSheet {
  return { file: "shot.dvs", using: "dsivio-video/text/dvs@1", rules: entries.map(([path, values]) => ({ name: `text-template.hero${path}`, properties: Object.entries(values).map(([name, value]) => ({ name, value, span })), span })) };
}
function hero(defaults: Record<string, Json> = {}): TextTemplate {
  return compileTemplate(sheet([
    ["", { separator: "paragraph", ...defaults }],
    [".block.camera", { kind: "slot", order: 2, slot: "camera", label: "Camera:" }],
    [".block.direction", { kind: "slot", order: 0, slot: "direction" }],
    [".block.note", { kind: "slot", order: 1, slot: "note", optional: true }],
  ]));
}
function run(template: TextTemplate, bindings: RenderBindings = { params: {}, edits: [] }, texts: string[] = [], properties?: Record<string, Json>): string {
  const inputs: ProducerInputs = { template: { type: TEMPLATE, data: template }, bindings: { type: BINDINGS, data: bindings }, texts: texts.map((data) => ({ type: TEXT, data })) };
  if (properties) inputs.recipe = { type: RECIPE, data: { rule: "look.hero", properties } };
  const result = render.run(inputs).outputs!.text!;
  assert.equal(result.type, TEXT);
  assert.equal(typeof result.data, "string");
  return String(result.data);
}
function attr(name: string, value: string, ref = false): Attribute {
  return { name, value: ref ? { kind: "ref", name: value, span } : { kind: "literal", text: value, span }, span };
}
function element(tag: string, attributes: Attribute[] = [], children: MarkupNode[] = []): ElementNode {
  return { kind: "element", tag, attributes, children, selfClosing: children.length === 0, span };
}
type FakeElaboration = { ctx: ElaborationContext; records: { name: string | null; value: Value }[]; operations: OperationSpec[] };
function fake(bindings: Record<string, Binding> = {}): FakeElaboration {
  const records: { name: string | null; value: Value }[] = [];
  const operations: OperationSpec[] = [];
  return { records, operations, ctx: {
    file: span.file,
    lookup(name) { const binding = bindings[name]; if (!binding) throw new DvError("MARKUP_REFERENCE", name); return binding; },
    record(name, value) { records.push({ name, value }); return { kind: "record", key: `r${records.length}`, type: value.type, value }; },
    operation(spec) { operations.push(spec); return {}; },
    asset() { throw new Error("No assets in text modules"); },
    fail(code, message, source) { throw new DvError(code, message, { span: source }); },
    identity() {},
    authoring() {},
  } };
}
function record(key: string, type: string, data: Json): Binding { return { kind: "record", key, type, value: { type, data } }; }

function executeElaborated(f: FakeElaboration): Record<string, Value> {
  const published: Record<string, Value> = {};
  for (const operation of f.operations) {
    const inputs: ProducerInputs = {};
    for (const [port, source] of Object.entries(operation.inputs)) {
      if (Array.isArray(source)) inputs[port] = source.map((binding) => {
        if (binding.kind !== "record") throw new Error("This scenario requires static inputs.");
        return binding.value;
      });
      else {
        if (source.kind !== "record") throw new Error("This scenario requires static inputs.");
        inputs[port] = source.value;
      }
    }
    const outputs = render.run(inputs).outputs!;
    for (const [port, name] of Object.entries(operation.publish)) published[name] = outputs[port]!;
  }
  return published;
}

test("Value elaborates literal Text with dedent and preserved internal paragraphs", () => {
  const f = fake();
  text.surfaces.Value!.elaborate(element("text:Value", [attr("id", " \tdirection \n")], [
    { kind: "text", text: "\r\n    First line  \r\n      deeper\r\n\r\n    last\t \r\n  ", span },
  ]), f.ctx);
  assert.deepEqual(f.records, [{ name: "direction", value: { type: TEXT, data: "First line\n  deeper\n\nlast" } }]);
  assert.equal(normalizeText("   \n\t\n"), "");
  assert.equal(normalizeText("  one\n  two  "), "one\ntwo");
  assert.throws(() => text.surfaces.Value!.elaborate(element("text:Value", [attr("id", "x")], [element("text:Set")]), f.ctx), { code: "TEXT_CHILD" });
  assert.throws(() => text.surfaces.Value!.elaborate(element("text:Value", [attr("id", "x"), attr("extra", "x")]), f.ctx), { code: "TEXT_ATTRIBUTE" });
});

test("Render publishes a trimmed id and preserves Text and Param payloads", () => {
  for (const [type, source, expected] of [["number", "2.5", "2.5"], ["boolean", "false", "false"]]) {
    const f = fake({ template: record("t", TEMPLATE, hero()), direction: record("d", TEXT, " morning ") });
    text.surfaces.Render!.elaborate(element("t:Render", [attr("id", " \tprompt \n"), attr("template", "template", true)], [
      element("t:Set", [attr("name", "direction"), attr("text", "direction", true)]),
      element("t:Param", [attr("name", "camera"), attr("value", " slow push ")]),
      element("t:Param", [attr("name", "note"), attr("value", source!), attr("type", type!)]),
    ]), f.ctx);
    assert.deepEqual(executeElaborated(f), { prompt: { type: TEXT, data: ` morning \n\n${expected}\n\nCamera:\n slow push ` } });
  }
});

test("Render applies Set/Append children in source order rather than replacing earlier bindings", () => {
  for (const modes of [["Append", "Set"], ["Set", "Append"]]) {
    const f = fake({ template: record("t", TEMPLATE, hero()), direction: record("d", TEXT, "morning") });
    text.surfaces.Render!.elaborate(element("t:Render", [attr("id", "p"), attr("template", "template", true)], [
      ...modes.map((mode) => element(`t:${mode}`, [attr("name", "direction"), attr("text", "direction", true)])),
      element("t:Param", [attr("name", "camera"), attr("value", "slow")]),
    ]), f.ctx);
    assert.throws(() => executeElaborated(f), { code: modes[0] === "Append" ? "TEXT_BINDING_DUPLICATE" : "TEXT_SLOT_LIST" });
  }
});

test("Render surface rejects invalid Params, references, children and nonstatic recipes", () => {
  const f = fake({ template: record("t", TEMPLATE, hero()), wrong: record("w", TEXT, "x"), recipe: record("r", RECIPE, { rule: "look.hero", properties: {} }), dynamic: { kind: "output", key: "o", operation: "op", port: "template", type: TEMPLATE } });
  const renderNode = (children: MarkupNode[], attrs: Attribute[] = []) => element("text:Render", [attr("id", "p"), attr("template", "template", true), ...attrs], children);
  const param = (value: string, type: string) => element("text:Param", [attr("name", "camera"), attr("value", value), attr("type", type)]);
  for (const child of [param("Infinity", "number"), param("", "number"), param("yes", "boolean"), param("a", "list"), element("text:Param", [attr("name", "camera"), attr("value", "wrong", true)])]) {
    assert.throws(() => text.surfaces.Render!.elaborate(renderNode([child]), f.ctx), { code: "TEXT_PARAM" });
  }
  assert.throws(() => text.surfaces.Render!.elaborate(renderNode([param("x", "text"), param("y", "text")]), f.ctx), { code: "TEXT_DUPLICATE_PARAM" });
  assert.throws(() => text.surfaces.Render!.elaborate(renderNode([element("other:Set")]), f.ctx), { code: "TEXT_CHILD" });
  assert.throws(() => text.surfaces.Render!.elaborate(element("text:Render", [attr("id", "p"), attr("template", "wrong", true)]), f.ctx), { code: "TEXT_REFERENCE" });
  assert.throws(() => text.surfaces.Render!.elaborate(element("text:Render", [attr("id", "p"), attr("template", "dynamic", true), attr("recipe", "recipe", true)]), f.ctx), { code: "TEXT_RECIPE_STATIC" });
  for (const tag of ["Param", "Set", "Append"]) assert.throws(() => text.surfaces[tag]!.elaborate(element(`text:${tag}`), f.ctx), { code: "TEXT_CHILD" });
});

test("producer priority is defaults then consumed recipe then Param, with Set replacing defaults only", () => {
  const template = hero({ "default-direction": "default direction", "default-camera": "default camera" });
  assert.equal(run(template), "default direction\n\nCamera:\ndefault camera");
  assert.equal(run(template, { params: { camera: "param" }, edits: [] }, [], { direction: "recipe", camera: "recipe camera", ignored: [null] }), "recipe\n\nCamera:\nparam");
  assert.equal(run(template, { params: {}, edits: [{ name: "direction", mode: "set" }] }, ["set"]), "set\n\nCamera:\ndefault camera");
  const attempts: RenderBindings[] = [{ params: { direction: "param" }, edits: [{ name: "direction", mode: "set" }] }, { params: {}, edits: [{ name: "direction", mode: "set" }, { name: "direction", mode: "set" }] }, { params: {}, edits: [{ name: "direction", mode: "append" }, { name: "direction", mode: "set" }] }];
  for (const previous of attempts) {
    assert.throws(() => run(template, previous, previous.edits.map(() => "x")), { code: "TEXT_BINDING_DUPLICATE" });
  }
  assert.throws(() => run(template, { params: {}, edits: [{ name: "direction", mode: "set" }] }, ["x"], { direction: "recipe" }), { code: "TEXT_BINDING_DUPLICATE" });
  for (const bad of [null, [], {}, Infinity]) assert.throws(() => run(template, undefined, [], { direction: bad }), { code: bad === Infinity ? "TYPE_INVALID" : "TEXT_RECIPE_VALUE" });
});

test("slot failures, optional slots, scalar conversion, append lists and undeclared bindings", () => {
  const template = hero();
  assert.throws(() => run(template), { code: "TEXT_SLOT_MISSING" });
  assert.equal(run(template, { params: { direction: false, camera: 2 }, edits: [] }), "false\n\nCamera:\n2");
  assert.equal(run(template, { params: { direction: "", camera: "" }, edits: [] }), "");
  const startingParams: RenderBindings["params"][] = [{}, { direction: "scalar" }];
  for (const params of startingParams) assert.throws(() => run(template, { params, edits: [{ name: "direction", mode: "append" }, { name: "direction", mode: "append" }] }, ["first", "second"]), { code: "TEXT_SLOT_LIST" });
  assert.throws(() => run(template, { params: { unrelated: "x" }, edits: [] }), { code: "TEXT_BINDING_UNKNOWN" });
  assert.throws(() => run(template, { params: {}, edits: [{ name: "unrelated", mode: "set" }] }, ["x"]), { code: "TEXT_BINDING_UNKNOWN" });
});

function variants(fallback = false, ambiguous = false): TextTemplate {
  return compileTemplate(sheet([
    ["", {}],
    [".block.variant", { kind: "variant", order: 0 }],
    [".block.axis", { kind: "axis", order: 1, parameter: "camera" }],
    [".choice.axis.slow", { text: "slow camera" }],
    [".choice.axis.fast", { text: "fast camera" }],
    [".choice.variant.match", { text: "matching", "when-param-light": true, "when-select-axis": "slow" }],
    ...(fallback ? [[".choice.variant.default", { text: "fallback" }] as [string, Record<string, Json>]] : []),
    ...(ambiguous ? [[".choice.variant.other", { text: "other", "when-param-light": true }] as [string, Record<string, Json>]] : []),
  ]));
}

test("variant conditions are conjunctive and selection dependencies ignore render order", () => {
  assert.equal(run(variants(), { params: { light: true, camera: "slow" }, edits: [] }), "matching\n\nslow camera");
  assert.equal(run(variants(true), { params: { light: true, camera: "fast" }, edits: [] }), "fallback\n\nfast camera");
  assert.equal(run(variants(true), { params: { light: false, camera: "slow" }, edits: [] }), "fallback\n\nslow camera");
  assert.throws(() => run(variants(), { params: { light: false, camera: "slow" }, edits: [] }), { code: "TEXT_VARIANT_UNMATCHED" });
  assert.throws(() => run(variants(true, true), { params: { light: true, camera: "slow" }, edits: [] }), { code: "TEXT_VARIANT_AMBIGUOUS" });
  assert.throws(() => run(variants(), { params: { light: true, camera: 1 }, edits: [] }), { code: "TEXT_AXIS_UNMATCHED" });
});

test("frontend publishes only the root template and rejects invalid template contracts", () => {
  const published: Record<string, Value> = {};
  text.frontends!["dsivio-video/text/dvs@1"]!.compile(sheet([["", {}], [".block.fixed", { kind: "fixed", order: 0, text: "hello" }]]), { record(name, value) { published[name] = value; }, fail(code, message) { throw new DvError(code, message); } });
  assert.equal(published.hero!.type, TEMPLATE);
  assert.deepEqual(Object.keys(published), ["hero"]);
  const cases: [string, Record<string, Json>][][] = [
    [], [[".block.a", { kind: "fixed", order: 0, text: "x" }]],
    [["", { separator: "line" }]], [["", { "default-unused": "x" }]], [["", { "default-x": null }]],
    [["", {}], [".block.a", { kind: "fixed", order: -1, text: "x" }]],
    [["", {}], [".block.a", { kind: "fixed", order: 0, text: "" }]],
    [["", {}], [".block.a", { kind: "fixed", order: 0, text: "x", extra: true }]],
    [["", {}], [".block.a", { kind: "fixed", order: 0, text: "x" }], [".block.b", { kind: "slot", order: 0, slot: "b" }]],
    [["", {}], [".block.a", { kind: "axis", order: 0, parameter: "x" }]],
    [["", {}], [".block.a", { kind: "slot", order: 0, slot: "x", optional: "true" }]],
    [["", {}], [".block.a", { kind: "variant", order: 0 }], [".choice.a.foo", { text: "x" }]],
    [["", {}], [".block.a", { kind: "variant", order: 0 }], [".choice.a.foo", { text: "x", "when-select-missing": "x" }]],
    [["", {}], [".block.a", { kind: "variant", order: 0 }], [".choice.a.foo", { text: "x", "when-select-a": "foo" }]],
    [["", {}], [".unknown.path", { text: "x" }]],
  ];
  for (const entries of cases) assert.throws(() => compileTemplate(sheet(entries)), { code: "TEXT_TEMPLATE" });
});

test("validators reject malformed stored values and producer rejects pending or wrong inputs", () => {
  assert.throws(() => validateText(1), { code: "TYPE_INVALID" });
  const invalidBindings: Json[] = [null, { params: { n: Infinity }, edits: [] }, { params: {}, edits: [{ name: "a", mode: "replace" }] }];
  for (const data of invalidBindings) assert.throws(() => validateBindings(data), { code: "TYPE_INVALID" });
  assert.throws(() => validateTemplate({ ...hero(), blocks: [{ name: "x", kind: "slot", order: 0, slot: "x" }] }), { code: "TYPE_INVALID" });
  assert.throws(() => render.run({ template: { $pending: "upstream", type: TEMPLATE } }), { code: "TEXT_INPUT_PENDING" });
  assert.throws(() => render.run({ template: { type: TEXT, data: "x" } }), { code: "TYPE_INVALID" });
  const inputs: ProducerInputs = { template: { type: TEMPLATE, data: hero() }, bindings: { type: BINDINGS, data: { params: {}, edits: [{ name: "direction", mode: "set" }] } }, texts: [] };
  assert.throws(() => render.run(inputs), { code: "TYPE_INVALID" });
  inputs.texts = [{ $pending: "upstream", type: TEXT }];
  assert.throws(() => render.run(inputs), { code: "TEXT_INPUT_PENDING" });
});

test("stored template validation directly rejects malformed shape, ordering and selection invariants", () => {
  const fixed = { name: "intro", kind: "fixed", order: 0, text: "hello" };
  const invalidBlocks: Json[][] = [
    [{ ...fixed, order: -1 }],
    [{ ...fixed, order: 1 }, { ...fixed, name: "outro", order: 0 }],
    [fixed, { ...fixed, name: "outro" }],
    [fixed, { ...fixed, order: 1 }],
    [{ ...fixed, extra: true }],
    [{ ...fixed, text: " " }],
    [{ name: "axis", kind: "axis", order: 0, parameter: "camera", choices: [] }],
    [{ name: "axis", kind: "axis", order: 0, parameter: "", choices: [{ name: "slow", text: "slow", conditions: {} }] }],
    [{ name: "variant", kind: "variant", order: 0, choices: [{ name: "match", text: "x", conditions: {} }] }],
    [{ name: "variant", kind: "variant", order: 0, choices: [{ name: "match", text: "x", conditions: { "when-param-x": [] } }] }],
    [{ name: "variant", kind: "variant", order: 0, choices: [{ name: "match", text: "x", conditions: { "when-select-missing": "slow" } }] }],
    [{ name: "variant", kind: "variant", order: 0, choices: [{ name: "match", text: "x", conditions: { "when-select-variant": "match" } }] }],
  ];
  for (const blocks of invalidBlocks) assert.throws(() => validateTemplate({ name: "hero", separator: "paragraph", defaults: {}, blocks }), { code: "TYPE_INVALID" });
  assert.throws(() => validateTemplate({ name: "hero", separator: "paragraph", defaults: { unused: "x" }, blocks: [fixed] }), { code: "TYPE_INVALID" });
  assert.throws(() => validateTemplate({ ...hero(), defaults: { direction: Infinity } }), { code: "TYPE_INVALID" });
  assert.throws(() => validateTemplate({ ...hero(), extra: true }), { code: "TYPE_INVALID" });
});

test("first-light shot.dvs uses explicit text frontend and direction/camera slots", () => {
  const source = readFileSync(new URL("../../../examples/first-light/shot.dvs", import.meta.url), "utf8");
  const template = compileTemplate(parseDvs("shot.dvs", source));
  assert.equal(run(template, { params: { camera: "缓慢推近" }, edits: [{ name: "direction", mode: "set" }] }, ["一瓶香水放在清晨窗台上，逆光，薄雾。"]), "一瓶香水放在清晨窗台上，逆光，薄雾。\n\n镜头运动：\n缓慢推近");
});
