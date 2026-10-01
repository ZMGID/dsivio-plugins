import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthorDetailed } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import { findProducer } from "../index.ts";
import type { Value } from "../../core/value.ts";
import type { InputSource } from "../../core/graph.ts";
import type { CompanionInput, ExecutionEdge } from "../../studio/companion.ts";
import { authorFor, emptyProjection } from "../../studio/projection.ts";
import { renderTypes, VISUAL_IR_VERSION } from "../../render/ir.ts";
import type { OverlayProgram } from "../../components/screen-overlay/types.ts";
import { OVERLAY_FIELDS } from "../../components/screen-overlay/validate.ts";
import overlay from "./index.ts";
import { projectOverlay } from "./studio.ts";

function fixture(t: test.TestContext, body: string): CompanionInput {
  const root = mkdtempSync(join(tmpdir(), "dv-overlay-studio-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "main.dvml"), `<?dvml using="dsivio-video/markup@1"?><dvml><import from="dsivio-video/screen-overlay@1" as="overlay"/><import from="dsivio-video/time@1" as="time"/><import from="dsivio-video/space@1" as="space"/><time:Timeline id="tl" frame-rate="30" end="120f"/><space:Canvas id="canvas" width="960" height="540"/><overlay:Track id="effects" canvas={canvas} timeline={tl}>${body}</overlay:Track></dvml>`);
  const { graph, authoring } = compileAuthorDetailed(join(root, "main.dvml"), Workspace.open({ cwd: root }));
  const values = new Map<string, Value>([...graph.records].map(([key, record]) => [key, record.value]));
  const edges: ExecutionEdge[] = [];
  function from(source: InputSource): Value { if ("record" in source) return values.get(source.record)!; execute(source.operation); return values.get(`${source.operation}.${source.port}`)!; }
  function execute(key: string): void {
    const operation = graph.operations.get(key)!;
    if (values.has(`${key}.${Object.keys(operation.outputs)[0]}`)) return;
    const inputs = Object.fromEntries(Object.entries(operation.inputs).map(([port, source]) => {
      const sources = Array.isArray(source) ? source : [source];
      sources.forEach((source, index) => edges.push({ operation: key, port, ...(Array.isArray(operation.inputs[port]) ? { index } : {}), source }));
      return [port, Array.isArray(source) ? source.map(from) : from(source)];
    }));
    const outputs = findProducer(operation.producer)!.run(inputs).outputs!;
    for (const [port, value] of Object.entries(outputs)) values.set(`${key}.${port}`, value);
  }
  const logical = graph.outputs.get("effects.track")!;
  execute(logical.operation);
  const support = graph.outputs.get("effects.program")!;
  const program = values.get(`${support.operation}.${support.port}`)!;
  const domain = program.data as unknown as OverlayProgram;
  const input: CompanionInput = { value: values.get(`${logical.operation}.${logical.port}`)!, type: renderTypes.visual, moduleId: overlay.id, surface: "Track", output: "track", outputKey: `${logical.operation}.${logical.port}`, authorKey: "", authorGraph: graph, authoring, values, inputs: {}, executionEdges: edges, supports: { program }, provenance: { kind: "author" }, timeline: domain.timeline, document: { version: VISUAL_IR_VERSION, compositionKey: "fixture", domain: { axisKey: domain.timeline.axisKey, clock: domain.timeline.clock, totalFrames: 120, totalSamples48k: 192000 }, extent: { widthPx: 960, heightPx: 540 }, resources: [], surfaces: [], html: "" }, fallback: emptyProjection };
  input.authorKey = authorFor(input, domain.trackKey)!.authorKey;
  return input;
}

const effects = [
  '<overlay:Flash id="flash" color="#ffffff" intensity="0.8" attack="2" hold="1" decay="3"/>',
  '<overlay:ColorWash color="#12345678" opacity="0.5"/>',
  '<overlay:Vignette center-x="0.5" center-y="0.5" radius-x="0.8" radius-y="0.7" softness="0.2" color="#000000" opacity="0.5"/>',
  '<overlay:ScanLines spacing="8" thickness="2" angle="15" opacity="0.4" travel="-3"/>',
  '<overlay:DirectionalMatte angle="30" coverage="0.7" feather="0.3" color="#000000" opacity="0.8" from="-1" to="2"/>',
  '<overlay:WhipVeil direction="left" width="0.2" softness="0.3" travel="0.4" opacity="0.9"/>',
  '<overlay:GlitchVeil bars="8" colors="#ffffff,#123456" opacity="0.5" travel="1" seed="2"/>',
  '<overlay:Grain amount="0.5" size="2" chroma="color" motion-rate="1" seed="3"/>',
  '<overlay:LightLeak colors="#ffffff,#f0f0f0" angle="20" softness="0.4" travel="0.3" intensity="0.6" seed="4"/>',
  '<overlay:Bokeh amount="0.3" min-size="10" max-size="40" color="#ffffff" warmth="-0.3" drift="-2" seed="5"/>',
  '<overlay:TVStatic amount="0.7" size="3" scan-lines="0.3" motion-rate="-1" seed="6"/>',
];

test("Every existing overlay kind exposes only real schema fields, true enums, exact child owners and window authorities", t => {
  const input = fixture(t, effects.map((effect, index) => effect.replace('/>', ` z="${index}" at="${index * 5}f" for="5f"/>`)).join(""));
  const projection = projectOverlay(input);
  assert.equal(projection.lanes[0]!.height, 52);
  assert.equal(projection.materials.length, 0);
  const program = input.supports.program!.data as unknown as OverlayProgram;
  for (const effect of program.effects) {
    const authorKey = authorFor(input, effect.effectKey)!.authorKey;
    const entity = projection.entities.find(entity => entity.authorKey === authorKey)!;
    const fields = projection.fieldGroups.filter(group => group.ownerKey === authorKey).flatMap(group => group.fields);
    assert.deepEqual(fields.map(field => field.binding!.attribute).sort(), ["z", ...Object.keys(OVERLAY_FIELDS[effect.kind])].sort());
    assert.deepEqual(entity.intervals, [effect.window.frames]);
    assert.deepEqual(entity.temporal[0]!.window, effect.window);
    assert.deepEqual(entity.temporal[0]!.gestures, ["move", "trim-end"]);
    assert.equal(entity.sourceSlice!.unit, input.authoring.elements.get(authorKey)!.sourceUnit);
    assert.ok(fields.every(field => field.endpointKey && field.binding!.ownerKey === authorKey));
  }
  const fields = projection.fieldGroups.flatMap(group => group.fields);
  assert.deepEqual(fields.find(field => field.label === "direction")!.options!.map(option => option.value), ["left", "right", "up", "down"]);
  assert.deepEqual(fields.find(field => field.label === "chroma")!.options!.map(option => option.value), ["monochrome", "color"]);
  assert.deepEqual(fields.find(field => field.label === "colors")!.authorValue, ["#ffffff", "#123456"]);
  assert.equal(fields.find(field => field.label === "warmth")!.authorValue, -0.3);
  assert.equal(fields.find(field => field.label === "opacity")!.displayScale, 100);
  assert.equal(projection.parameterOwners.length, 0);
});

test("Disjoint repeated-kind effects retain separate intervals and exact render selections, never a merged track span", t => {
  const input = fixture(t, '<overlay:ColorWash id="early" z="1" color="#ff0000" opacity="0.5" start="2f" end="12f"/><overlay:ColorWash id="late" z="1" color="#0000ff" opacity="0.7" start="40f" end="50f"/>');
  const result = projectOverlay(input);
  assert.deepEqual(result.entities.map(entity => entity.intervals), [[{ start: 2, end: 12 }], [{ start: 40, end: 50 }]]);
  assert.notEqual(result.entities[0]!.authorKey, result.entities[1]!.authorKey);
  assert.equal(result.entities[0]!.pictureParts.some(part => result.entities[1]!.pictureParts.includes(part)), false);
  assert.deepEqual(result.entities[0]!.temporal[0]!.gestures, ["move", "trim-start", "trim-end"]);
});
