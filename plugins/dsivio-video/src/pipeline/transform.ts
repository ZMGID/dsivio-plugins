import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { ExecuteContext } from "../core/capability.ts";
import type { SynchronizedMedia } from "../timeline/types.ts";
import type { TransformRequest } from "./types.ts";
import { runTool } from "../tools/index.ts";
import { frameToSample48k } from "../timeline/math.ts";
import { pictureEncoding, quantize, tempoFilters, verifyAudio, verifyPicture } from "./normalize.ts";
import { validateMedia, validateTransform } from "./validate.ts";
import { inputPath } from "./inspect.ts";

export async function transformMedia(request: TransformRequest, ctx: ExecuteContext): Promise<SynchronizedMedia> {
  validateMedia(request.media); validateTransform(request.plan);
  let current = request.media;
  for (const [index, op] of request.plan.operations.entries()) {
    const end = op.kind === "trim" ? op.frames.end : undefined;
    if (op.kind === "trim" && (end === undefined || end > current.totalFrames)) throw new DvError("TRANSFORM_TRIM_RANGE", `Trim ${index} requires an explicit end inside current frame count ${current.totalFrames}`);
    const frames = op.kind === "trim" ? end! - op.frames.start : Math.max(1, quantize(BigInt(current.totalFrames) * BigInt(op.speed.denominator), BigInt(op.speed.numerator)));
    const next: SynchronizedMedia = { clock: current.clock, totalFrames: frames };
    const fps = `${current.clock.fps.numerator}/${current.clock.fps.denominator}`;
    if (current.picture) {
      const alpha = current.picture.alpha === "straight";
      const output = join(ctx.workDir, `transform-${index}.${alpha ? "webm" : "mp4"}`);
      const filters = op.kind === "trim" ? [`trim=start_frame=${op.frames.start}:end_frame=${op.frames.end}`, "setpts=PTS-STARTPTS"] : [`setpts=(PTS-STARTPTS)*${op.speed.denominator}/${op.speed.numerator}`];
      filters.push(`fps=${fps}`, `tpad=stop_mode=clone:stop_duration=${frames * current.clock.fps.denominator / current.clock.fps.numerator}`, `trim=end_frame=${frames}`, `setpts=N/(${fps}*TB)`, "setsar=1");
      await runTool("ffmpeg", ["-v", "error", "-y", ...(alpha ? ["-c:v", "libvpx-vp9"] : []), "-i", await inputPath(current.picture.resource, ctx), "-an", "-vf", filters.join(","), "-frames:v", String(frames), ...pictureEncoding(alpha), output], { signal: ctx.signal });
      const extent = await verifyPicture(output, frames, current.clock, alpha, ctx);
      next.picture = { resource: await ctx.store.putFile(output, alpha ? "video/webm" : "video/mp4"), extent, alpha: current.picture.alpha };
    }
    if (current.sound) {
      const input = await inputPath(current.sound.resource, ctx);
      await verifyAudio(input, 48000, 2, current.sound.totalSamples, ctx);
      const samples = frameToSample48k(frames, current.clock);
      const filters = op.kind === "trim" ? [`atrim=start_sample=${frameToSample48k(op.frames.start, current.clock)}:end_sample=${frameToSample48k(end!, current.clock)}`, "asetpts=PTS-STARTPTS"] : tempoFilters(op.speed);
      filters.push(`apad=whole_len=${samples}`, `atrim=end_sample=${samples}`, "asetpts=N/SR/TB");
      const output = join(ctx.workDir, `transform-${index}.wav`);
      await runTool("ffmpeg", ["-v", "error", "-y", "-i", input, "-af", filters.join(","), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", output], { signal: ctx.signal });
      await verifyAudio(output, 48000, 2, samples, ctx);
      next.sound = { resource: await ctx.store.putFile(output, "audio/wav"), totalSamples: samples };
    }
    ctx.log(`Transform ${index}: ${op.kind}, frames ${current.totalFrames} -> ${frames}`);
    current = next;
  }
  validateMedia(current); return current;
}
