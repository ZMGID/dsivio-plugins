import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import { DvError } from "../core/errors.ts";
import { isResourceRef } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import type { AudioClip } from "./ir.ts";
import { renderTypes } from "./ir.ts";
import type { MixedAudio } from "./requests.ts";
import { audioSourceFilters, validatePcmFile } from "./audio.ts";
import { runTool } from "../tools/index.ts";

export type PlaybackAudioRequest = Pick<AudioClip, "source" | "sourceTotalSamples" | "sourceSamples" | "targetSamples" | "speed" | "preservePitch" | "loop">;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function integer(value: unknown, minimum = 0): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum; }
function window(value: unknown): value is { start: number; end: number } { return record(value) && integer(value.start) && integer(value.end) && value.end > value.start; }
export function validatePlaybackAudioRequest(value: unknown): asserts value is PlaybackAudioRequest {
  if (!record(value) || !isResourceRef(value.source) || value.source.mime !== "audio/wav" || !integer(value.source.bytes, 1) || !integer(value.sourceTotalSamples, 1) || !window(value.sourceSamples) || value.sourceSamples.end > value.sourceTotalSamples || !window(value.targetSamples) || !record(value.speed) || !integer(value.speed.numerator, 1) || !integer(value.speed.denominator, 1) || value.preservePitch !== true || (value.loop !== undefined && (!record(value.loop) || !integer(value.loop.phaseSamples) || value.loop.phaseSamples >= value.sourceSamples.end - value.sourceSamples.start))) throw new DvError("STUDIO_AUDIO_INVALID", "Playback preparation requires canonical PCM, exact sample windows and a positive pitch-preserving speed.");
  const keys: Record<string, true> = { source: true, sourceTotalSamples: true, sourceSamples: true, targetSamples: true, speed: true, preservePitch: true, loop: true };
  if (Object.keys(value).some(key => !Object.hasOwn(keys, key))) throw new DvError("STUDIO_AUDIO_INVALID", "Playback preparation does not accept gain, fades or envelope fields.");
  if ((value.targetSamples.end - value.targetSamples.start) * 4 > 16 * 1024 ** 3) throw new DvError("RENDER_OUTPUT_LIMIT", "Playback PCM exceeds 16 GiB.");
}
export async function prepareAudioPlayback(request: PlaybackAudioRequest, ctx: ExecuteContext): Promise<MixedAudio> {
  validatePlaybackAudioRequest(request);
  await mkdir(ctx.workDir, { recursive: true });
  const source = ctx.store.pathOf(request.source);
  await validatePcmFile(source, request.sourceTotalSamples, ctx);
  const output = join(ctx.workDir, "playback.wav");
  const totalSamples = request.targetSamples.end - request.targetSamples.start;
  try {
    await runTool("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", source, "-af", audioSourceFilters(request).join(","), "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", output], { cwd: ctx.projectRoot, signal: ctx.signal, timeoutMs: 30 * 60 * 1000 });
    const info = await stat(output);
    if (!info.size || info.size > 16 * 1024 ** 3) throw new DvError("RENDER_OUTPUT_LIMIT", "Prepared playback PCM is empty or exceeds 16 GiB.");
    await validatePcmFile(output, totalSamples, ctx);
    const resource = await ctx.store.putFile(output, "audio/wav");
    ctx.log(`Prepared ${totalSamples} pitch-preserving playback samples.`);
    return { resource, totalSamples };
  } finally { await rm(output, { force: true }); }
}
export const playbackAudioCapability: CapabilityDef = {
  name: "local/prepare-audio-playback", returns: renderTypes.mixedAudio,
  async resolve(request) {
    try { validatePlaybackAudioRequest(request); }
    catch (error) { if (!(error instanceof DvError)) throw error; return { ok: false, code: error.code, reason: error.message }; }
    return { ok: true, request, backend: "local", cost: "local", summary: { operation: "Pitch-preserving clip PCM preparation", implementationVersion: "1" } };
  },
  executor: { kind: "immediate", async run(request, ctx) { validatePlaybackAudioRequest(request); return { type: renderTypes.mixedAudio, data: await prepareAudioPlayback(request, ctx) as unknown as Json }; } },
};
