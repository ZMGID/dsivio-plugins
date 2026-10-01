import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScript } from "./script.ts";
import { assembleTimeline, parseClock } from "./timeline.ts";
import { projectInstant, projectWindow, consumeWindow, scheduleStages, validateSiblingWindows } from "./temporal.ts";
import { adjustTake } from "./adjust.ts";
import { validateNarrative, validateSemanticTake, validateTimeline, validateWindow } from "./validate.ts";
import { runTool } from "../tools/index.ts";
import type { Narrative, SemanticTake, SynchronizedMedia } from "./types.ts";

function take(n: Narrative, index: number, frames = 30): SemanticTake {
  const segment = n.segments[index]!;
  const media: SynchronizedMedia = { clock: parseClock("30"), totalFrames: frames, picture: { resource: { $resource: "test-picture", bytes: 1, mime: "video/mp4" }, extent: { widthPx: 64, heightPx: 64 }, alpha: "opaque" } };
  const tokens = n.tokens.slice(segment.tokenBounds.start, segment.tokenBounds.end).map((t, i) => ({ tokenKey: t.tokenKey, frames: { start: i * 5 + 2, end: i * 5 + 5 } }));
  const anchorFrames: Record<string, number> = { [segment.anchors.start]: 0, [segment.anchors.end]: frames };
  tokens.forEach((t, i) => { const token = n.tokens[segment.tokenBounds.start + i]!; anchorFrames[token.anchors.start] = t.frames.start; anchorFrames[token.anchors.end] = t.frames.end; });
  const result = { storyKey: n.storyKey, storyAnchors: n.storyAnchors, segment, media, tokens, anchorFrames }; validateSemanticTake(result); return result;
}

test("Timeline preserves declaration order, gaps, overlaps and maximum content end", () => {
  const n = parseScript('<a>first</a><b>second</b><c/>', "story").narrative;
  const result = assembleTimeline(parseClock("30"), [take(n, 0, 90), take(n, 1), take(n, 2)], { timelineKey: "test-timeline", placements: [{ placementKey: "a", at: "0f" }, { placementKey: "b", at: "10f" }, { placementKey: "c", at: "previous.end+5f" }] }, "content.end+3f");
  assert.deepEqual(result.placements.map(p => p.offsetFrames), [0, 10, 45]);
  assert.equal(result.totalFrames, 93);
  assert.equal(projectWindow(result, { kind: "during", source: n.segments[2]! }, "window").frames.start, 45);
  assert.deepEqual(projectWindow(result, { kind: "during", source: "program" }, "all").frames, { start: 0, end: 93 });
});

test("reordered Selection retains author content while physical reverse windows fail", () => {
  const n = parseScript('@{claim}<a>first</a><b>second</b>@{/claim}', "story").narrative;
  const timeline = assembleTimeline(parseClock("30"), [take(n, 1), take(n, 0)], { timelineKey: "test-timeline", placements: [{ placementKey: "b" }, { placementKey: "a" }] });
  // Outer story-bound selection spans the program; token-bound selection can reverse.
  const selection = { ...n.selections[0]!, anchors: { start: n.tokens[0]!.anchors.start, end: n.tokens[1]!.anchors.end } };
  assert.deepEqual(selection.tokenBounds, { start: 0, end: 2 });
  assert.equal(projectInstant(timeline, { kind: "at-boundary", source: selection, boundary: "start" }, "one").frame, 32);
  assert.throws(() => projectWindow(timeline, { kind: "during", source: selection }, "bad"), { code: "TYPE_INVALID" });
});

