import test from "node:test";
import assert from "node:assert/strict";
import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, OperationSpec, ProducerInputs } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { ElementNode } from "../../markup/ast.ts";
import media, { imageType, videoType, audioType } from "../media/index.ts";
import gen from "./index.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthor } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";

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
    authoring() {},
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

test("Speech clone retains Audio producer dependency and consent file provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "dv-speech-graph-"));
  try {
    mkdirSync(join(root, ".dsivio-video"));
    const consent = join(root, "consent.txt");
    writeFileSync(consent, "I authorize this reference voice for this project.");
    const source = join(root, "main.dvml");
    writeFileSync(source, `<?dvml using="dsivio-video/markup@1"?>
<dvml><import as="gen" from="dsivio-video/gen@1"/>
<gen:Speech id="reference" model="p/tts" text="reference" voice="voice"/>
<gen:Speech id="cloned" model="p/tts" text="hello" mode="clone" voice-ref={reference.audio} consent-attestation="./consent.txt"><gen:Option name="speed" type="number" value="1"/></gen:Speech>
</dvml>`);
    const graph = compileAuthor(source, Workspace.open({ cwd: root }));
    const clone = [...graph.operations.values()].find(op => op.label === "cloned")!;
    const reference = [...graph.operations.values()].find(op => op.label === "reference")!;
    assert.deepEqual(clone.inputs.voiceReference, { operation: reference.key, port: "audio" });
    assert.equal(graph.outputs.get("cloned.audio")?.type, audioType);
    assert.ok([...graph.assets.values()].some(asset => asset.path === realpathSync(consent) && asset.ref.mime === "text/plain"));
    writeFileSync(source, `<?dvml using="dsivio-video/markup@1"?><dvml><import as="gen" from="dsivio-video/gen@1"/><gen:Speech id="x" model="p/tts" text="hello" voice-ref="reference.audio"/></dvml>`);
    assert.throws(() => compileAuthor(source, Workspace.open({ cwd: root })), code("MARKUP_REFERENCE"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
