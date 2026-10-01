import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { ExecuteContext } from "../core/capability.ts";
import type { Clock, Rational, SynchronizedMedia } from "../timeline/types.ts";
import type { NormalizeRequest, NormalizedAudio, SpeechAudio, SpeechAudioRequest } from "./types.ts";
import { frameToSample48k } from "../timeline/math.ts";
import { runTool } from "../tools/index.ts";
import { probeMedia } from "../media/probe.ts";
import { readProbe, inputPath } from "./inspect.ts";
import { clock, object, validateSelection, validateMedia, validateAudio, integer } from "./validate.ts";

export function quantize(numerator: bigint, denominator: bigint, ceil = false): number {
  const n = ceil ? (numerator + denominator - 1n) / denominator : (2n * numerator + denominator) / (2n * denominator);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new DvError("MEDIA_TIME_OVERFLOW", "Media time exceeds safe integer domain"); return Number(n);
}
export function tempoFilters(speed: Rational): string[] {
  let value = speed.numerator / speed.denominator; const filters: string[] = [];
  while (value > 2) { filters.push("atempo=2"); value /= 2; }
  while (value < 0.5) { filters.push("atempo=0.5"); value *= 2; }
  filters.push(`atempo=${value}`); return filters;
}
export function pictureEncoding(alpha: boolean): string[] {
  return alpha ? ["-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0"] : ["-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart"];
}
export async function verifyPicture(path: string, totalFrames: number, expectedClock: Clock, alpha: boolean, ctx: ExecuteContext): Promise<{ widthPx: number; heightPx: number }> {
  const raw = await readProbe(path, ctx.signal);
  if (!Array.isArray(raw.streams) || raw.streams.length !== 1 || !Array.isArray(raw.frames) || raw.frames.length !== totalFrames) throw new DvError("MEDIA_PICTURE_INVALID", `Expected exactly ${totalFrames} video frames`);
  const stream = raw.streams[0]; object(stream);
  const parts = String(stream.avg_frame_rate).split("/").map(Number);
  if (stream.codec_type !== "video" || BigInt(parts[0]!) * BigInt(expectedClock.fps.denominator) !== BigInt(parts[1]!) * BigInt(expectedClock.fps.numerator) || stream.sample_aspect_ratio !== "1:1") throw new DvError("MEDIA_PICTURE_INVALID", "Video stream clock or pixel aspect disagrees with plan");
  if (alpha) { const tags = stream.tags; object(tags); if (tags.alpha_mode !== "1" && tags.ALPHA_MODE !== "1") throw new DvError("MEDIA_ALPHA_INVALID", "VP9 output lost alpha"); }
  if (Array.isArray(stream.side_data_list) && stream.side_data_list.some(s => { object(s); return Number(s.rotation ?? 0) !== 0; })) throw new DvError("MEDIA_ROTATION_INVALID", "Output retains rotation");
  await probeMedia(path);
  return { widthPx: Number(stream.width), heightPx: Number(stream.height) };
}
export async function verifyAudio(path: string, sampleRate: number, channels: number, totalSamples: number | undefined, ctx: ExecuteContext): Promise<number> {
  const raw = await readProbe(path, ctx.signal);
  if (!Array.isArray(raw.streams) || raw.streams.length !== 1 || !Array.isArray(raw.frames)) throw new DvError("MEDIA_AUDIO_INVALID", "Expected one PCM stream");
  const stream = raw.streams[0]; object(stream);
  const actual = raw.frames.reduce((sum, f) => { object(f); return sum + Number(f.nb_samples); }, 0);
  if (stream.codec_name !== "pcm_s16le" || Number(stream.sample_rate) !== sampleRate || stream.channels !== channels || !Number.isSafeInteger(actual) || actual <= 0 || totalSamples !== undefined && actual !== totalSamples) throw new DvError("MEDIA_AUDIO_INVALID", `PCM shape/sample mismatch: wanted ${sampleRate} Hz ${channels} ch ${String(totalSamples)} samples, got ${actual}`);
  return actual;
}
export async function normalizeMedia(request: NormalizeRequest, ctx: ExecuteContext): Promise<SynchronizedMedia> {
  validateSelection(request.selection); clock(request.clock);
  const { selection } = request;
  const authority = selection.inspection.streams.find(s => s.streamIndex === (selection.spanAuthority === "video" ? selection.videoIndex : selection.audioIndex))!;
  const duration = authority.timing!.durationSeconds;
  const totalFrames = Math.max(1, quantize(BigInt(duration.numerator) * BigInt(request.clock.fps.numerator), BigInt(duration.denominator) * BigInt(request.clock.fps.denominator), selection.spanAuthority === "audio"));
  const totalSamples = frameToSample48k(totalFrames, request.clock);
  const media: SynchronizedMedia = { clock: request.clock, totalFrames };
  const input = await inputPath(selection.inspection.source, ctx);
  if (selection.videoIndex !== undefined) {
    const stream = selection.inspection.streams.find(s => s.streamIndex === selection.videoIndex)!;
    const alpha = stream.picture!.alpha; const output = join(ctx.workDir, alpha ? "picture.webm" : "picture.mp4");
    const fps = `${request.clock.fps.numerator}/${request.clock.fps.denominator}`;
    const filter = `setpts=PTS-STARTPTS,scale=round(iw*sar):ih,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${totalFrames * request.clock.fps.denominator / request.clock.fps.numerator},trim=end_frame=${totalFrames},setpts=N/(${fps}*TB)`;
    await runTool("ffmpeg", ["-v", "error", "-y", ...(alpha && (stream.codec === "vp8" || stream.codec === "vp9") ? ["-c:v", stream.codec === "vp8" ? "libvpx" : "libvpx-vp9"] : []), "-i", input, "-map", `0:${selection.videoIndex}`, "-an", "-vf", filter, "-frames:v", String(totalFrames), ...pictureEncoding(alpha), output], { signal: ctx.signal });
    const extent = await verifyPicture(output, totalFrames, request.clock, alpha, ctx);
    media.picture = { resource: await ctx.store.putFile(output, alpha ? "video/webm" : "video/mp4"), extent, alpha: alpha ? "straight" : "opaque" };
  }
  if (selection.audioIndex !== undefined) {
    const stream = selection.inspection.streams.find(s => s.streamIndex === selection.audioIndex)!;
    const origin = authority.timing!.startSeconds; const start = stream.timing!.startSeconds; const soundDuration = stream.timing!.durationSeconds;
    const deltaN = BigInt(start.numerator) * BigInt(origin.denominator) - BigInt(origin.numerator) * BigInt(start.denominator);
    const deltaD = BigInt(start.denominator) * BigInt(origin.denominator);
    const offset = deltaN < 0n ? -quantize(-deltaN * 48000n, deltaD) : quantize(deltaN * 48000n, deltaD);
    const relativeEnd = deltaN * BigInt(soundDuration.denominator) + BigInt(soundDuration.numerator) * deltaD;
    if (relativeEnd <= 0n || deltaN * BigInt(duration.denominator) >= BigInt(duration.numerator) * deltaD) throw new DvError("MEDIA_AUDIO_NO_INTERSECTION", "Selected audio does not intersect authority span");
    const filters = ["aresample=48000", "aformat=sample_fmts=s16:channel_layouts=stereo", "asetpts=PTS-STARTPTS", ...(offset < 0 ? [`atrim=start_sample=${-offset}`, "asetpts=PTS-STARTPTS"] : offset > 0 ? [`adelay=${offset}S:all=1`] : []), `apad=whole_len=${totalSamples}`, `atrim=end_sample=${totalSamples}`, "asetpts=N/SR/TB"];
    const output = join(ctx.workDir, "sound.wav");
    await runTool("ffmpeg", ["-v", "error", "-y", "-i", input, "-map", `0:${selection.audioIndex}`, "-vn", "-af", filters.join(","), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", output], { signal: ctx.signal });
    await verifyAudio(output, 48000, 2, totalSamples, ctx);
    media.sound = { resource: await ctx.store.putFile(output, "audio/wav"), totalSamples };
    ctx.log(`Normalize audio stream ${selection.audioIndex}: offset=${offset} samples, target=${totalSamples}`);
  }
  ctx.log(`Normalize: authority=${selection.spanAuthority}, frames=${totalFrames}, video=${String(selection.videoIndex)}, audio=${String(selection.audioIndex)}`);
  validateMedia(media); return media;
}
export async function speechAudio(request: SpeechAudioRequest, ctx: ExecuteContext): Promise<SpeechAudio> {
  validateAudio(request.sound); integer(request.totalSamples16k, "Speech samples", 1);
  const input = await inputPath(request.sound.resource, ctx); await verifyAudio(input, 48000, 2, request.sound.totalSamples, ctx);
  const output = join(ctx.workDir, "speech.wav");
  await runTool("ffmpeg", ["-v", "error", "-y", "-i", input, "-vn", "-af", `aresample=16000,apad=whole_len=${request.totalSamples16k},atrim=end_sample=${request.totalSamples16k},asetpts=N/SR/TB`, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output], { signal: ctx.signal });
  await verifyAudio(output, 16000, 1, request.totalSamples16k, ctx);
  return { resource: await ctx.store.putFile(output, "audio/wav"), totalSamples: request.totalSamples16k, sampleRate: 16000 };
}
