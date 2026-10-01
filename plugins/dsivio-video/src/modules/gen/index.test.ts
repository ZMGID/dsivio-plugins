import test from "node:test";
import assert from "node:assert/strict";
import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, OperationSpec, ProducerInputs } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { ElementNode } from "../../markup/ast.ts";
import media, { imageType, videoType, audioType } from "../media/index.ts";
import gen from "./index.ts";

const span = { file: "test.dvml", start: 0, end: 1, line: 1, column: 1 };
const textType = "dsivio-video/text@1#Text";
function element(tag: string, attrs: Record<string, string>, refs: Record<string, string> = {}, children: ElementNode[] = []): ElementNode {
  return { kind: "element", tag, span, selfClosing: !children.length, children, attributes: [...Object.entries(attrs).map(([name, text]) => ({ name, span, value: { kind: "literal" as const, text, span } })), ...Object.entries(refs).map(([name, ref]) => ({ name, span, value: { kind: "ref" as const, name: ref, span } }))] };
}
function context() {
  const records: { name: string | null; value: Value }[] = [];
  const bindings = new Map<string, Binding>();
  const operations: OperationSpec[] = [];
  const assets: { locator: string; type: string; mime: string | undefined }[] = [];
  const ctx: ElaborationContext = {
    file: span.file,
    lookup(name) { const value = bindings.get(name); if (!value) throw new DvError("MARKUP_REFERENCE", name); return value; },
    record(name, value) { const binding: Binding = { kind: "record", key: `record-${records.length}`, type: value.type, value }; records.push({ name, value }); if (name) bindings.set(name, binding); return binding; },
    operation(spec) { operations.push(spec); return {}; },
    asset(locator, type, mime) { assets.push({ locator, type, mime }); return ctx.record(null, { type, data: { $resource: locator, bytes: 4, mime: mime! } }, span); },
    fail(code, message, location) { throw new DvError(code, message, { span: location }); },
    identity() {},
  };
  return { ctx, records, operations, assets, bindings };
}
function code(expected: string) { return (error: unknown): boolean => error instanceof DvError && error.code === expected; }

test("media surfaces infer MIME, import assets and publish typed records", () => {
  for (const [name, type, file, mime] of [["Image", imageType, "./A.PNG", "image/png"], ["Video", videoType, "./a.mp4", "video/mp4"], ["Audio", audioType, "./a.wav", "audio/wav"]]) {
    const c = context();
    media.surfaces[name!]!.elaborate(element(`m:${name}`, { id: "asset", src: file! }), c.ctx);
    assert.deepEqual(c.assets, [{ locator: file, type, mime }]);
    assert.equal(c.bindings.get("asset")?.type, type);
    media.types[name!]!.validate!(c.records.at(-1)!.value.data);
  }
  const c = context();
  media.surfaces.Image!.elaborate(element("m:Image", { id: "asset", src: "./file.unknown", mime: "image/custom" }), c.ctx);
  assert.equal(c.assets[0]!.mime, "image/custom");
  assert.throws(() => media.surfaces.Image!.elaborate(element("m:Image", { id: "asset", src: "./file.unknown" }), c.ctx), code("MEDIA_MIME_REQUIRED"));
  assert.throws(() => media.surfaces.Video!.elaborate(element("m:Video", { id: "asset", src: "./file.png" }), c.ctx), code("TYPE_INVALID"));
});

test("media types reject composites, malformed metadata and wrong MIME", () => {
  for (const [name, prefix] of [["Image", "image"], ["Video", "video"], ["Audio", "audio"]]) {
    const validate = media.types[name!]!.validate!;
    validate({ $resource: "x", bytes: 0, mime: `${prefix}/custom` });
    const invalid: Json[] = [[], { ref: { $resource: "x", bytes: 1, mime: `${prefix}/png` } }, { $resource: "x", bytes: -1, mime: `${prefix}/custom` }, { $resource: "x", bytes: 1, mime: "text/plain" }, { $resource: "x" }, { $resource: "x", bytes: 1, mime: `${prefix}/` }, { $resource: "x", bytes: 1, mime: `${prefix}/custom`, extra: true }];
    for (const data of invalid) assert.throws(() => validate(data), code("TYPE_INVALID"));
  }
});


