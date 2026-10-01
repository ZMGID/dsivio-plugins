import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../build/resources.ts";
import type { ExecuteContext } from "../core/capability.ts";
import { DvError } from "../core/errors.ts";
import type { Canvas } from "../space/types.ts";
import type { Timeline } from "../timeline/types.ts";
import { locateTool, runTool } from "../tools/index.ts";
import { inspectMedia } from "../pipeline/inspect.ts";
import { selectStreams } from "../pipeline/select.ts";
import { normalizeMedia } from "../pipeline/normalize.ts";
import { transformMedia } from "../pipeline/transform.ts";
import { materializeTake } from "../timeline/align.ts";
import { parseScript } from "../timeline/script.ts";
import { assembleTimeline } from "../timeline/timeline.ts";
import { projectWindow } from "../timeline/temporal.ts";
import { frameToSample48k } from "../timeline/math.ts";
import { lowerSound } from "../components/sound/lower.ts";
import { assembleSoundProgram } from "../components/sound/program.ts";
import { lowerPerformance } from "../components/performance/lower.ts";
import { performanceStyle, parseFrameInk } from "../components/performance/author.ts";
import { assemblePerformanceProgram } from "../components/performance/program.ts";
import { composeComposition, flattenPresents, validateComposition } from "./composition.ts";
import { sampleFrame } from "./validate.ts";
import { mixAudio } from "./audio.ts";

