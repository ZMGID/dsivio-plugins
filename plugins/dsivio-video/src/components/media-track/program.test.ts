import test from "node:test";
import assert from "node:assert/strict";
import { assembleMediaProgram } from "./program.ts";
import { lowerMediaVisual, lowerMediaAudio } from "./lower.ts";
import { visualSampling } from "./source.ts";
import { parseMotion, motionKeyframes } from "./motion.ts";
import { parseAppearance } from "./appearance.ts";
import { validateVisualTrack, validateAudioTrack } from "../../render/validate.ts";
import { composeComposition } from "../../render/composition.ts";
import type { MediaInputs, MediaPlan, MediaPlayback } from "./types.ts";
import type { Timeline, SynchronizedMedia } from "../../timeline/types.ts";
const timeline: Timeline = { axisKey: "media-axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 90, placements: [] };
const canvas = { canvasKey: "canvas", extent: { widthPx: 320, heightPx: 180 } }, frame = { canvasKey: "canvas", rect: { xPx: 40, yPx: 30, widthPx: 200, heightPx: 100 } };
const media: SynchronizedMedia = { clock: timeline.clock, totalFrames: 90, picture: { resource: { $resource: "picture", bytes: 100, mime: "video/mp4" }, extent: { widthPx: 100, heightPx: 100 }, alpha: "opaque" }, sound: { resource: { $resource: "sound", bytes: 100, mime: "audio/wav" }, totalSamples: 144000 } };
function setup(audio = true): { plan: MediaPlan; inputs: MediaInputs } {
  const properties = { "stack-order": 4, "frame-paint": "#222222", padding: "10", "border-width": 2, "border-color": "#FFFFFF" };
  const units = [0, 30].map((at, i) => ({ id: `member${i}`, instant: { kind: "at" as const, source: `${at}f` as `${number}f` }, audioGain: 1, ...(audio ? { sourceAudio: "content" } : {}), layers: [{ id: "content", kind: "media" as const, sourceIndex: i, properties, sampling: [] }] }));
  return { plan: { trackKey: "track", hasAudio: audio, groups: [{ id: "sequence", frameIndex: 0, properties, motion: parseMotion({ enter: "fade", "enter-frames": 6, exit: "slide", "exit-frames": 6, "exit-direction": "right" }), until: { kind: "at", source: "60f" }, units, handoffs: [{ id: "swap", from: "member0", operator: "crossfade", duration: 10, ratio: .4, audio: audio ? "crossfade" : "cut" }], sounds: [] }] }, inputs: { frames: [frame], images: [], media: [media, media], surfaces: [], extents: [], clips: [], windows: [] } };
}
function sampled(mode: MediaPlayback, f: number, sourceLength = 4, targetLength = 7): number | null {
  const map = visualSampling(timeline.clock, sourceLength, { start: 0, end: sourceLength }, mode, { start: 0, end: targetLength }, { start: 0, end: targetLength });
  const p = map.pieces.find(p => f >= p.target.start && f < p.target.end); if (!p) return null;
  let value = p.sourceStart.numerator / p.sourceStart.denominator + (f - p.target.start) * p.sourceStep.numerator / p.sourceStep.denominator;
  if (p.loop) value = p.loop.sourceFrames.start + ((value - p.loop.sourceFrames.start) % (p.loop.sourceFrames.end - p.loop.sourceFrames.start)); return Math.floor(value);
}
test("visual playback modes preserve head/tail phase, hold only pictures and wrap loops", () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, f) => sampled("once-start", f)), [0, 1, 2, 3, null, null, null]);
  assert.deepEqual(Array.from({ length: 7 }, (_, f) => sampled("once-end", f)), [null, null, null, 0, 1, 2, 3]);
  assert.deepEqual(Array.from({ length: 7 }, (_, f) => sampled("hold-start", f)), [0, 1, 2, 3, 3, 3, 3]);
  assert.deepEqual(Array.from({ length: 7 }, (_, f) => sampled("hold-end", f)), [0, 0, 0, 0, 1, 2, 3]);
  assert.deepEqual(Array.from({ length: 7 }, (_, f) => sampled("loop-end", f)), [1, 2, 3, 0, 1, 2, 3]);
  assert.deepEqual(Array.from({ length: 4 }, (_, f) => sampled("stretch", f, 8, 4)), [0, 2, 4, 6]);
  const early = visualSampling(timeline.clock, 4, { start: 0, end: 4 }, "hold-start", { start: 0, end: 5 }, { start: 10, end: 15 });
  assert.deepEqual(early.pieces.map(p => ({ target: p.target, source: p.sourceStart.numerator, step: p.sourceStep.numerator })), [{ target: { start: 0, end: 5 }, source: 0, step: 0 }]);
});
test("Sequence logical boundaries remain fixed while handoffs expand pictures and crossfade sound", () => {
  const { plan, inputs } = setup(), program = assembleMediaProgram(timeline, canvas, plan, inputs), group = program.groups[0]!;
  assert.deepEqual(group.handoffs[0]!.frames, { start: 26, end: 36 });
  assert.deepEqual(group.units.map(u => u.logical), [{ start: 0, end: 30 }, { start: 30, end: 60 }]);
  assert.deepEqual(group.units.map(u => u.visual), [{ start: 0, end: 36 }, { start: 26, end: 60 }]);
  const visual = lowerMediaVisual(program); validateVisualTrack(visual);
  assert.equal(visual.presents[0]!.lifetime.end, 60); assert.equal(visual.presents[0]!.nodes[0]!.keyframes.at(-1)!.offsetFrames, 60);
  const audio = lowerMediaAudio(program); validateAudioTrack(audio);
  const film = composeComposition("film", canvas, timeline, { background: "#000000" }, [visual], [audio]);
  assert.deepEqual(film.audioTracks[0]!.clips.map(c => c.targetSamples), [{ start: 0, end: 57600 }, { start: 41600, end: 96000 }]);
  assert.deepEqual(audio.clips[1]!.gainCurve.slice(0, 2), [{ sample: 41600, gain: 0 }, { sample: 57600, gain: 1 }]);
});
test("Sound handoff fires on logical activation; exit fires at start of exit motion", () => {
  const { plan, inputs } = setup(); plan.groups[0]!.sounds = [{ id: "swap-sfx", sourceIndex: 0, gain: 2, handoff: "swap" }, { id: "exit-sfx", sourceIndex: 0, gain: 1, at: "exit" }];
  const p = assembleMediaProgram(timeline, canvas, plan, inputs); assert.deepEqual(p.groups[0]!.sounds.map(s => s.frame), [30, 54]);
  const clips = lowerMediaAudio(p).clips.slice(-2); assert.deepEqual(clips.map(c => c.targetSamples.start), [48000, 86400]); assert.equal(clips[0]!.fadeInSamples, 0); assert.equal(clips[0]!.targetSamples.end, 144000);
});
test("invalid ordering, mismatched clocks, overflowing handoffs and silent audio selections fail", () => {
  let s = setup(); s.plan.groups[0]!.units[1]!.instant = { kind: "at", source: "0f" }; assert.throws(() => assembleMediaProgram(timeline, canvas, s.plan, s.inputs), /strict|increasing|advance/);
  s = setup(); s.plan.groups[0]!.handoffs[0]!.duration = 80; assert.throws(() => assembleMediaProgram(timeline, canvas, s.plan, s.inputs), /exceeds/);
  s = setup(); s.inputs.media[1] = { ...media, clock: { fps: { numerator: 24, denominator: 1 } } }; assert.throws(() => assembleMediaProgram(timeline, canvas, s.plan, s.inputs), /clock/);
  s = setup(); s.inputs.media[1] = { clock: media.clock, totalFrames: 90, picture: media.picture! }; assert.throws(() => assembleMediaProgram(timeline, canvas, s.plan, s.inputs), /normalized WAV/);
});
test("appearance rejects invalid padding, static playback, layer frame keys and trim bounds", () => {
  assert.throws(() => parseAppearance("x", frame, { "stack-order": 0, padding: "100" }), /positive content/);
  assert.throws(() => parseAppearance("x", frame, { "stack-order": 0, "trim-start": 0 }), { code: "MEDIA_TRIM" });
  assert.throws(() => parseAppearance("x", frame, { "stack-order": 0 }, true), /only accepts/);
  const s = setup(false); s.plan.groups[0]!.units[0]!.layers[0] = { id: "content", kind: "image", sourceIndex: 0, extentIndex: 0, properties: { "stack-order": 0, playback: "hold-start" }, sampling: [] }; s.inputs.images.push({ $resource: "still", bytes: 100, mime: "image/png" }); s.inputs.extents.push({ widthPx: 10, heightPx: 10 }); assert.throws(() => assembleMediaProgram(timeline, canvas, s.plan, s.inputs), /Still images/);
});
test("outside-canvas motion moves the complete frame and rejects impossible origin/options", () => {
  const m = parseMotion({ enter: "slide", "enter-frames": 6, "enter-direction": "right", "enter-origin": "outside-canvas" });
  const keys = motionKeyframes(m, { start: 0, end: 12 }, frame.rect, canvas); assert.match(keys[0]!.declarations.find(d => d.property === "transform")!.value, /translate\(280px/);
  assert.throws(() => parseMotion({ enter: "slide", "enter-frames": 6, "enter-direction": "right", "enter-origin": "outside-canvas", "enter-amount": 20 }), /without amount/);
  assert.throws(() => parseMotion({ sustain: "drift 12 2" }), /direction/);
});
