import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { ExecuteContext } from "../core/capability.ts";
import { runTool, locateTool } from "../tools/index.ts";
import { inspectMedia } from "./inspect.ts";
import { selectStreams } from "./select.ts";
import { normalizeMedia, speechAudio } from "./normalize.ts";
import { transformMedia } from "./transform.ts";
import { extractFrame, extractAudio, stillVideo } from "./extract.ts";
import { localCapabilities, evidenceFromReply } from "./capabilities.ts";
import type { Inspection } from "./types.ts";
import pipeline from "../modules/pipeline/index.ts";

async function fixture(t: test.TestContext): Promise<ExecuteContext> {
  const root = await mkdtemp(join(tmpdir(), "dv-pipeline-test-")); await mkdir(join(root, "store")); let index = 0; const paths = new Map<string, string>();
  t.after(() => rm(root, { recursive: true, force: true }));
  return { buildId: "test", commandKey: "test", idempotencyKey: "test", projectRoot: root, workDir: root, signal: new AbortController().signal, log() {}, store: { async putFile(path, mime) { const id = `r${index++}`; const target = join(root, "store", id); await copyFile(path, target); paths.set(id, target); return { $resource: id, bytes: (await stat(target)).size, mime }; }, pathOf(ref) { const path = paths.get(ref.$resource); if (!path) throw new Error("Unknown test resource"); return path; } } };
}
const clock = { fps: { numerator: 30, denominator: 1 } };
test("stream selection refuses ambiguity, silent defaults and disabled authority", () => {
  const base: Inspection = { source: { $resource: "source", bytes: 100, mime: "audio/wav" }, streams: [{ streamIndex: 0, kind: "audio", codec: "pcm_s16le", default: false, attachedPicture: false, timing: { startSeconds: { numerator: 0, denominator: 1 }, durationSeconds: { numerator: 1, denominator: 1 } } }] };
  assert.equal(selectStreams(base, { video: "none", audio: "default", spanAuthority: "audio" }).audioIndex, 0);
  base.streams.push({ ...base.streams[0]!, streamIndex: 1 });
  assert.throws(() => selectStreams(base, { video: "none", audio: "default", spanAuthority: "audio" }), { code: "STREAM_SELECTION_AMBIGUOUS" });
  base.streams[1]!.default = true; assert.equal(selectStreams(base, { video: "none", audio: "default", spanAuthority: "audio" }).audioIndex, 1);
  assert.throws(() => selectStreams(base, { video: "none", audio: "none", spanAuthority: "audio" }));
  assert.throws(() => selectStreams({ ...base, streams: [] }, { video: "none", audio: "default", spanAuthority: "audio" }));
});

test("late audio is silence-padded on video zero; trim and retime preserve exact samples", async t => {
  const ctx = await fixture(t); const clip = join(ctx.workDir, "late.mp4"); const ffmpeg = await locateTool("ffmpeg");
  await runTool(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=128x96:rate=30:duration=2", "-itsoffset", "0.5", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-c:a", "aac", clip]);
  const source = await ctx.store.putFile(clip, "video/mp4"); const inspection = await inspectMedia(source, ctx);
  assert.equal(inspection.streams[0]!.timing!.durationSeconds.numerator, 2); assert.ok(inspection.streams[1]!.timing!.startSeconds.numerator > 0);
  const media = await normalizeMedia({ selection: selectStreams(inspection, { video: "primary-moving", audio: "default", spanAuthority: "video" }), clock }, ctx);
  assert.equal(media.totalFrames, 60); assert.equal(media.sound!.totalSamples, 96000);
  const pcm = await runTool(ffmpeg, ["-v", "error", "-i", ctx.store.pathOf(media.sound!.resource), "-f", "s16le", "-"]);
  assert.ok(pcm.stdout.subarray(0, 20000 * 4).every(byte => byte === 0)); assert.ok(pcm.stdout.subarray(26000 * 4, 40000 * 4).some(byte => byte !== 0));
  const transformed = await transformMedia({ media, plan: { operations: [{ kind: "trim", frames: { start: 6, end: 54 } }, { kind: "retime", speed: { numerator: 2, denominator: 1 }, preservePitch: true }] } }, ctx);
  assert.equal(transformed.totalFrames, 24); assert.equal(transformed.sound!.totalSamples, 38400);
  const speech = await speechAudio({ sound: transformed.sound!, totalSamples16k: 12800 }, ctx); assert.equal(speech.totalSamples, 12800);
  const audio = await extractAudio({ source, streamIndex: 1 }, ctx); assert.equal(audio.totalSamples, inspection.streams[1]!.sound!.totalSamples);
  const frame = await extractFrame({ source, streamIndex: 0, position: { kind: "last" } }, ctx); const held = await stillVideo({ image: frame, clock, totalFrames: 12 }, ctx);
  const heldInspection = await inspectMedia(held, ctx); assert.deepEqual(heldInspection.streams[0]!.timing!.durationSeconds, { numerator: 2, denominator: 5 });
});