let directory: string;
let timeline: Timeline;
const canvas: Canvas = { canvasKey: "canvas", extent: { widthPx: 160, heightPx: 120 } };
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "dv-composition-test-"));
  const workDir = join(directory, "normalize"); await mkdir(workDir);
  const ctx: ExecuteContext = { buildId: "test", commandKey: "normalize", idempotencyKey: "test-normalize", projectRoot: directory, store: new ProjectStore(directory), workDir, signal: new AbortController().signal, log() {} };
  const input = join(directory, "source.mkv");
  const ffmpeg = await locateTool("ffmpeg");
  await runTool(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=673:sample_rate=48000:duration=2", "-c:v", "libx264", "-c:a", "pcm_s16le", "-ac", "2", input]);
  const source = await ctx.store.putFile(input, "video/x-matroska");
  const inspection = await inspectMedia(source, ctx);
  const media = await normalizeMedia({ selection: selectStreams(inspection, { video: "primary-moving", audio: "default", spanAuthority: "video" }), clock: { fps: { numerator: 30, denominator: 1 } } }, ctx);
  const script = parseScript("<first/><second/><silent/>", "story");
  const takes = [materializeTake(script.narrative, script.segments.first!, media), materializeTake(script.narrative, script.segments.second!, media), materializeTake(script.narrative, script.segments.silent!, { clock: media.clock, totalFrames: media.totalFrames, picture: media.picture! })];
  timeline = assembleTimeline(media.clock, takes, { timelineKey: "composition-test-timeline", placements: [{ placementKey: "first", at: "0f" }, { placementKey: "second", at: "15f" }, { placementKey: "silent", at: "30f" }] });
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function window(key: string, start: number, end: number) {
  return projectWindow(timeline, { kind: "edges", start: `${start}f`, end: `${end}f` }, key);
}
function visual(trackKey = "picture", layer = 0) {
  const style = performanceStyle("style", { canvasKey: canvas.canvasKey, rect: { xPx: 10, yPx: 20, widthPx: 140, heightPx: 90 } }, { "stack-order": layer, fit: "cover", padding: "2 4", "border-width": 1, "border-color": "#112233", "frame-paint": "#102030" });
  return lowerPerformance(assemblePerformanceProgram(timeline, canvas, { trackKey, uses: [{ useKey: "base", windowIndex: 0, styleIndex: 0 }, { useKey: "override", windowIndex: 1, styleIndex: 0 }] }, [window("base", 0, 90), window("override", 35, 45)], [style]));
}
test("last declared audible placement wins; silent picture placements never mask sound", () => {
  const track = lowerSound(assembleSoundProgram(timeline, { trackKey: "voice", uses: [{ useKey: "base", windowIndex: 0, styleIndex: 0 }] }, [window("base", 0, 90)], [{ styleKey: "ramp", gain: 1, endGain: 3 }]));
  assert.deepEqual(track.clips.map(clip => clip.audible), [[{ start: 0, end: 24000 }], [{ start: 24000, end: 120000 }]]);
  assert.deepEqual(track.clips[0]!.sourceSamples, { start: 0, end: 96000 });
  assert.deepEqual(track.clips[1]!.targetSamples, { start: 24000, end: 120000 });
});
test("mute and later Use mask and resume the original source and whole-window envelope", () => {
  const track = lowerSound(assembleSoundProgram(timeline, { trackKey: "voice", uses: [{ useKey: "base", windowIndex: 0, styleIndex: 0 }, { useKey: "mute", windowIndex: 1, styleIndex: 1 }, { useKey: "replacement", windowIndex: 2, styleIndex: 2 }] }, [window("base", 0, 90), window("mute", 5, 10), window("replacement", 20, 25)], [{ styleKey: "ramp", gain: 1, endGain: 3 }, { styleKey: "muted", gain: 0, endGain: 0 }, { styleKey: "quiet", gain: 0.5, endGain: 0.5 }]));
  assert.deepEqual(track.clips[0]!.audible, [{ start: 0, end: 8000 }, { start: 16000, end: 24000 }]);
  assert.deepEqual(track.clips[0]!.targetSamples, { start: 0, end: 96000 });
  assert.deepEqual(track.clips[0]!.gainCurve, [{ sample: 0, gain: 1 }, { sample: 144000, gain: 3 }]);
  assert.deepEqual(track.clips[1]!.audible, [{ start: 24000, end: 32000 }, { start: 40000, end: 120000 }]);
  assert.deepEqual(track.clips[2]!.sourceSamples, { start: 8000, end: 16000 });
});
test("later Performance Use changes visibility only, preserving native frame phase", () => {
  const track = visual();
  assert.deepEqual(track.presents[0]!.visible, [{ start: 0, end: 35 }, { start: 45, end: 60 }]);
  assert.deepEqual(track.presents[0]!.lifetime, { start: 0, end: 60 });
  const override = track.presents[3]!;
  const node = override.nodes.find(item => item.kind === "video");
  assert.ok(node?.kind === "video" && node.sampling);
  assert.equal(sampleFrame(node.sampling, 0), 35);
  assert.equal(sampleFrame(node.sampling, 9), 44);
  const old = track.presents[0]!.nodes.find(item => item.kind === "video");
  assert.ok(old?.kind === "video" && old.sampling);
  assert.equal(sampleFrame(old.sampling, 45), 45);
  assert.equal(track.presents.length, 6);
});
test("fitting subtracts parent frame origin and inset exactly once", () => {
  const track = visual();
  const video = track.presents[0]!.nodes.find(node => node.kind === "video")!;
  assert.equal(video.style.find(style => style.property === "left")!.value, "4px");
  assert.equal(video.style.find(style => style.property === "top")!.value, "-4.75px");
});
test("Film canonicalizes track order but explicit cross-track layers determine paint order", () => {
  const low = visual("low", -3); const high = visual("high", 20);
  const first = composeComposition("film", canvas, timeline, { background: "#101820" }, [high, low], []);
  const reversed = composeComposition("film", canvas, timeline, { background: "#101820" }, [low, high], []);
  assert.deepEqual(first, reversed);
  assert.deepEqual(first.visualTracks.map(track => track.trackKey), ["high", "low"]);
  const flattened = flattenPresents(first);
  assert.equal(flattened[0]!.trackKey, "low"); assert.equal(flattened.at(-1)!.trackKey, "high");
});
test("same layer/key overlapping lifetimes fail even if visibility masks do not overlap", () => {
  const first = visual("first"); const second = visual("second");
  first.presents = [first.presents[0]!]; second.presents = [second.presents[0]!];
  first.presents[0]!.layerKey = "shared"; second.presents[0]!.layerKey = "shared";
  first.presents[0]!.visible = [{ start: 0, end: 20 }]; second.presents[0]!.visible = [{ start: 20, end: 60 }];
  assert.throws(() => composeComposition("film", canvas, timeline, { background: "#101820" }, [first, second], []), (error: unknown) => error instanceof DvError && error.code === "FILM_LAYER_CONFLICT");
});
test("global audio/visual identity collisions, foreign axes, invalid recipe keys and index errors fail", () => {
  const picture = visual("same"); const voice = { kind: "audio" as const, trackKey: "same", axisKey: timeline.axisKey, clips: [] };
  assert.throws(() => composeComposition("film", canvas, timeline, { background: "#101820" }, [picture], [voice]), (error: unknown) => error instanceof DvError && error.code === "FILM_TRACK_IDENTITY");
  assert.throws(() => composeComposition("film", canvas, timeline, { background: "#101820", opacity: 1 }, [picture], []), DvError);
  assert.throws(() => composeComposition("film", canvas, timeline, { background: "#101820" }, [{ ...picture, axisKey: "foreign" }], []), DvError);
  assert.throws(() => assembleSoundProgram(timeline, { trackKey: "voice", uses: [{ useKey: "bad", windowIndex: 0, styleIndex: 2 }] }, [window("bad", 0, 5)], []), DvError);
  assert.throws(() => performanceStyle("bad", { canvasKey: "canvas", rect: { xPx: 0, yPx: 0, widthPx: 10, heightPx: 10 } }, { "stack-order": 0, padding: "6" }), DvError);
  assert.throws(() => performanceStyle("bad", { canvasKey: "canvas", rect: { xPx: 0, yPx: 0, widthPx: 10, heightPx: 10 } }, { "stack-order": 0, playback: "loop-start" }), DvError);
  assert.deepEqual(parseFrameInk("linear(90; 0 #000000, 1 #FFFFFF)"), { kind: "linear", angleDegrees: 90, stops: [{ offset: 0, color: "#000000", opacity: 1 }, { offset: 1, color: "#FFFFFF", opacity: 1 }] });
});
test("empty presentation rules preserve explicit silent/audio-only programs and exact domain", () => {
  const voice = lowerSound({ trackKey: "empty", timeline, uses: [] });
  assert.deepEqual(voice.clips, []);
  const composition = composeComposition("silent", canvas, timeline, { background: "#101820" }, [], [voice]);
  assert.equal(composition.domain.totalSamples48k, frameToSample48k(90, timeline.clock));
  assert.throws(() => validateComposition({ ...composition, domain: { ...composition.domain, totalSamples48k: 1 } }), DvError);
});
test("fractional-FPS Use splits preserve one placement sample origin and native picture frames", async () => {
  const workDir = join(directory, "fractional"); await mkdir(workDir);
  const ctx: ExecuteContext = { buildId: "test", commandKey: "fractional", idempotencyKey: "fractional", projectRoot: directory, store: new ProjectStore(directory), workDir, signal: new AbortController().signal, log() {} };
  const source = await ctx.store.putFile(join(directory, "source.mkv"), "video/x-matroska");
  const inspection = await inspectMedia(source, ctx);
  const normalized = await normalizeMedia({ selection: selectStreams(inspection, { video: "primary-moving", audio: "default", spanAuthority: "video" }), clock: { fps: { numerator: 30000, denominator: 1001 } } }, ctx);
  const media = await transformMedia({ media: normalized, plan: { operations: [{ kind: "trim", frames: { start: 0, end: 2 } }] } }, ctx);
  const script = parseScript("<shot/>", "fractional");
  const take = materializeTake(script.narrative, script.segments.shot!, media);
  const placed = assembleTimeline(media.clock, [take], { timelineKey: "fractional-axis", placements: [{ placementKey: "offset", at: "1f" }] });
  const full = projectWindow(placed, { kind: "edges", start: "1f", end: "3f" }, "full");
  const leading = projectWindow(placed, { kind: "edges", start: "1f", end: "2f" }, "leading");
  const trailing = projectWindow(placed, { kind: "edges", start: "2f", end: "3f" }, "trailing");
  const style = { styleKey: "unity", gain: 1, endGain: 1 };
  const unsplit = lowerSound({ trackKey: "unsplit", timeline: placed, uses: [{ useKey: "full", window: full, style }] });
  const split = lowerSound({ trackKey: "split", timeline: placed, uses: [{ useKey: "leading", window: leading, style }, { useKey: "trailing", window: trailing, style }] });
  assert.deepEqual(split.clips.map(clip => clip.targetSamples), [{ start: 1602, end: 3203 }, { start: 3203, end: 4805 }]);
  assert.deepEqual(split.clips.map(clip => clip.sourceSamples), [{ start: 0, end: 1601 }, { start: 1601, end: 3203 }]);
  const domain = composeComposition("fractional", canvas, placed, { background: "#000000" }, [], [unsplit]).domain;
  const pcm: Buffer[] = [];
  for (const track of [unsplit, split]) {
    const mixed = await mixAudio({ domain, tracks: [track], frames: { start: 0, end: 3 } }, ctx);
    pcm.push((await runTool("ffmpeg", ["-v", "error", "-i", ctx.store.pathOf(mixed.resource), "-f", "s16le", "-"])).stdout);
  }
  assert.deepEqual(pcm[1], pcm[0], "splitting a Use must not omit or duplicate a PCM sample");
  const pictureStyle = performanceStyle("picture", { canvasKey: canvas.canvasKey, rect: { xPx: 0, yPx: 0, ...canvas.extent } }, { "stack-order": 0 });
  const pictures = lowerPerformance({ trackKey: "picture", timeline: placed, canvas, uses: [{ useKey: "leading", window: leading, style: pictureStyle }, { useKey: "trailing", window: trailing, style: pictureStyle }] });
  const samples = pictures.presents.map(present => {
    const node = present.nodes.find(item => item.kind === "video");
    assert.ok(node?.kind === "video" && node.sampling);
    return sampleFrame(node.sampling, 0);
  });
  assert.deepEqual(samples, [0, 1]);
  const padded = assembleTimeline(media.clock, [take], { timelineKey: "padded-axis", placements: [{ placementKey: "offset", at: "4f" }] });
  const paddedWindow = projectWindow(padded, { kind: "edges", start: "4f", end: "6f" }, "full");
  const paddedTrack = lowerSound({ trackKey: "padded", timeline: padded, uses: [{ useKey: "full", window: paddedWindow, style }] });
  assert.deepEqual(paddedTrack.clips[0]!.sourceSamples, { start: 0, end: 3203 });
  assert.deepEqual(paddedTrack.clips[0]!.targetSamples, { start: 6406, end: 9610 });
  composeComposition("padded", canvas, padded, { background: "#000000" }, [], [paddedTrack]);
});