test("gen surfaces reject missing model, invalid children, attributes and typed inputs", () => {
  const c = context();
  c.ctx.record("audio", { type: audioType, data: { $resource: "x", bytes: 1, mime: "audio/wav" } }, span);
  const cases: [ElementNode, string][] = [
    [element("g:Video", { id: "x", prompt: "p" }), "GEN_MODEL_REQUIRED"],
    [element("g:Video", { id: "x", prompt: "p", model: "m", audio: "yes" }), "GEN_PARAM_INVALID"],
    [element("g:Image", { id: "x", prompt: "p", model: "m", count: "1.5" }), "GEN_PARAM_INVALID"],
    [element("g:Video", { id: "x", prompt: "p", model: "m", unknown: "x" }), "MARKUP_ATTRIBUTE"],
    [element("g:Video", { id: "x", prompt: "p", model: "m" }, { "first-frame": "audio" }), "TYPE_INVALID"],
    [element("g:Video", { id: "x", prompt: "p", model: "m" }, {}, [element("g:Reference", {})]), "GEN_REFERENCE_INVALID"],
    [element("g:Video", { id: "x", prompt: "p", model: "m" }, {}, [element("g:Option", { name: "x", value: "not", type: "number" })]), "GEN_OPTION_INVALID"],
    [element("g:Video", { id: "x", prompt: "p", model: "m" }, {}, [element("other:Reference", {}, { audio: "audio" })]), "MARKUP_CHILD"],
  ];
  for (const [node, expected] of cases) assert.throws(() => gen.surfaces[node.tag.endsWith("Image") ? "Image" : "Video"]!.elaborate(node, c.ctx), code(expected));
});

test("producers form needs with ResourceRefs and Pending values, rechecking actual MIME", () => {
  for (const kind of ["image", "video"] as const) {
    const producer = gen.producers[kind]!;
    const inputs: ProducerInputs = {
      config: { type: "dsivio-video/gen@1#RequestConfig", data: { model: `p/${kind}`, params: {}, options: {} } },
      prompt: { type: textType, data: "A scene" },
      images: [{ $pending: "hero.image", type: imageType }, { type: imageType, data: { $resource: "img", bytes: 5, mime: "image/png" } }],
      ...(kind === "video" ? { firstFrame: { $pending: "hero.image", type: imageType }, videos: [{ $pending: "clip.video", type: videoType }], audios: [{ $pending: "voice", type: audioType }] } : {}),
    };
    const need = producer.run(inputs).needs![kind]!;
    assert.equal(need.capability, `gateway/${kind}`);
    assert.ok(need.request && typeof need.request === "object" && !Array.isArray(need.request));
    assert.deepEqual(need.request.prompt, "A scene");
    assert.deepEqual(need.request.references, { images: [{ $pending: "hero.image", type: imageType }, { $resource: "img", bytes: 5, mime: "image/png" }], videos: kind === "video" ? [{ $pending: "clip.video", type: videoType }] : [], audios: kind === "video" ? [{ $pending: "voice", type: audioType }] : [] });
    inputs.prompt = { $pending: "prompt", type: textType };
    const pendingNeed = producer.run(inputs).needs![kind]!.request;
    assert.ok(pendingNeed && typeof pendingNeed === "object" && !Array.isArray(pendingNeed));
    assert.deepEqual(pendingNeed.prompt, { $pending: "prompt", type: textType });
    inputs.images = [{ type: imageType, data: { $resource: "bad", bytes: 1, mime: "video/mp4" } }];
    assert.throws(() => producer.run(inputs), code("TYPE_INVALID"));
  }
});

test("surface authored strings become typed generation parameters without dropping zero or false", () => {
  const c = context();
  c.ctx.record("direction", { type: textType, data: "Morning" }, span);
  c.bindings.set("hero.image", { kind: "output", key: "hero", operation: "hero", port: "image", type: imageType });
  gen.surfaces.Image!.elaborate(element("g:Image", { id: "hero", model: "p/image", prompt: "Literal scene", count: "2" }), c.ctx);
  gen.surfaces.Video!.elaborate(element("g:Video", { id: "shot", model: "p/video", duration: "5", audio: "false" }, { prompt: "direction", "first-frame": "hero.image" }, [element("g:Option", { name: "seed", value: "0", type: "number" }), element("g:Option", { name: "flag", value: "false", type: "boolean" })]), c.ctx);
  for (const [index, kind] of ["image", "video"].entries()) {
    const spec = c.operations[index]!;
    const value = (binding: Binding) => binding.kind === "record" ? binding.value : { $pending: "hero.image", type: binding.type };
    const inputs: ProducerInputs = {};
    for (const [name, binding] of Object.entries(spec.inputs)) inputs[name] = Array.isArray(binding) ? binding.map(value) : value(binding);
    const output = gen.producers[kind]!.run(inputs).needs![kind]!.request;
    assert.ok(output && typeof output === "object" && !Array.isArray(output));
    if (kind === "image") {
      assert.equal(output.prompt, "Literal scene");
      assert.deepEqual(output.params, { count: 2 });
    } else {
      assert.equal(output.prompt, "Morning");
      assert.deepEqual(output.params, { duration: 5, audio: false });
      assert.deepEqual(output.options, { seed: 0, flag: false });
      assert.deepEqual(output.firstFrame, { $pending: "hero.image", type: imageType });
    }
  }
});
