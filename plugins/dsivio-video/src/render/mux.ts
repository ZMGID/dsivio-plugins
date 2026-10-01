import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import { DvError } from "../core/errors.ts";
import { isPending, isResourceRef } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { frameToSample48k, validateClock } from "../timeline/math.ts";
import { runTool } from "../tools/index.ts";
import { probeRenderStreams, streamSamples48k, validatePcmFile } from "./audio.ts";
import type { ProbeStream } from "./audio.ts";
import { renderTypes } from "./ir.ts";
import type { FinalVideo, MuxRequest, SilentVideo } from "./requests.ts";

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function validateMuxRequest(value: unknown): asserts value is MuxRequest {
  if (!object(value) || !object(value.visual) || !object(value.audio)) throw new DvError("RENDER_MUX_INVALID", "Mux requires visual and audio values.");
  const visual = value.visual, audio = value.audio;
  if (!isResourceRef(visual.resource) || visual.resource.mime !== "video/mp4" || !object(visual.clock) || !object(visual.clock.fps) || !Number.isSafeInteger(visual.totalFrames) || Number(visual.totalFrames) <= 0 || !object(visual.extent) || !Number.isSafeInteger(visual.extent.widthPx) || !Number.isSafeInteger(visual.extent.heightPx) || Number(visual.extent.widthPx) <= 0 || Number(visual.extent.heightPx) <= 0 || !isResourceRef(audio.resource) || audio.resource.mime !== "audio/wav") throw new DvError("RENDER_MUX_INVALID", "Invalid visual or audio shape.");
  const clock = visual.clock as SilentVideo["clock"];
  validateClock(clock);
  if (audio.totalSamples !== frameToSample48k(Number(visual.totalFrames), clock)) throw new DvError("RENDER_MUX_LENGTH", "Mixed audio sample count does not match the rebased visual frame domain.");
}
function validateVideoStream(stream: ProbeStream, visual: SilentVideo): void {
  const fps = typeof stream.r_frame_rate === "string" ? stream.r_frame_rate.split("/") : [];
  if (stream.codec_type !== "video" || stream.codec_name !== "h264" || stream.width !== visual.extent.widthPx || stream.height !== visual.extent.heightPx || Number(stream.nb_read_frames) !== visual.totalFrames || fps.length !== 2 || !fps.every(value => /^\d+$/.test(value)) || BigInt(fps[0]!) * BigInt(visual.clock.fps.denominator) !== BigInt(fps[1]!) * BigInt(visual.clock.fps.numerator)) throw new DvError("RENDER_MUX_VIDEO", "Video codec, extent, frame rate or decoded frame count differs from the plan.");
}
export async function muxVideo(request: MuxRequest, ctx: ExecuteContext): Promise<FinalVideo> {
  validateMuxRequest(request);
  const visualPath = ctx.store.pathOf(request.visual.resource), audioPath = ctx.store.pathOf(request.audio.resource);
  const streams = await probeRenderStreams(visualPath, ctx, "mp4");
  if (streams.length !== 1 || !streams[0]) throw new DvError("RENDER_MUX_VIDEO", "Mux visual input must have exactly one silent video stream.");
  validateVideoStream(streams[0], request.visual);
  await validatePcmFile(audioPath, request.audio.totalSamples, ctx);
  await mkdir(ctx.workDir, { recursive: true });
  const output = join(ctx.workDir, "final.mp4");
  try {
    await runTool("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", visualPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", output], { signal: ctx.signal, cwd: ctx.projectRoot });
    const info = await stat(output);
    if (!info.size || info.size > 16 * 1024 ** 3) throw new DvError("RENDER_OUTPUT_LIMIT", "Final MP4 is empty or exceeds 16 GiB.");
    const final = await probeRenderStreams(output, ctx, "mp4");
    const video = final.find(stream => stream.codec_type === "video"), audio = final.find(stream => stream.codec_type === "audio");
    if (final.length !== 2 || !video || !audio || audio.codec_name !== "aac" || Number(audio.sample_rate) !== 48000 || audio.channels !== 2) throw new DvError("RENDER_MUX_SHAPE", "Final MP4 must contain exactly one H.264 video and one stereo 48 kHz AAC stream.");
    validateVideoStream(video, request.visual);
    if (!Number.isFinite(Number(video.start_time)) || Number(video.start_time) !== Number(audio.start_time) || Number(video.start_time) !== 0) throw new DvError("RENDER_MUX_START", "Final audio and video presentation must start together at zero.");
    const actualSamples = streamSamples48k(audio);
    if (Math.abs(actualSamples - request.audio.totalSamples) >= 1024) throw new DvError("RENDER_MUX_AAC_LENGTH", `AAC presentation differs by ${actualSamples - request.audio.totalSamples} samples; tolerance is strictly below 1024.`);
    ctx.log(`Mux: ${request.visual.totalFrames} frames, planned ${request.audio.totalSamples} samples, AAC ${actualSamples} samples.`);
    return { ...request.visual, resource: await ctx.store.putFile(output, "video/mp4"), presentationSamples48k: request.audio.totalSamples };
  } finally { await rm(output, { force: true }); }
}
export const muxCapability: CapabilityDef = {
  name: "local/mux", returns: renderTypes.finalVideo,
  async resolve(request) {
    const pending = isPending(request) || (object(request) && Object.values(request).some(isPending));
    try { if (!pending) validateMuxRequest(request); }
    catch (error) { if (!(error instanceof DvError)) throw error; return { ok: false, code: error.code, reason: error.message }; }
    return { ok: true, request, backend: "local", cost: "local", summary: { operation: "H.264 copy and AAC mux", toleranceSamples: 1024 } };
  },
  executor: { kind: "immediate", async run(request, ctx) { validateMuxRequest(request); return { type: renderTypes.finalVideo, data: await muxVideo(request, ctx) as unknown as Json }; } },
};