test("placement arithmetic rejects half frames and mismatched clocks, allows equivalent temporal rounding", () => {
  const n = parseScript('<a/>', "story").narrative; const source = take(n, 0);
  assert.throws(() => assembleTimeline(parseClock("30"), [source], { timelineKey: "test-timeline", placements: [{ placementKey: "x", at: "250ms" }] }), { code: "TIME_FRAME_BOUNDARY" });
  assert.throws(() => assembleTimeline(parseClock("60/2"), [source], { timelineKey: "test-timeline", placements: [{ placementKey: "x" }] }), { code: "TYPE_INVALID" });
  const timeline = assembleTimeline(parseClock("30"), [], { timelineKey: "test-timeline", placements: [] }, "60f");
  assert.equal(projectInstant(timeline, { kind: "at", source: "250ms" }, "round").frame, 8);
  assert.throws(() => projectInstant(timeline, { kind: "at", source: "2.001s" }, "outside"), { code: "TIME_OUTSIDE" });
  for (const expression of [".5s", "0.5f", "1e2s", "-1f", "2", "program.end+1f-1f"]) assert.throws(() => projectInstant(timeline, { kind: "expression", expression }, "bad"));
  assert.throws(() => assembleTimeline(parseClock("30"), [], { timelineKey: "test-timeline", placements: [] }), { code: "TIMELINE_EMPTY" });
});

test("equally timed empty programs retain distinct author axes and reject foreign windows", () => {
  const first = assembleTimeline(parseClock("30"), [], { timelineKey: "first", placements: [] }, "30f");
  const second = assembleTimeline(parseClock("30"), [], { timelineKey: "second", placements: [] }, "30f");
  const window = projectWindow(first, { kind: "during", source: "program" }, "one");
  assert.notEqual(first.axisKey, second.axisKey);
  assert.throws(() => consumeWindow(second, window, "two"), { code: "TIME_AXIS" });
  assert.equal(assembleTimeline(parseClock("30"), [], { timelineKey: "first", placements: [] }, "30f").axisKey, first.axisKey);
});

test("Temporal windows preserve endpoint provenance and rebind shared consumers", () => {
  const n = parseScript('<a>@{cue!}one two</a>', "story").narrative;
  const timeline = assembleTimeline(parseClock("30"), [take(n, 0)], { timelineKey: "test-timeline", placements: [{ placementKey: "a" }] });
  const window = projectWindow(timeline, { kind: "at", source: n.moments[0]!, duration: "250ms" }, "one");
  assert.deepEqual(window.frames, { start: 2, end: 10 });
  assert.equal(window.leading.editAuthority, "semantic-anchor"); assert.equal(window.trailing.editAuthority, "duration");
  const edges = projectWindow(timeline, { kind: "edges", start: "moment.cue+1f", startSource: n.moments[0]!, end: "program.end" }, "edges");
  assert.equal(edges.leading.origin.kind, "semantic"); assert.equal(edges.trailing.origin.kind, "program");
  const copied = consumeWindow(timeline, edges, "consumer"); assert.equal(copied.leading.consumerKey, "consumer"); assert.equal(copied.trailing.consumerKey, "consumer"); assert.deepEqual(copied.leading.origin, edges.leading.origin); assert.equal(edges.consumerKey, "edges");
  assert.throws(() => projectWindow(timeline, { kind: "at", source: "1ms", duration: "1ms" }, "empty"), { code: "TYPE_INVALID" });
});

test("Adjust updates only the named anchor and its token, allows zero width, preserves media", () => {
  const n = parseScript('<a>one @{cue!}two</a>', "story").narrative; const source = take(n, 0); const key = n.moments[0]!.anchorKey;
  const result = adjustTake(source, { storyKey: n.storyKey, edits: [{ anchorKey: key, localFrame: 10 }] });
  assert.strictEqual(result.media, source.media); assert.strictEqual(result.segment, source.segment);
  assert.deepEqual(result.tokens.map(t => t.frames), [{ start: 2, end: 5 }, { start: 10, end: 10 }]);
  assert.equal(source.anchorFrames[key], 7);
  assert.throws(() => adjustTake(source, { storyKey: n.storyKey, edits: [{ anchorKey: key, localFrame: 1 }] }), { code: "TYPE_INVALID" });
  assert.throws(() => adjustTake(source, { storyKey: n.storyKey, edits: [{ anchorKey: source.segment.anchors.start, localFrame: 1 }] }), { code: "TYPE_INVALID" });
  assert.throws(() => adjustTake(source, { storyKey: n.storyKey, edits: [{ anchorKey: key, localFrame: 7 }, { anchorKey: key, localFrame: 8 }] }), { code: "ADJUST_ANCHOR" });
});

