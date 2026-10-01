import assert from "node:assert/strict";
import test from "node:test";
import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import { assembleTimeline } from "../../timeline/timeline.ts";
import { projectInstant } from "../../timeline/temporal.ts";
import { validateVisualTrack, sampleFrame } from "../../render/validate.ts";
import { assembleDeck, deckStages, depthPose, parseDeckStyle } from "./program.ts";
import { lowerDeck } from "./lower.ts";
import type { MediaSource } from "../media-track/types.ts";
import type { DeckPlan } from "./types.ts";

const timeline = assembleTimeline({ fps: { numerator: 30, denominator: 1 } }, [], { timelineKey: "deck-tests", placements: [] }, "100f");
const canvas = { canvasKey: "canvas", extent: { widthPx: 320, heightPx: 240 } };
const frame = { canvasKey: "canvas", rect: { xPx: 60, yPx: 50, widthPx: 200, heightPx: 140 } };
const image: MediaSource = { kind: "image", resource: { $resource: "image", bytes: 1, mime: "image/png" }, extent: { widthPx: 200, heightPx: 140 } };
const media: MediaSource = { kind: "media", media: { clock: timeline.clock, totalFrames: 20, picture: { resource: { $resource: "clip", bytes: 1, mime: "video/mp4" }, extent: image.extent, alpha: "opaque" } } };
function deck(appearance: Record<string, Json> = {}, source: MediaSource = image, at = [0, 30, 60], overrides: DeckPlan["cards"] = at.map((_, index) => ({ cardKey: `card-${index}` }))) {
  return assembleDeck(timeline, canvas, frame, { trackKey: "deck", appearance, cards: overrides }, at.map(() => source), at.map((value, index) => projectInstant(timeline, { kind: "at", source: `${value}f` }, overrides[index]!.cardKey)), projectInstant(timeline, { kind: "at", source: "100f" }, "deck"), []);
}
function code(expected: string) { return (error: unknown) => error instanceof DvError && error.code === expected; }

test("depth uses real author *-step tone factors, powers and signed linear offsets", () => {
  const style = parseDeckStyle({ "previous-brightness-step": 0.5, "previous-contrast-step": 1.5, "previous-saturation-step": 0.25, "next-brightness-step": 0.75, "next-contrast-step": 2, "next-saturation-step": 0.5 });
  const previous = depthPose(style, -2), next = depthPose(style, 2);
  assert.deepEqual([previous.y, previous.rotation, previous.scale, previous.opacity, previous.stacking, previous.brightness, previous.contrast, previous.saturation], [56, 2.5, 0.94 ** 2, 0.82 ** 2, -2, 0.25, 2.25, 0.0625]);
  assert.deepEqual([next.y, next.brightness, next.contrast, next.saturation], [-40, 0.5625, 4, 0.25]);
  assert.equal(depthPose(parseDeckStyle({ "previous-rotation-mode": "linear" }), -2).rotation, -5);
  assert.throws(() => deck({ "previous-brightness": 0.5 }), code("PERFORMANCE_RECIPE"));
});
test("reflow keeps the union of outgoing and incoming cards with one-stage interpolation", () => {
  const program = deck({ "visible-previous": 0, "visible-next": 0, "reflow-frames": 8 });
  const track = lowerDeck(program); validateVisualTrack(track);
  const exiting = track.presents.find(p => p.presentKey.includes("/1/card-0"))!, entering = track.presents.find(p => p.presentKey.includes("/1/card-1"))!;
  assert.deepEqual(exiting.lifetime, { start: 30, end: 38 });
  assert.deepEqual(entering.nodes[0]!.keyframes.map(k => k.declarations.find(d => d.property === "opacity")!.value), ["0", "1"]);
  assert.equal(track.presents[0]!.nodes[0]!.keyframes.length, 0);
});
test("wrapped neighbors do not reorder activations and duplicate depth occupancy fails", () => {
  const program = deck({ wrap: true, "visible-previous": 1, "visible-next": 1 });
  assert.deepEqual([...deckStages(program)[0]!.poses.keys()], [0, 2, 1]);
  assert.throws(() => deck({ wrap: true }), code("DECK_DEPTH"));
});
test("strict activation, terminal and reflow stage bounds are not repaired", () => {
  assert.throws(() => deck({}, image, [0, 30, 30]), code("DECK_TIME"));
  assert.throws(() => deck({}, image, [0, 30, 100]), code("DECK_TIME"));
  assert.throws(() => deck({ "reflow-frames": 41 }), code("DECK_REFLOW"));
});
test("active playback uses trim while future/head and past/tail are frozen", () => {
  const track = lowerDeck(deck({ playback: "hold-start", "trim-start": 3, "trim-end": 17 }, media));
  validateVisualTrack(track);
  for (const [stage, card, expected] of [[0, 1, 3], [1, 0, 16], [1, 1, 3]] as const) {
    const p = track.presents.find(p => p.presentKey.includes(`/${stage}/card-${card}`))!, node = p.nodes.find(n => n.kind === "video")!;
    assert.ok(node.kind === "video" && node.sampling);
    assert.equal(sampleFrame(node.sampling, 0), expected);
    if (stage !== card) assert.equal(sampleFrame(node.sampling, 10), expected);
  }
});
test("continue keeps absolute loop phase before and after activation", () => {
  const track = lowerDeck(deck({ playback: "loop-start", "playback-future": "continue", "playback-past": "continue", "trim-start": 3, "trim-end": 17 }, media));
  validateVisualTrack(track);
  for (const [stage, card, localFrame, expected] of [[0, 1, 0, 15], [1, 0, 0, 5], [2, 0, 5, 12]] as const) {
    const p = track.presents.find(p => p.presentKey.includes(`/${stage}/card-${card}`))!, node = p.nodes.find(n => n.kind === "video")!;
    assert.ok(node.kind === "video" && node.sampling); assert.equal(sampleFrame(node.sampling, localFrame), expected);
  }
  assert.throws(() => deck({ "playback-future": "continue" }, media), code("DECK_PLAYBACK"));
});
test("Card appearance overrides its depth pose and old cards hide after reflow", () => {
  const program = deck({ "playback-past": "hide", "reflow-frames": 8 }, image, [0, 30, 60], [{ cardKey: "card-0" }, { cardKey: "card-1", appearance: { "current-x": 17, "next-brightness-step": 0.4 } }, { cardKey: "card-2" }]);
  assert.equal(deckStages(program)[0]!.poses.get(1)!.brightness, 0.4);
  assert.equal(deckStages(program)[1]!.poses.get(1)!.x, 17);
  assert.ok(!deckStages(program)[1]!.poses.has(0));
  assert.deepEqual(lowerDeck(program).presents.find(p => p.presentKey.includes("/1/card-0"))!.lifetime, { start: 30, end: 38 });
});
test("still source playback, source clocks, invalid trim and consumed padding fail", () => {
  assert.throws(() => deck({ playback: "once-start" }), code("DECK_PLAYBACK"));
  assert.throws(() => deck({ "trim-start": 3, "trim-end": 22 }, media), code("DECK_TRIM"));
  assert.throws(() => deck({ padding: "100" }), code("PERFORMANCE_INSET"));
  assert.throws(() => deck({}, { ...media, media: { ...media.media, clock: { fps: { numerator: 24, denominator: 1 } } } }), code("MEDIA_CLOCK"));
});
