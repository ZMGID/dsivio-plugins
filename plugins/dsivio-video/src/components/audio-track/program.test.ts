import test from "node:test";
import assert from "node:assert/strict";
import { lowerAudio, durationSamples } from "./lower.ts";
import { projectWindow } from "../../timeline/temporal.ts";
import { frameToSample48k } from "../../timeline/math.ts";
import type { Timeline, SynchronizedMedia } from "../../timeline/types.ts";
import type { AudioItemPlan, AudioProgram } from "./types.ts";
const timeline: Timeline = { axisKey: "audio-axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 90, placements: [] };
const source: SynchronizedMedia = { clock: timeline.clock, totalFrames: 12, sound: { resource: { $resource: "wav", bytes: 100, mime: "audio/wav" }, totalSamples: 19200 } };
function program(playback: AudioItemPlan["playback"], overrides: Partial<AudioItemPlan> = {}, start = 6, end = 36): AudioProgram {
  const plan: AudioItemPlan = { itemKey: "music", sourceIndex: 0, windowIndex: 0, playback, gain: 1, trimStart: "0f", fadeIn: "0f", fadeOut: "0f", ...overrides };
  return { trackKey: "audio", timeline, items: [{ plan, source, window: projectWindow(timeline, { kind: "edges", start: `${start}f`, end: `${end}f` }, plan.itemKey) }] };
}
test("once modes use only actual source duration and align the appropriate edge", () => {
  const start = lowerAudio(program("once")).clips[0]!, end = lowerAudio(program("once-end")).clips[0]!;
  assert.deepEqual(start.targetSamples, { start: 9600, end: 28800 });
  assert.deepEqual(end.targetSamples, { start: 38400, end: 57600 });
  const tail = lowerAudio(program("once-end", {}, 0, 6)).clips[0]!;
  assert.deepEqual(tail.sourceSamples, { start: 9600, end: 19200 });
});
test("loop-end wraps with tail-aligned phase and independently specified trims", () => {
  const clip = lowerAudio(program("loop-end", { trimStart: "100ms" })).clips[0]!;
  assert.deepEqual(clip.sourceSamples, { start: 4800, end: 19200 });
  assert.equal(clip.loop!.phaseSamples, 9600);
  assert.deepEqual(clip.targetSamples, { start: 9600, end: 57600 });
});
test("stretch checks bounds and preserves pitch using exact source/target sample ratio", () => {
  const clip = lowerAudio(program("stretch", { minRate: .3, maxRate: .5 })).clips[0]!;
  assert.deepEqual(clip.speed, { numerator: 19200, denominator: 48000 }); assert.equal(clip.preservePitch, true);
  assert.throws(() => lowerAudio(program("stretch", { minRate: .5, maxRate: 2 })), /outside/);
  assert.throws(() => lowerAudio(program("once", { minRate: 1 })), /only valid/);
});
test("trim and fades reject inaudible or source-out-of-range intervals", () => {
  assert.throws(() => lowerAudio(program("once", { trimStart: "12f" })), /Trim/);
  assert.throws(() => lowerAudio(program("once", { trimEnd: "13f" })), /Trim/);
  assert.throws(() => lowerAudio(program("once", { fadeIn: "13f" })), /audible/);
  assert.equal(lowerAudio(program("once", { fadeIn: "12f", fadeOut: "12f", gain: 0 })).clips[0]!.gain, 0);
});
test("fractional-rate absolute target boundaries are not accumulated frame samples", () => {
  const clock = { fps: { numerator: 30000, denominator: 1001 } };
  assert.equal(durationSamples("1f", clock), 1602);
  assert.equal(frameToSample48k(2, clock) - frameToSample48k(1, clock), 1601);
});
test("independent overlapping Items remain additive and a zero gain does not mask another", () => {
  const p = program("once", { gain: 0 }); const second = program("once", { itemKey: "other", gain: 2 }).items[0]!;
  p.items.push(second); const clips = lowerAudio(p).clips;
  assert.deepEqual(clips.map(c => c.gain), [0, 2]); assert.deepEqual(clips[0]!.targetSamples, clips[1]!.targetSamples);
});