test("transparent VP9 survives normalization, retime and PNG extraction", async t => {
  const ctx = await fixture(t); const sourcePath = join(ctx.workDir, "alpha.webm");
  await runTool(await locateTool("ffmpeg"), ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.4:s=64x64:r=30:d=1,format=yuva420p", "-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", sourcePath]);
  const source = await ctx.store.putFile(sourcePath, "video/webm"); const inspection = await inspectMedia(source, ctx);
  const media = await normalizeMedia({ selection: selectStreams(inspection, { video: "primary-moving", audio: "none", spanAuthority: "video" }), clock }, ctx);
  assert.equal(media.picture!.alpha, "straight"); assert.equal(media.sound, undefined);
  const transformed = await transformMedia({ media, plan: { operations: [{ kind: "retime", speed: { numerator: 2, denominator: 1 }, preservePitch: true }] } }, ctx);
  assert.equal(transformed.totalFrames, 15); const png = await extractFrame({ source: transformed.picture!.resource, streamIndex: 0, position: { kind: "first" } }, ctx);
  const pixels = await sharp(ctx.store.pathOf(png)).raw().toBuffer({ resolveWithObject: true });
  const sourcePng = await extractFrame({ source, streamIndex: 0, position: { kind: "first" } }, ctx);
  const originalPixels = await sharp(ctx.store.pathOf(sourcePng)).raw().toBuffer();
  assert.equal(pixels.info.channels, 4); assert.ok(pixels.data[3]! > 0 && pixels.data[3]! < 255); assert.equal(pixels.data[3], originalPixels[3]); assert.ok(pixels.data[0]! > 240);
});

test("audio authority ceil and NTSC clock produce exact PCM samples", async t => {
  const ctx = await fixture(t); const path = join(ctx.workDir, "audio.wav");
  await runTool(await locateTool("ffmpeg"), ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000:duration=0.101", "-ac", "2", "-c:a", "pcm_s16le", path]);
  const inspection = await inspectMedia(await ctx.store.putFile(path, "audio/wav"), ctx);
  const media = await normalizeMedia({ selection: selectStreams(inspection, { video: "none", audio: "default", spanAuthority: "audio" }), clock: { fps: { numerator: 30000, denominator: 1001 } } }, ctx);
  assert.equal(media.totalFrames, 4); assert.equal(media.sound!.totalSamples, 6406); assert.equal(media.picture, undefined);
});

test("raw ASR adaptation rounds once, omits invalid measurements and preserves absent confidence", async () => {
  const ev = evidenceFromReply({ language: "en", segments: [{ text: "hi", words: [{ text: "hi", start: 0.00009, end: 0.10009 }, { text: "bad", start: -1, end: 0.2, score: NaN }] }] }, 16000, "en", "test");
  assert.deepEqual(ev.blocks[0]!.words, [{ text: "hi", samples: { start: 1, end: 1601 } }, { text: "bad" }]);
  const resolved = await localCapabilities.find(c => c.name === "local/normalize")!.resolve({ selection: { $pending: "selection", type: "selection" }, clock }, { projectRoot: "/missing" });
  assert.equal(resolved.ok, true); if (resolved.ok) assert.equal(resolved.cost, "local");
  const rejected = await localCapabilities.find(c => c.name === "local/normalize")!.resolve({ selection: { $pending: "selection", type: "selection" }, clock: { fps: { numerator: 0, denominator: 1 } } }, { projectRoot: "/missing" });
  assert.equal(rejected.ok, false);
});

test("omitted trim ends resolve against each prior local step, including rounded retime", () => {
  const source = { clock, totalFrames: 60, sound: { resource: { $resource: "sound", bytes: 384078, mime: "audio/wav" }, totalSamples: 96000 } };
  const result = pipeline.producers.transform!.run({ media: { type: "dsivio-video/pipeline@1#SynchronizedMedia", data: source }, plan: { type: "dsivio-video/pipeline@1#TransformPlan", data: { operations: [{ kind: "trim", frames: { start: 3 } }, { kind: "retime", speed: { numerator: 2, denominator: 1 }, preservePitch: true }, { kind: "trim", frames: { start: 1 } }] } } });
  const request = result.needs!.media!.request;
  assert.ok(request && typeof request === "object" && !Array.isArray(request));
  assert.deepEqual(request.plan, { operations: [{ kind: "trim", frames: { start: 3, end: 60 } }, { kind: "retime", speed: { numerator: 2, denominator: 1 }, preservePitch: true }, { kind: "trim", frames: { start: 1, end: 29 } }] });
});
