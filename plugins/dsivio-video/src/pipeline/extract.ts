import { join } from "node:path";
import type { ExecuteContext } from "../core/capability.ts";
import type { ResourceRef } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import type { ExtractAudioRequest, ExtractFrameRequest, NormalizedAudio, StillVideoRequest } from "./types.ts";
import { runTool } from "../tools/index.ts";
import { readProbe, inputPath } from "./inspect.ts";
import { verifyAudio, verifyPicture, pictureEncoding } from "./normalize.ts";
import { resource, validateAudioOptions, validateFrameOptions, integer, clock, object } from "./validate.ts";

export async function extractAudio(request: ExtractAudioRequest, ctx: ExecuteContext): Promise<NormalizedAudio> {
  resource(request.source); validateAudioOptions(request);
  const raw = await readProbe(await inputPath(request.source, ctx), ctx.signal);
  if (!Array.isArray(raw.streams) || !raw.streams.some(s => { object(s); return s.index === request.streamIndex && s.codec_type === "audio"; })) throw new DvError("EXTRACT_STREAM_INVALID", `No audio stream ${request.streamIndex}`);
  const output = join(ctx.workDir, "extracted.wav");
  await runTool("ffmpeg", ["-v", "error", "-y", "-i", await inputPath(request.source, ctx), "-map", `0:${request.streamIndex}`, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", output], { signal: ctx.signal });
  const totalSamples = await verifyAudio(output, 48000, 2, undefined, ctx);
  return { resource: await ctx.store.putFile(output, "audio/wav"), totalSamples };
}
export async function extractFrame(request: ExtractFrameRequest, ctx: ExecuteContext): Promise<ResourceRef> {
  resource(request.source); validateFrameOptions(request);
  const raw = await readProbe(await inputPath(request.source, ctx), ctx.signal);
  if (!Array.isArray(raw.frames) || !Array.isArray(raw.streams)) throw new DvError("MEDIA_PROBE_INVALID", "Missing decoded frames");
  const stream = raw.streams.find(s => { object(s); return s.index === request.streamIndex && s.codec_type === "video"; });
  if (!stream) throw new DvError("EXTRACT_STREAM_INVALID", `No video stream ${request.streamIndex}`);
  object(stream);
  const frames = raw.frames.filter(f => { object(f); return f.stream_index === request.streamIndex; });
  const position = request.position;
  let index = position.kind === "first" ? 0 : position.kind === "last" ? frames.length - 1 : position.kind === "frame" ? position.index : frames.findIndex(f => { object(f); return Number(f.best_effort_timestamp_time ?? f.pts_time) >= position.value.numerator / position.value.denominator; });
  if (index < 0 || index >= frames.length) throw new DvError("EXTRACT_FRAME_RANGE", "Requested frame does not exist");
  const output = join(ctx.workDir, "extracted.png");
  const tags = stream.tags; if (tags !== undefined) object(tags);
  await runTool("ffmpeg", ["-v", "error", "-y", ...(stream.codec_name === "vp9" && (tags?.alpha_mode === "1" || tags?.ALPHA_MODE === "1") ? ["-c:v", "libvpx-vp9"] : []), "-i", await inputPath(request.source, ctx), "-map", `0:${request.streamIndex}`, "-an", "-vf", `select=eq(n\\,${index}),scale=round(iw*sar):ih,setsar=1`, "-frames:v", "1", "-c:v", "png", output], { signal: ctx.signal });
  const check = await readProbe(output, ctx.signal);
  if (!Array.isArray(check.frames) || check.frames.length !== 1 || !Array.isArray(check.streams) || check.streams.length !== 1) throw new DvError("EXTRACT_FRAME_INVALID", "PNG must decode exactly one frame");
  return ctx.store.putFile(output, "image/png");
}
export async function stillVideo(request: StillVideoRequest, ctx: ExecuteContext): Promise<ResourceRef> {
  resource(request.image); clock(request.clock); integer(request.totalFrames, "Still frames", 1);
  const output = join(ctx.workDir, "still.mp4");
  const fps = `${request.clock.fps.numerator}/${request.clock.fps.denominator}`;
  await runTool("ffmpeg", ["-v", "error", "-y", "-i", await inputPath(request.image, ctx), "-an", "-vf", `select=eq(n\\,0),pad=ceil(iw/2)*2:ceil(ih/2)*2,setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=clone:stop_duration=${(request.totalFrames + 1) * request.clock.fps.denominator / request.clock.fps.numerator},setsar=1,setpts=N/(${fps}*TB)`, "-r", fps, "-frames:v", String(request.totalFrames), ...pictureEncoding(false), output], { signal: ctx.signal });
  await verifyPicture(output, request.totalFrames, request.clock, false, ctx);
  return ctx.store.putFile(output, "video/mp4");
}
