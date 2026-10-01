import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthorDetailed } from "../elaborate/compile.ts";
import { Workspace } from "../source/workspace.ts";
import { assembleTimeline } from "../timeline/timeline.ts";
import { projectWindow } from "../timeline/temporal.ts";
import { VISUAL_IR_VERSION, renderTypes } from "../render/ir.ts";
import type { CompanionInput, ExecutionEdge, StudioEntity, TemporalAuthority } from "./companion.ts";
import { authorFor, createProjection, emptyProjection, ownParameterOwner, parameterOwner, temporalAuthority } from "./projection.ts";

function fixture(t: test.TestContext): CompanionInput {
  const root = mkdtempSync(join(tmpdir(), "dv-owner-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "main.dvml");
  writeFileSync(file, '<?dvml using="dsivio-video/markup@1"?><dvml><import as="time" from="dsivio-video/time@1"/><import as="sound" from="dsivio-video/sound@1"/><time:Timeline id="program" frame-rate="30" end="100f"/><sound:Style id="voice" gain="1"/><sound:Track id="one" timeline={program}><sound:Use id="same" style={voice} at="10f" for="20f"/></sound:Track><sound:Track id="two" timeline={program}><sound:Use id="same" style={voice} at="30f" for="20f"/></sound:Track></dvml>');
  const { graph, authoring } = compileAuthorDetailed(file, Workspace.open({ cwd: root }));
  const timeline = assembleTimeline({ fps: { numerator: 30, denominator: 1 } }, [], { timelineKey: "program", placements: [] }, "100f");
  const executionEdges: ExecutionEdge[] = [...graph.operations.values()].flatMap(operation => Object.entries(operation.inputs).flatMap(([port, source]) => (Array.isArray(source) ? source : [source]).map((source, index) => ({ operation: operation.key, port, source, ...(Array.isArray(operation.inputs[port]) ? { index } : {}) }))));
  const output = graph.outputs.get("one.audio")!;
  return { value: { type: renderTypes.audio, data: { kind: "audio", trackKey: "one", axisKey: timeline.axisKey, clips: [] } }, type: renderTypes.audio, moduleId: "dsivio-video/sound@1", surface: "Track", output: "audio", outputKey: `${output.operation}.${output.port}`, authorKey: "main.dvml#one", authorGraph: graph, authoring, provenance: { kind: "author" }, inputs: {}, executionEdges, supports: {}, values: new Map([...graph.records].map(([key, record]) => [key, record.value])), timeline, document: { version: VISUAL_IR_VERSION, compositionKey: "fixture", domain: { axisKey: timeline.axisKey, clock: timeline.clock, totalFrames: timeline.totalFrames, totalSamples48k: 160000 }, extent: { widthPx: 100, heightPx: 100 }, resources: [], surfaces: [], html: "" }, fallback: emptyProjection };
}
test("shared Style stays its real author despite two precise Use consumer registrations", t => {
  const input = fixture(t);
  const key = input.authorGraph.publicRecords.get("voice")!;
  assert.equal(authorFor(input, key)!.authorKey, "main.dvml#voice");
  const consumed = parameterOwner(input, "styles")!;
  assert.equal(consumed.authorKey, "main.dvml#voice");
  assert.equal(consumed.output, "");
  assert.equal(consumed.bindings.find(b => b.attribute === "gain")!.sourceUnit, input.authoring.elements.get("main.dvml#voice")!.sourceUnit);
  const own = ownParameterOwner({ ...input, authorKey: "main.dvml#voice", outputKey: key, value: consumed.value, type: consumed.value.type, surface: "Style", output: "" });
  assert.deepEqual(own, consumed);
  assert.equal(input.authoring.elements.has("main.dvml#one/same"), true);
  assert.equal(input.authoring.elements.has("main.dvml#two/same"), true);
});
test("shared Selection inverse matches public story and selection identity, not names or frames", t => {
  const input = fixture(t);
  const reference = { kind: "selection", storyKey: "story-one", selectionKey: "same-name", tokenBounds: { start: 0, end: 2 }, anchors: { start: "a", end: "b" } } as const;
  const window = { axisKey: input.timeline.axisKey, consumerKey: "item", frames: { start: 10, end: 20 }, leading: { axisKey: input.timeline.axisKey, consumerKey: "item", frame: 10, origin: { kind: "semantic", reference, edge: "start" }, expression: "selection.start", editAuthority: "semantic-anchor" }, trailing: { axisKey: input.timeline.axisKey, consumerKey: "item", frame: 20, origin: { kind: "semantic", reference, edge: "end" }, expression: "selection.end", editAuthority: "semantic-anchor" } } as const;
  const marker: TemporalAuthority = { key: "same-name:range", originKind: "semantic", originKey: "script-one", consumerPort: "marker", gestures: ["move"], window };
  const base = { title: "same", paintRank: 0, intervals: [{ start: 10, end: 20 }], laneKey: "lane", pictureParts: [], parameterOwners: [] };
  const rows: StudioEntity[] = [
    { ...base, editorKey: "script-one-marker", authorKey: "script-one", facts: { selectionKey: "same-name", storyKey: "story-one" }, temporal: [marker] },
    { ...base, editorKey: "script-two-marker", authorKey: "script-two", facts: { selectionKey: "same-name", storyKey: "story-two" }, temporal: [{ ...marker, originKey: "script-two" }] },
    { ...base, editorKey: "consumer", authorKey: "consumer", facts: {}, temporal: [{ key: "fixed", originKind: "fixed", originKey: "consumer", consumerPort: "windows", gestures: [], window }] },
  ];
  const projection = createProjection([{ ...input, fallback: () => ({ ...emptyProjection(), entities: rows }) }], []);
  const inverse = projection.entities.find(e => e.editorKey === "consumer")!.temporal[0]!;
  assert.equal(inverse.originKey, "script-one");
  assert.equal(inverse.consumerPort, "windows");
  assert.deepEqual(inverse.gestures, ["move"]);
  assert.equal(projection.entities.find(e => e.editorKey === "script-one-marker")!.temporal.length, 1);
});

test("temporal inverse requires the precise participating consumer port, not a matching rectangle", t => {
  const input = fixture(t);
  const relation = input.authoring.relations.find(r => r.authorKey === "main.dvml#one/same" && r.role === "window")!;
  const window = projectWindow(input.timeline, { kind: "at", source: "10f", duration: "20f" }, relation.identity!);
  const authorized = temporalAuthority(input, window, "windows")!;
  assert.equal(authorized.originKey, "main.dvml#one/same");
  assert.deepEqual(authorized.gestures, ["move", "trim-end"]);
  assert.equal(temporalAuthority(input, window, "styles"), undefined);
  const disconnected = { ...input, executionEdges: input.executionEdges.filter(e => e.operation !== relation.consumer!.operation) };
  assert.equal(temporalAuthority(disconnected, window, "windows"), undefined);
});
