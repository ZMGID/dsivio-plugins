import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecuteContext } from "../core/capability.ts";
import type { ResourceRef } from "../core/value.ts";
import { runTool } from "../tools/index.ts";
import { frameToSample48k } from "../timeline/math.ts";
import { mixAudio, validateAudioRequest, validatePcmFile } from "./audio.ts";
import { muxVideo } from "./mux.ts";
import type { AudioClip } from "./ir.ts";
import type { RenderAudioRequest } from "./requests.ts";

async function context(root: string): Promise<ExecuteContext> {
  const storeDir = join(root, "store");
  await mkdir(storeDir);
  let counter = 0;
  return { buildId: "smoke", commandKey: "audio", idempotencyKey: "smoke:audio", projectRoot: root, workDir: join(root, "scratch"), signal: new AbortController().signal, log() {}, store: {
    pathOf(resource) { return join(storeDir, resource.$resource); },
    async putFile(path, mime) { const id = String(counter++); await copyFile(path, join(storeDir, id)); return { $resource: id, bytes: (await stat(path)).size, mime }; },
  } };
}
async function samples(resource: ResourceRef, ctx: ExecuteContext): Promise<Buffer> {
  const result = await runTool("ffmpeg", ["-v", "error", "-i", ctx.store.pathOf(resource), "-f", "s16le", "-" ]);
  return result.stdout;
}
test("mix keeps original loop phase, gain curve and mute recovery in a local range", async () => {
  const root = await mkdtemp(join(tmpdir(), "dv-audio-"));
  try {
    const ctx = await context(root);
    const path = join(root, "source.wav");
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.1+0.1*n/1600|0.1+0.1*n/1600:s=48000", "-af", "atrim=end_sample=1600", "-c:a", "pcm_s16le", path]);
    const source = await ctx.store.putFile(path, "audio/wav");
    const clip: AudioClip = { clipKey: "loop", source, sourceTotalSamples: 1600, sourceSamples: { start: 0, end: 1600 }, targetSamples: { start: 0, end: 6400 }, loop: { phaseSamples: 400 }, speed: { numerator: 1, denominator: 1 }, preservePitch: true, gain: 1, fadeInSamples: 0, fadeOutSamples: 0, gainCurve: [{ sample: 0, gain: 0 }, { sample: 6400, gain: 1 }], audible: [{ start: 0, end: 2400 }, { start: 4000, end: 6400 }] };
    const request: RenderAudioRequest = { domain: { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 4, totalSamples48k: 6400 }, tracks: [{ kind: "audio", trackKey: "track", axisKey: "axis", clips: [clip] }], frames: { start: 1, end: 4 } };
    const output = await mixAudio(request, ctx);
    const pcm = await samples(output.resource, ctx);
    assert.equal(output.totalSamples, 4800);
    assert.equal(pcm.byteLength, 4800 * 4);
    for (const local of [0, 100, 700, 2400, 3000, 4700]) {
      const global = local + 1600;
      const expected = global >= 2400 && global < 4000 ? 0 : Math.round(32768 * (0.1 + 0.1 * ((global + 400) % 1600) / 1600) * global / 6400);
      assert.ok(Math.abs(pcm.readInt16LE(local * 4) - expected) <= 3, `sample ${global}: ${pcm.readInt16LE(local * 4)} vs ${expected}`);
    }
    assert.equal(pcm.readInt16LE(1500 * 4), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("NTSC local output uses B(length), exact silence tail and AAC mux", async () => {
  const root = await mkdtemp(join(tmpdir(), "dv-mux-"));
  try {
    const ctx = await context(root);
    const clock = { fps: { numerator: 30000, denominator: 1001 } };
    const request: RenderAudioRequest = { domain: { axisKey: "axis", clock, totalFrames: 2, totalSamples48k: frameToSample48k(2, clock) }, tracks: [], frames: { start: 1, end: 2 } };
    const audio = await mixAudio(request, ctx);
    assert.equal(audio.totalSamples, 1602);
    const pcm = await samples(audio.resource, ctx);
    assert.equal(pcm.byteLength, 1602 * 4);
    assert.ok(pcm.every(byte => byte === 0));
    const sourcePath = join(root, "stereo.wav");
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.125|-0.125:s=48000", "-af", "atrim=end_sample=3203", "-c:a", "pcm_s16le", sourcePath]);
    const source = await ctx.store.putFile(sourcePath, "audio/wav");
    const clip: AudioClip = { clipKey: "one", source, sourceTotalSamples: 3203, sourceSamples: { start: 0, end: 3203 }, targetSamples: { start: 0, end: 3203 }, speed: { numerator: 1, denominator: 1 }, preservePitch: true, gain: 1, fadeInSamples: 0, fadeOutSamples: 0, gainCurve: [] };
    request.tracks = [
      { kind: "audio", trackKey: "one", axisKey: "axis", clips: [clip] },
      { kind: "audio", trackKey: "two", axisKey: "axis", clips: [{ ...clip, clipKey: "two" }] },
    ];
    const mixed = await mixAudio(request, ctx);
    const rebased = await samples(mixed.resource, ctx);
    assert.equal(rebased.readInt16LE(0), 8192);
    assert.equal(rebased.readInt16LE(2), -8192);
    assert.equal(rebased.readInt16LE(1600 * 4), 8192);
    assert.equal(rebased.readInt16LE(1601 * 4), 0);
    assert.equal(rebased.readInt16LE(1601 * 4 + 2), 0);
    const video = join(root, "silent.mp4");
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=30000/1001", "-frames:v", "1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
    const visual = { resource: await ctx.store.putFile(video, "video/mp4"), totalFrames: 1, clock, extent: { widthPx: 64, heightPx: 64 } };
    const final = await muxVideo({ visual, audio: mixed }, ctx);
    assert.equal(final.presentationSamples48k, 1602);
    await assert.rejects(muxVideo({ visual, audio: { ...mixed, totalSamples: 1601 } }, ctx), { code: "RENDER_MUX_LENGTH" });
    await validatePcmFile(ctx.store.pathOf(audio.resource), 1602, ctx);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("extreme rational retiming preserves pitch in a local output", async () => {
  const root = await mkdtemp(join(tmpdir(), "dv-tempo-"));
  try {
    const ctx = await context(root);
    const path = join(root, "tone.wav");
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=1", "-ac", "2", "-c:a", "pcm_s16le", path]);
    const source = await ctx.store.putFile(path, "audio/wav");
    const clip: AudioClip = { clipKey: "slow", source, sourceTotalSamples: 48000, sourceSamples: { start: 0, end: 48000 }, targetSamples: { start: 0, end: 384000 }, speed: { numerator: 1, denominator: 8 }, preservePitch: true, gain: 1, fadeInSamples: 0, fadeOutSamples: 0, gainCurve: [] };
    const mixed = await mixAudio({ domain: { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 240, totalSamples48k: 384000 }, tracks: [{ kind: "audio", trackKey: "track", axisKey: "axis", clips: [clip] }], frames: { start: 60, end: 90 } }, ctx);
    const pcm = await samples(mixed.resource, ctx);
    assert.equal(pcm.byteLength, 48000 * 4);
    let crossings = 0;
    for (let sample = 1; sample < 48000; sample++) if (pcm.readInt16LE((sample - 1) * 4) <= 0 && pcm.readInt16LE(sample * 4) > 0) crossings++;
    assert.ok(Math.abs(crossings - 1000) <= 2, `Retimed tone must remain 1 kHz, observed ${crossings} Hz.`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("audio request rejects conflicting source samples and off-domain curves", () => {
  const source = { $resource: "same", bytes: 100, mime: "audio/wav" };
  const clip: AudioClip = { clipKey: "one", source, sourceTotalSamples: 1600, sourceSamples: { start: 0, end: 1600 }, targetSamples: { start: 0, end: 1600 }, speed: { numerator: 1, denominator: 1 }, preservePitch: true, gain: 1, fadeInSamples: 0, fadeOutSamples: 0, gainCurve: [] };
  const request: RenderAudioRequest = { domain: { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 1, totalSamples48k: 1600 }, tracks: [{ kind: "audio", trackKey: "track", axisKey: "axis", clips: [clip, { ...clip, sourceTotalSamples: 1601 }] }], frames: { start: 0, end: 1 } };
  assert.throws(() => validateAudioRequest(request), { code: "RENDER_AUDIO_INVALID" });
  request.tracks[0]!.clips = [{ ...clip, gainCurve: [{ sample: 1, gain: 1 }, { sample: 1600, gain: 1 }] }];
  assert.throws(() => validateAudioRequest(request), { code: "RENDER_AUDIO_INVALID" });
  assert.throws(() => validateAudioRequest({ domain: { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 6000000, totalSamples48k: 9600000000 }, frames: { start: 0, end: 6000000 }, tracks: [] }), { code: "RENDER_OUTPUT_LIMIT" });
});
