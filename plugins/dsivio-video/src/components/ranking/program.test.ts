import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FontFace } from "../../fonts/types.ts";
import type { Timeline, Window, Instant, SynchronizedMedia } from "../../timeline/types.ts";
import type { RankingAuthorPlan, RankingKind } from "./types.ts";
import { projectWindow, projectInstant } from "../../timeline/temporal.ts";
import { rankingStyle } from "./author.ts";
import { assembleRanking, rankingEvents, transitionFrames } from "./program.ts";
import { lowerRanking, lowerRankingAudio } from "./lower.ts";
import { validateRankingSchedule } from "./validate.ts";
import ranking from "../../modules/ranking/index.ts";
import { modules, findProducer, findFrontend, findModule } from "../../modules/index.ts";
import { compileAuthor } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
const timeline: Timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 120, placements: [] };
const face: FontFace = { faceKey: "inter", family: "inter", weight: 700, style: "normal", shards: [{ resource: { $resource: "font", bytes: 100, mime: "font/woff2" }, unicodeRange: "U+0-10FFFF" }], license: { spdx: "OFL-1.1", notice: { $resource: "license", bytes: 100, mime: "text/plain" } } };
const canvas = { canvasKey: "canvas", extent: { widthPx: 960, heightPx: 540 } }, frame = { canvasKey: "canvas", rect: { xPx: 40, yPx: 30, widthPx: 800, heightPx: 400 } };
const icon = { $resource: "icon", bytes: 100, mime: "image/png" };
const sound: SynchronizedMedia = { clock: timeline.clock, totalFrames: 90, sound: { resource: { $resource: "sound", bytes: 100, mime: "audio/wav" }, totalSamples: 144000 } };
function window(key: string, start: number, end: number): Window { return projectWindow(timeline, { kind: "edges", start: `${start}f`, end: `${end}f` }, key); }
function instant(key: string, frame: number): Instant { return projectInstant(timeline, { kind: "at", source: `${frame}f` }, key); }
function program(kind: RankingKind, items: RankingAuthorPlan["items"], windows: Window[] = [], instants: Instant[] = [], terminal = instant("terminal", 110)) {
  return assembleRanking(timeline, { kind, trackKey: "ranking", items }, rankingStyle(kind, "style", { rule: "ranking.test", properties: {} }, face), frame, window("ranking", 0, 120), windows, instants, [icon], ["Exact referenced label"], kind === "TopThree" ? undefined : canvas, kind === "TopThree" ? terminal : undefined);
}
test("Tier presets occupy inner cells before reveals sorted by time, not declaration", () => {
  const p = program("TierBoard", [{ itemKey: "late", tier: "s", preset: false, entry: "drop", iconIndex: 0, windowIndex: 0 }, { itemKey: "early", tier: "s", preset: false, entry: "direct", iconIndex: 0, windowIndex: 1 }, { itemKey: "preset", tier: "s", preset: true, iconIndex: 0 }], [window("late", 40, 70), window("early", 5, 25)]);
  assert.deepEqual(p.schedule.items.map(i => i.slot), [2, 1, 0]);
  assert.deepEqual(p.schedule.items[0]!.settled, { start: 70, end: 120 });
  assert.deepEqual(rankingEvents(p).events.map(e => [e.itemKey, e.kind, e.frame]), [["early", "appear", 5], ["late", "appear", 40], ["late", "move", 56]]);
  const visual = lowerRanking(p); assert.deepEqual(visual.presents.find(i => i.presentKey === "early/settled")!.lifetime, { start: 25, end: 120 });
});
test("Tier rejects unknown rows, capacity overflow, short windows and overlap", () => {
  const item = { itemKey: "i", tier: "s", preset: false, entry: "drop" as const, iconIndex: 0, windowIndex: 0 };
  assert.throws(() => program("TierBoard", [{ ...item, tier: "unknown" }], [window("i", 0, 20)]), { code: "RANKING_TIER" });
  assert.throws(() => program("TierBoard", [item], [window("i", 0, 1)]), { code: "RANKING_WINDOW" });
  assert.throws(() => program("TierBoard", [item, { ...item, itemKey: "j", windowIndex: 1 }], [window("i", 10, 30), window("j", 20, 40)]), { code: "TIME_OVERLAP" });
  assert.throws(() => program("TierBoard", Array.from({ length: 12 }, (_, index) => ({ itemKey: `i${index}`, tier: "s", preset: true, iconIndex: 0 }))), { code: "RANKING_CAPACITY" });
});
test("Column resolves labels and ranks, preserves final rows and compresses transitions", () => {
  const p = program("Column", [{ itemKey: "second", rank: 2, textIndex: 0, preset: false, windowIndex: 0 }, { itemKey: "first", rank: 1, label: "First", preset: true }], [window("second", 10, 13)]);
  const second = p.schedule.items[0]!; assert.equal(second.label, "Exact referenced label"); assert.equal(second.slot, 1); assert.equal(p.schedule.items[1]!.slot, 0);
  assert.deepEqual([second.appearFrames, second.moveFrames, second.moveFrame], [1, 2, 11]);
  assert.deepEqual(transitionFrames(1, 6, 8), { appear: 0, move: 0 });
  const one = program("Column", [{ itemKey: "one", rank: 1, label: "One", preset: false, windowIndex: 0 }], [window("one", 10, 11)]); assert.equal(one.schedule.items[0]!.moveFrame, undefined); assert.equal(lowerRanking(one).presents.find(p => p.presentKey === "one/active")!.nodes[0]!.keyframes.length, 0);
  assert.throws(() => program("Column", [{ itemKey: "a", rank: 1, label: "A", preset: true }, { itemKey: "b", rank: 1, label: "B", preset: true }]), { code: "RANKING_RANK" });
});
test("TopThree sorts activations into slots and persists after terminal", () => {
  const p = program("TopThree", [{ itemKey: "later", label: "Later", preset: false, instantIndex: 0, iconIndex: 0 }, { itemKey: "first", label: "First", preset: false, instantIndex: 1 }], [], [instant("later", 60), instant("first", 20)], instant("terminal", 100));
  assert.deepEqual(p.schedule.items.map(i => [i.slot, i.active, i.settled]), [[1, { start: 60, end: 100 }, { start: 100, end: 120 }], [0, { start: 20, end: 60 }, { start: 60, end: 120 }]]);
  assert.deepEqual(rankingEvents(p).events.map(e => e.kind), ["appear", "appear"]);
  const track = lowerRanking(p); assert.deepEqual(track.presents.find(p => p.presentKey === "later/active")!.lifetime, { start: 60, end: 120 });
  assert.equal(track.presents.find(p => p.presentKey === "later/active")!.nodes[0]!.kind, "box");
  assert.throws(() => program("TopThree", [{ itemKey: "a", label: "A", preset: false, instantIndex: 0 }, { itemKey: "b", label: "B", preset: false, instantIndex: 1 }], [], [instant("a", 20), instant("b", 20)]), { code: "TIME_STAGE" });
  const boundary = projectInstant(timeline, { kind: "expression", expression: "program.end" }, "terminal"); assert.throws(() => program("TopThree", [{ itemKey: "a", label: "A", preset: false, instantIndex: 0 }], [], [instant("a", 20)], boundary), { code: "RANKING_TERMINAL" });
});
test("One-frame TopThree stage is immediately visible instead of permanently transparent", () => {
  const p = program("TopThree", [{ itemKey: "a", label: "A", preset: false, instantIndex: 0 }], [], [instant("a", 20)], instant("terminal", 21));
  assert.equal(p.schedule.items[0]!.appearFrames, 0); assert.deepEqual(lowerRanking(p).presents[1]!.nodes[0]!.keyframes, []);
});
test("Sound starts at true compressed movement frame and extends beyond board outer", () => {
  const style = rankingStyle("Column", "style", { rule: "ranking.sound", properties: { "appear-gain": 2, "move-gain": .5, "sound-fade-frames": 3 } }, face);
  const p = assembleRanking(timeline, { kind: "Column", trackKey: "ranking", items: [{ itemKey: "i", rank: 1, label: "I", preset: false, windowIndex: 0 }] }, style, frame, window("ranking", 0, 40), [window("i", 20, 23)], [], [], [], canvas);
  const audio = lowerRankingAudio(p, style.sound, { appear: sound, move: sound });
  assert.deepEqual(audio.clips.map(c => [c.targetSamples.start, c.targetSamples.end, c.gain, c.fadeInSamples, c.fadeOutSamples]), [[32000, 176000, 2, 4800, 0], [33600, 177600, .5, 4800, 0]]);
  const preset = program("Column", [{ itemKey: "p", rank: 1, label: "P", preset: true }]); assert.deepEqual(lowerRankingAudio(preset, preset.style.sound, { appear: sound }).clips, []); assert.throws(() => lowerRankingAudio(preset, preset.style.sound, { move: sound }), { code: "RANKING_SOUND" });
});
test("Sound truncates only at Timeline end and rejects nonaudio normalized material", () => {
  const p = program("TopThree", [{ itemKey: "a", label: "A", preset: false, instantIndex: 0 }], [], [instant("a", 100)], instant("terminal", 110)); const audio = lowerRankingAudio(p, p.style.sound, { appear: sound });
  assert.deepEqual(audio.clips[0]!.targetSamples, { start: 160000, end: 192000 }); assert.deepEqual(audio.clips[0]!.sourceSamples, { start: 0, end: 32000 });
  assert.throws(() => lowerRankingAudio(p, p.style.sound, { move: sound }), { code: "RANKING_SOUND" });
  assert.throws(() => lowerRankingAudio(p, p.style.sound, { appear: { clock: timeline.clock, totalFrames: 90, picture: { resource: { $resource: "picture", bytes: 100, mime: "video/mp4" }, extent: canvas.extent, alpha: "opaque" } } }), { code: "RANKING_SOUND" });
});
test("Recipes keep shape-specific defaults and reject foreign keys or invalid rows", () => {
  const tier = rankingStyle("TierBoard", "style", { rule: "ranking.tier", properties: {} }, face); assert.equal(tier.properties["appear-frames"], 8); assert.equal(tier.properties["board-background"], "#2b2b30");
  assert.throws(() => rankingStyle("TierBoard", "style", { rule: "ranking.tier", properties: { "font-size": 28 } }, face), { code: "TYPE_INVALID" });
  assert.throws(() => rankingStyle("Column", "style", { rule: "ranking.column", properties: { "icon-size": 0 } }, face), { code: "RANKING_RECIPE" });
  assert.throws(() => rankingStyle("TierBoard", "style", { rule: "ranking.tier", properties: { rows: [{ id: "s", label: "S", color: "#ffffff" }, { id: "s", label: "Again", color: "#ffffff" }] } }, face), { code: "RANKING_RECIPE" });
  const p = program("Column", [{ itemKey: "a", label: "A", rank: 1, preset: true }]); assert.throws(() => validateRankingSchedule({ ...p.schedule, items: [{ ...p.schedule.items[0]!, settled: { start: 1, end: 120 } }] }), { code: "TYPE_INVALID" });
});
test("Author surface restricts during containers and terminal absolute/Moment while accepting full Item I", t => {
  const root = mkdtempSync(join(tmpdir(), "dv-ranking-author-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "look.dvs"), '<?dvml using="dsivio-video/dvs@1"?><sheet version="1">ranking.style {} </sheet>');
  const registry = { findModule: (id: string) => id === ranking.id ? ranking : findModule(id), findProducer: (ref: string) => ref.startsWith(ranking.id + "#") ? ranking.producers[ref.slice(ranking.id.length + 1)] : findProducer(ref), findFrontend };
  const base = '<?dvml using="dsivio-video/markup@1"?><dvml><import from="dsivio-video/ranking@1" as="r"/><import from="dsivio-video/time@1" as="time"/><import from="dsivio-video/fonts@1" as="font"/><import from="dsivio-video/space@1" as="space"/><import source="./look.dvs" as="look"/><time:Timeline id="tl" frame-rate="30" end="120f"/><space:Canvas id="canvas" width="960" height="540"/><space:Frame id="frame" within={canvas} left="40px" top="30px" right="840px" bottom="430px"/><font:Face id="font" family="inter" weight="700" style="normal"/><r:TopThreeStyle id="style" recipe={look.ranking.style} font={font}/>';
  const compile = (attrs: string, item = 'at="20f"') => { writeFileSync(join(root, "main.dvml"), `${base}<r:TopThree id="rank" timeline={tl} frame={frame} style={style} during="program" ${attrs}><r:TopThreeItem label="A" ${item}/></r:TopThree></dvml>`); return compileAuthor(join(root, "main.dvml"), Workspace.open({ cwd: root }), registry); };
  const graph = compile('terminal="100f"', 'instant="program.start+20f"'); assert.ok(graph.outputs.has("rank.schedule")); assert.equal(graph.outputs.has("rank.audio"), false);
  assert.throws(() => compile('terminal="program.end"'), { code: "RANKING_TERMINAL" });
  assert.throws(() => compile('terminal="100f" boundary="end"'), { code: "MARKUP_ATTRIBUTE" });
  assert.throws(() => compile('terminal="100f" move-sound={font}'), { code: "MARKUP_ATTRIBUTE" });
  assert.throws(() => compile('terminal="100f" start="0f" end="120f"'), { code: "MARKUP_ATTRIBUTE" });
});