test("disjoint sibling windows and trigger scheduling respect terminal and author order", () => {
  const timeline = assembleTimeline(parseClock("30"), [], { timelineKey: "test-timeline", placements: [] }, "30f");
  const a = projectWindow(timeline, { kind: "at", source: "0f", duration: "10f" }, "a"); const b = projectWindow(timeline, { kind: "at", source: "10f", duration: "10f" }, "b");
  validateSiblingWindows([b, a], "disjoint");
  assert.throws(() => validateSiblingWindows([a, projectWindow(timeline, { kind: "at", source: "9f", duration: "10f" }, "c")], "disjoint"), { code: "TIME_OVERLAP" });
  assert.deepEqual(scheduleStages({ start: 2, end: 30 }, [{ id: "a", frame: 2 }, { id: "b", frame: 12 }], 25), [{ id: "a", frames: { start: 2, end: 12 } }, { id: "b", frames: { start: 12, end: 25 } }]);
  assert.deepEqual(scheduleStages({ start: 2, end: 30 }, [{ id: "a", frame: 2 }, { id: "b", frame: 12 }], 25, "cumulative").map(s => s.frames.end), [30, 30]);
  assert.throws(() => scheduleStages({ start: 0, end: 30 }, [{ id: "x", frame: 10 }, { id: "y", frame: 9 }]), { code: "TIME_STAGE" });
});

test("validators reject corrupt ownership, inconsistent anchors and window consumer domains", () => {
  const n = parseScript('<a>one two</a>', "story").narrative;
  assert.throws(() => validateNarrative({ ...n, tokens: n.tokens.map((t, i) => i ? { ...t, turnKey: "missing" } : t) }), { code: "TYPE_INVALID" });
  const source = take(n, 0); assert.throws(() => validateSemanticTake({ ...source, anchorFrames: { ...source.anchorFrames, [n.tokens[0]!.anchors.start]: 4 } }), { code: "TYPE_INVALID" });
  const timeline = assembleTimeline(parseClock("30"), [source], { timelineKey: "test-timeline", placements: [{ placementKey: "a" }] });
  assert.throws(() => validateTimeline({ ...timeline, totalFrames: 29 }), { code: "TYPE_INVALID" });
  const window = projectWindow(timeline, { kind: "during", source: "program" }, "one"); assert.throws(() => validateWindow({ ...window, leading: { ...window.leading, consumerKey: "other" } }), { code: "TYPE_INVALID" });
});

test("real CFR clip can back an empty semantic segment through timeline and projection", async t => {
  const directory = await mkdtemp(join(tmpdir(), "dv-time-")); t.after(() => rm(directory, { recursive: true, force: true })); const path = join(directory, "clip.mp4");
  await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=teal:s=64x64:r=30", "-frames:v", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
  const proof = await runTool("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,r_frame_rate", "-of", "json", path]);
  const info = JSON.parse(proof.stdout.toString()); assert.equal(info.streams[0].nb_read_frames, "30"); assert.equal(info.streams[0].r_frame_rate, "30/1");
  const n = parseScript('<silent/>', "story").narrative; const source = take(n, 0); source.media.picture!.resource.bytes = (await stat(path)).size;
  const timeline = assembleTimeline(parseClock("30"), [source], { timelineKey: "test-timeline", placements: [{ placementKey: "silent", at: "15f" }] }, "content.end+15f");
  assert.deepEqual(projectWindow(timeline, { kind: "during", source: n.segments[0]! }, "clip").frames, { start: 15, end: 45 }); assert.equal(timeline.totalFrames, 60);
});
