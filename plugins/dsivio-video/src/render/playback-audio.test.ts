import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecuteContext } from "../core/capability.ts";
import { runTool } from "../tools/index.ts";
import { prepareAudioPlayback, validatePlaybackAudioRequest } from "./playback-audio.ts";
import type { PlaybackAudioRequest } from "./playback-audio.ts";

test("prepared clip retains pitch, exact target duration and does not bake mix fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "dv-playback-"));
  try {
    const store = join(root, "store"); await mkdir(store);
    let counter = 0;
    const ctx: ExecuteContext = { buildId: "playback", commandKey: "pcm", idempotencyKey: "playback:pcm", projectRoot: root, workDir: join(root, "scratch"), signal: new AbortController().signal, log() {}, store: {
      pathOf(resource) { return join(store, resource.$resource); },
      async putFile(path, mime) { const id = String(counter++); await copyFile(path, join(store, id)); return { $resource: id, bytes: (await stat(path)).size, mime }; },
    } };
    const tone = join(root, "tone.wav");
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-ac", "2", "-c:a", "pcm_s16le", tone]);
    const request: PlaybackAudioRequest = { source: await ctx.store.putFile(tone, "audio/wav"), sourceTotalSamples: 48000, sourceSamples: { start: 0, end: 48000 }, targetSamples: { start: 1601, end: 97601 }, speed: { numerator: 1, denominator: 2 }, preservePitch: true };
    const result = await prepareAudioPlayback(request, ctx);
    assert.equal(result.totalSamples, 96000);
    const pcm = (await runTool("ffmpeg", ["-v", "error", "-i", ctx.store.pathOf(result.resource), "-f", "s16le", "-"])).stdout;
    assert.equal(pcm.byteLength, 96000 * 4);
    let crossings = 0;
    for (let sample = 24001; sample < 72000; sample++) if (pcm.readInt16LE((sample - 1) * 4) <= 0 && pcm.readInt16LE(sample * 4) > 0) crossings++;
    assert.ok(Math.abs(crossings - 440) <= 2, `Expected 440 Hz preserved pitch; observed ${crossings}`);
    assert.throws(() => validatePlaybackAudioRequest({ ...request, gain: 2 }), { code: "STUDIO_AUDIO_INVALID" });
    await assert.rejects(prepareAudioPlayback({ ...request, sourceTotalSamples: 48001 }, ctx), { code: "RENDER_PCM_MISMATCH" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
