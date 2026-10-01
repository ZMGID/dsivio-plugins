import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthorDetailed } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import { findProducer } from "../index.ts";
import type { InputSource } from "../../core/graph.ts";
import type { Json, Value } from "../../core/value.ts";
import type { CompanionInput, ExecutionEdge } from "../../studio/companion.ts";
import { authorFor, emptyProjection, createProjection } from "../../studio/projection.ts";
import { fontTypes } from "../../fonts/types.ts";
import type { FontFace } from "../../fonts/types.ts";
import type { RankingKind, RankingProgram } from "../../components/ranking/types.ts";
import { rankingTypes } from "../../components/ranking/types.ts";
import { renderTypes, VISUAL_IR_VERSION } from "../../render/ir.ts";
import type { SynchronizedMedia } from "../../timeline/types.ts";
import ranking from "./index.ts";
import { projectRanking, projectRankingAudio } from "./studio.ts";
import { assembleRanking } from "../../components/ranking/program.ts";
import { lowerRanking } from "../../components/ranking/lower.ts";
import { projectWindow } from "../../timeline/temporal.ts";

const face: FontFace = { faceKey: "inter", family: "inter", weight: 700, style: "normal", shards: [{ resource: { $resource: "font", bytes: 100, mime: "font/woff2" }, unicodeRange: "U+0-10FFFF" }], license: { spdx: "OFL-1.1", notice: { $resource: "license", bytes: 100, mime: "text/plain" } } };
function fixture(t: test.TestContext, kind: RankingKind, items: string): CompanionInput {
  const root = mkdtempSync(join(tmpdir(), "dv-ranking-studio-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "look.dvs"), '<?dvml using="dsivio-video/dvs@1"?><sheet version="1">ranking.style { appear-gain: 2; move-gain: 0.5; sound-fade-frames: 3; } </sheet>');
  writeFileSync(join(root, "main.dvml"), `<?dvml using="dsivio-video/markup@1"?><dvml><import from="dsivio-video/ranking@1" as="r"/><import from="dsivio-video/time@1" as="time"/><import from="dsivio-video/fonts@1" as="font"/><import from="dsivio-video/space@1" as="space"/><import from="dsivio-video/media@1" as="media"/><import source="./look.dvs" as="look"/><time:Timeline id="tl" frame-rate="30" end="120f"/><space:Canvas id="canvas" width="960" height="540"/><space:Frame id="frame" within={canvas} left="40px" top="30px" right="840px" bottom="430px"/><font:Face id="font" family="inter" weight="700" style="normal"/><media:Image id="icon" src="./icon.png"/><r:${kind}Style id="style" recipe={look.ranking.style} font={font}/><r:${kind} id="rank" timeline={tl} frame={frame} style={style} during="program" ${kind === "TopThree" ? 'terminal="100f"' : 'canvas={canvas}'}>${items}</r:${kind}></dvml>`);
  writeFileSync(join(root, "icon.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7LsAAAAASUVORK5CYII=", "base64"));
  const { graph, authoring } = compileAuthorDetailed(join(root, "main.dvml"), Workspace.open({ cwd: root }));
  const values = new Map<string, Value>([...graph.records].map(([key, record]) => [key, record.value]));
  const edges: ExecutionEdge[] = [];
  function from(source: InputSource): Value { if ("record" in source) return values.get(source.record)!; execute(source.operation); return values.get(`${source.operation}.${source.port}`)!; }
  function execute(key: string): void {
    const operation = graph.operations.get(key)!;
    if (values.has(`${key}.${Object.keys(operation.outputs)[0]}`)) return;
    if (Object.values(operation.outputs).includes(fontTypes.face)) { for (const [port, type] of Object.entries(operation.outputs)) if (type === fontTypes.face) values.set(`${key}.${port}`, { type, data: face as unknown as Json }); return; }
    const inputs = Object.fromEntries(Object.entries(operation.inputs).map(([port, source]) => {
      const sources = Array.isArray(source) ? source : [source];
      sources.forEach((source, index) => edges.push({ operation: key, port, ...(Array.isArray(operation.inputs[port]) ? { index } : {}), source }));
      return [port, Array.isArray(source) ? source.map(from) : from(source)];
    }));
    const result = findProducer(operation.producer)!.run(inputs);
    if (!result.outputs) throw new Error(`Fixture unexpectedly needs ${operation.producer}`);
    for (const [port, value] of Object.entries(result.outputs)) values.set(`${key}.${port}`, value);
  }
  const logical = graph.outputs.get("rank.visual")!;
  execute(logical.operation);
  const support = graph.outputs.get("rank.program")!;
  const program = values.get(`${support.operation}.${support.port}`)!;
  const domain = program.data as unknown as RankingProgram;
  const input: CompanionInput = { value: values.get(`${logical.operation}.${logical.port}`)!, type: renderTypes.visual, moduleId: ranking.id, surface: kind, output: "visual", outputKey: `${logical.operation}.${logical.port}`, authorKey: "", authorGraph: graph, authoring, values, inputs: {}, executionEdges: edges, supports: { program }, provenance: { kind: "author" }, timeline: domain.timeline, document: { version: VISUAL_IR_VERSION, compositionKey: "fixture", domain: { axisKey: domain.timeline.axisKey, clock: domain.timeline.clock, totalFrames: 120, totalSamples48k: 192000 }, extent: { widthPx: 960, heightPx: 540 }, resources: [], surfaces: [], html: "" }, fallback: emptyProjection };
  input.authorKey = authorFor(input, domain.schedule.trackKey)!.authorKey;
  return input;
}

test("Column child reveals stay disjoint while settled item visibility accumulates; real shared Recipe and Frame own controls", t => {
  const input = fixture(t, "Column", '<r:ColumnItem id="late" label="Late" rank="2" preset="true"/><r:ColumnItem id="first" label="First" rank="1" preset="true"/>');
  const original = input.supports.program!.data as unknown as RankingProgram;
  const items = original.schedule.items.map((item, windowIndex) => ({ itemKey: item.itemKey, label: item.label!, rank: item.rank!, preset: false, windowIndex }));
  const windows = items.map((item, index) => projectWindow(original.timeline, { kind: "edges", start: index === 0 ? "40f" : "5f", end: index === 0 ? "70f" : "25f" }, item.itemKey));
  const program = assembleRanking(original.timeline, { kind: "Column", trackKey: original.schedule.trackKey, items }, original.style, original.frame, original.schedule.outer, windows, [], [], [], original.canvas);
  const result = projectRanking({ ...input, value: { type: renderTypes.visual, data: lowerRanking(program) as unknown as Json }, supports: { program: { type: rankingTypes.program, data: program as unknown as Json } } });
  const late = result.entities.find(entity => entity.title === "Late")!;
  const first = result.entities.find(entity => entity.title === "First")!;
  assert.deepEqual(late.intervals, [{ start: 40, end: 70 }]);
  assert.deepEqual(first.intervals, [{ start: 5, end: 25 }]);
  assert.deepEqual(late.visibleIntervals, [{ start: 40, end: 70 }, { start: 70, end: 120 }]);
  assert.deepEqual(first.visibleIntervals, [{ start: 5, end: 25 }, { start: 25, end: 120 }]);
  assert.equal(result.entities[0]!.pictureParts.some(part => first.pictureParts.includes(part)), false);
  const fields = result.fieldGroups.flatMap(group => group.fields);
  assert.equal(fields.find(field => field.label === "rank" && field.ownerKey === first.authorKey)!.authorValue, 1);
  assert.equal(fields.find(field => field.label === "padding")!.endpointKey !== undefined, true);
});

test("TopThree activation stages differ from cumulative render visibility and map only their own parts", t => {
  const input = fixture(t, "TopThree", '<r:TopThreeItem id="later" label="Later" at="60f"/><r:TopThreeItem id="first" label="First" at="20f"/>');
  const result = projectRanking(input);
  assert.deepEqual(result.lanes.map(lane => [lane.height, lane.parentLaneKey]), [[80, undefined], [40, result.lanes[0]!.key]]);
  const later = result.entities.find(entity => entity.title === "Later")!;
  const first = result.entities.find(entity => entity.title === "First")!;
  assert.deepEqual(later.intervals, [{ start: 60, end: 100 }]);
  assert.deepEqual(later.visibleIntervals, [{ start: 60, end: 120 }]);
  assert.deepEqual(first.intervals, [{ start: 20, end: 60 }]);
  assert.deepEqual(first.visibleIntervals, [{ start: 20, end: 120 }]);
  assert.ok(later.temporal[0]!.instant);
  assert.equal(later.temporal[0]!.consumerPort, "instants");
  assert.equal(later.sourceSlice!.span.start, input.authoring.elements.get(later.authorKey)!.elementSpan.start);
  assert.equal(result.entities[0]!.pictureParts.some(part => later.pictureParts.includes(part)), false);
  const gain = result.fieldGroups.flatMap(group => group.fields).find(field => field.label === "appear-gain")!;
  assert.equal(gain.authorValue, 2);
  assert.equal(gain.displayScale, 100);
  assert.equal(gain.binding!.ownerKey, result.parameterOwners.find(owner => owner.value.type.endsWith("#Recipe"))!.key);
  assert.equal(gain.readonly, undefined);
  assert.deepEqual(result.fieldGroups.find(group => group.sectionKey === "Frame")!.fields.map(field => field.authorValue), ["40px", "30px", "840px", "430px"]);
});

test("Ranking sound uses real audio material and cannot drag or edit visual-trigger timing", t => {
  const input = fixture(t, "TopThree", '<r:TopThreeItem id="first" label="First" at="20f"/>');
  const program = input.supports.program!.data as unknown as RankingProgram;
  const sound: SynchronizedMedia = { clock: program.timeline.clock, totalFrames: 90, sound: { resource: { $resource: "sound", bytes: 100, mime: "audio/wav" }, totalSamples: 144000 } };
  const produced = ranking.producers.audio!.run({ program: input.supports.program!, soundStyle: { type: rankingTypes.sound, data: program.style.sound }, appear: { type: "dsivio-video/pipeline@1#SynchronizedMedia", data: sound as unknown as Json } });
  const result = projectRankingAudio({ ...input, value: produced.outputs!.audio!, type: renderTypes.audio, output: "audio" });
  assert.equal(result.lanes[0]!.height, 48);
  assert.equal(result.lanes[0]!.parentLaneKey, undefined);
  assert.deepEqual(result.entities[0]!.intervals, [{ start: 20, end: 110 }]);
  assert.deepEqual(result.entities[0]!.temporal.map(authority => authority.gestures), [[]]);
  assert.equal(result.entities[0]!.temporal[0]!.consumerPort, "visual-trigger");
  assert.equal(result.entities[0]!.temporal[0]!.binding!.access, "read");
  const trigger = result.fieldGroups.flatMap(group => group.fields).find(field => field.label === "appear trigger")!;
  assert.equal(trigger.authorValue, 20);
  assert.equal(trigger.readonly, true);
  assert.equal(trigger.endpointKey, undefined);
  assert.equal(result.materials[0]!.resource, sound.sound!.resource);
  assert.equal(result.fieldGroups.find(group => group.domain === "When")!.fields[0]!.authorValue, 3);
  assert.equal(result.fieldGroups.flatMap(group => group.fields).some(field => field.label === "appear-frames"), false);
  const selectedGroups = result.entities[0]!.fieldGroupKeys!.map(key => result.fieldGroups.find(group => group.key === key)!);
  assert.equal(selectedGroups.every(group => group.sectionKey === "Sound"), true);
  const allGroups = [...projectRanking(input).fieldGroups, ...result.fieldGroups];
  const selectedFields = allGroups.filter(group => result.entities[0]!.fieldGroupKeys!.includes(group.key)).flatMap(group => group.fields);
  assert.equal(selectedFields.some(field => field.label === "appear-gain"), true);
  assert.equal(selectedFields.some(field => field.label === "appear-frames"), false);
});

test("TierBoard direct entrance, tier and stacking controls use the child; icon material is actual source and board fields remain shape-specific", t => {
  const input = fixture(t, "TierBoard", '<r:TierItem id="reveal" tier="s" icon={icon} during="program" entry="direct" stack="33"/><r:TierItem id="preset" tier="a" icon={icon} preset="true"/>');
  const result = projectRanking(input);
  const item = result.entities.find(entity => entity.facts.preset === false)!;
  const fields = result.fieldGroups.filter(group => group.ownerKey === item.authorKey).flatMap(group => group.fields);
  assert.equal(fields.find(field => field.label === "tier")!.authorValue, "s");
  assert.equal(fields.find(field => field.label === "stack")!.authorValue, 33);
  assert.deepEqual(fields.find(field => field.label === "entry")!.options!.map(option => option.value), ["direct", "drop"]);
  assert.equal(fields.find(field => field.label === "icon")!.readonly, true);
  assert.deepEqual(item.temporal[0]!.window!.frames, { start: 0, end: 120 });
  const program = input.supports.program!.data as unknown as RankingProgram;
  assert.equal(result.materials.find(material => item.materials!.includes(material.key))!.resource, program.schedule.items[0]!.icon);
  const recipeFields = result.fieldGroups.filter(group => group.ownerKey !== item.authorKey).flatMap(group => group.fields);
  assert.equal(recipeFields.find(field => field.label === "rows")!.widget, "list");
  assert.equal(recipeFields.some(field => field.label === "font-size"), false);
  assert.throws(() => projectRanking({ ...input, supports: {} }), { code: "STUDIO_SUPPORT" });
});

test("A real Style root and its board share one canonical parameter owner without conflicting projection DTOs", t => {
  const board = fixture(t, "TopThree", '<r:TopThreeItem id="first" label="First" at="20f"/>');
  const logical = board.authorGraph.outputs.get("style")!;
  const outputKey = `${logical.operation}.${logical.port}`;
  const value = board.values!.get(outputKey)!;
  const author = authorFor(board, outputKey)!;
  const style: CompanionInput = { ...board, value, type: value.type, output: "", outputKey, authorKey: author.authorKey, surface: "TopThreeStyle", supports: {} };
  const projection = createProjection([board, style], ranking.studio!);
  const styleOwner = projection.parameterOwners.find(owner => owner.authorKey === author.authorKey)!;
  assert.equal(projection.parameterOwners.filter(owner => owner.authorKey === author.authorKey).length, 1);
  assert.equal(styleOwner.value, value);
  assert.equal(styleOwner.bindings.find(binding => binding.attribute === "recipe")!.access, "read");
  assert.equal(projection.entities[0]!.parameterOwners.includes(styleOwner.key), true);
});
