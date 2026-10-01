import sharp from "sharp";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DvError } from "../core/errors.ts";
import { runTool } from "../tools/index.ts";
import { probeMedia } from "./probe.ts";
import { prepareOutput, publishDirectory } from "./publish.ts";
import { sampleRange, timeSlug } from "./sample.ts";
import type { SamplingOptions } from "./sample.ts";
import { transcriptContext } from "./transcript.ts";
import type { TranscriptContext } from "./transcript.ts";
import type { TranscriptDocument } from "./transcript-types.ts";
import { labelTimeBitmap, renderGrid } from "./grid.ts";

export interface ExtractedFrame { image: Buffer; observedSec: number; wantedSec?: number }
export interface FrameEvidence { filePath: string; observedSec: number; wantedSec?: number; activeTokens?: TranscriptContext["activeTokens"]; contextTokens?: TranscriptContext["contextTokens"] }
function showinfoTimes(): { times: number[]; onStderrLine: (line: string) => void } {
  const times: number[] = [];
  let numerator = 0;
  let denominator = 0;
  return { times, onStderrLine: line => {
    const base = /config in time_base:\s*(\d+)\/(\d+)/.exec(line);
    if (base) { numerator = Number(base[1]); denominator = Number(base[2]); }
    const pts = /\bn:\s*\d+\s+pts:\s*(-?\d+)/.exec(line);
    if (pts && numerator > 0 && denominator > 0) times.push(Number(pts[1]) * numerator / denominator);
  } };
}
export async function extractFrame(source: string, streamIndex: number, wantedSec: number, workDir: string, ordinal: number): Promise<ExtractedFrame> {
  const file = join(workDir, `sample-${ordinal}.jpg`);
  const info = showinfoTimes();
  await runTool("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-ss", String(Math.max(0, wantedSec - 2)), "-copyts", "-i", source, "-map", `0:${streamIndex}`, "-an", "-vf", `select=gte(t\\,${wantedSec}),showinfo`, "-frames:v", "1", "-fps_mode", "passthrough", "-pix_fmt", "yuvj420p", "-q:v", "3", file], { onStderrLine: info.onStderrLine });
  const observedSec = info.times[0];
  if (observedSec === undefined) throw new DvError("MEDIA_NO_FRAME", `No frame at or after ${wantedSec}s in ${source}.`, { hint: "Choose a time earlier than the last source frame." });
  try { return { image: await readFile(file), observedSec, wantedSec }; }
  catch (error) { throw new DvError("MEDIA_FRAME_READ", `Cannot read extracted frame ${file}.`, { hint: "Check ffmpeg output and available disk space.", cause: error }); }
}
export async function extractRawFrames(source: string, streamIndex: number, startSec: number, endSec: number, workDir: string): Promise<ExtractedFrame[]> {
  const info = showinfoTimes();
  await runTool("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-ss", String(Math.max(0, startSec - 2)), "-to", String(endSec), "-copyts", "-i", source, "-map", `0:${streamIndex}`, "-an", "-vf", `select=gte(t\\,${startSec})*lt(t\\,${endSec}),showinfo`, "-fps_mode", "passthrough", "-pix_fmt", "yuvj420p", "-q:v", "3", "-start_number", "0", join(workDir, "raw-%09d.jpg")], { onStderrLine: info.onStderrLine });
  if (!info.times.length) throw new DvError("MEDIA_NO_FRAME", `No source frames in [${startSec},${endSec}) for ${source}.`, { hint: "Choose a range containing at least one original video frame." });
  const frames: ExtractedFrame[] = [];
  for (let index = 0; index < info.times.length; index++) {
    const file = join(workDir, `raw-${String(index).padStart(9, "0")}.jpg`);
    try { frames.push({ image: await readFile(file), observedSec: info.times[index]! }); }
    catch (error) { throw new DvError("MEDIA_FRAME_READ", `Cannot read raw frame ${file}.`, { hint: "Check ffmpeg output and available disk space.", cause: error }); }
  }
  return frames;
}
export interface FramesOptions extends SamplingOptions { to: string; labelTime?: boolean; transcript?: TranscriptDocument }
export interface FramesReport { outputPath: string; items: FrameEvidence[]; timeLabelled?: boolean }
export async function mediaFrames(source: string, options: FramesOptions): Promise<FramesReport> {
  const probe = await probeMedia(source);
  if (!probe.hasVideo || probe.videoStreamIndex === undefined || !probe.width) throw new DvError("MEDIA_VIDEO_REQUIRED", `Frames require video: ${probe.path}.`, { hint: "Use an input with a non-cover video stream." });
  const range = sampleRange(probe.durationSec, options, options.transcript, true);
  const outputPath = await prepareOutput(options.to);
  let workDir: string | undefined;
  let outputDir: string | undefined;
  try {
    workDir = await mkdtemp(join(dirname(outputPath), ".dv-frames-"));
    outputDir = await mkdtemp(join(dirname(outputPath), ".dv-frames-output-"));
    const extracted: ExtractedFrame[] = [];
    if (options.everyFrame) extracted.push(...await extractRawFrames(probe.path, probe.videoStreamIndex, range.startSec, range.endSec, workDir));
    else for (const [index, time] of range.requestedTimes.entries()) extracted.push(await extractFrame(probe.path, probe.videoStreamIndex, time, workDir, index));
    const items: FrameEvidence[] = [];
    for (const [index, frame] of extracted.entries()) {
      const name = options.everyFrame ? `frame-${String(index).padStart(9, "0")}.jpg` : `frame-${timeSlug(frame.wantedSec!)}.jpg`;
      const context = options.transcript ? transcriptContext(options.transcript, frame.observedSec) : undefined;
      let image = frame.image;
      if (context || (options.everyFrame && options.labelTime)) image = (await renderGrid([{ image, observedSec: frame.observedSec, ...(context ? { context } : {}) }], probe.width, 1)).image;
      else if (options.labelTime) image = await labelTimeBitmap(image, frame.observedSec);
      // Grid images are PNG internally; exported frames are always JPEG.
      if (context || (options.everyFrame && options.labelTime)) {
        image = await sharp(image).jpeg({ quality: 95 }).toBuffer();
      }
      await writeFile(join(outputDir, name), image, { flag: "wx" });
      items.push({ filePath: join(outputPath, name), observedSec: frame.observedSec, ...(frame.wantedSec !== undefined ? { wantedSec: frame.wantedSec, ...(context ?? {}) } : {}) });
    }
    await publishDirectory(outputDir, outputPath);
    return { outputPath, items, ...(options.everyFrame ? {} : { timeLabelled: Boolean(options.labelTime || options.transcript) }) };
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("MEDIA_FRAMES", `Cannot export frames to ${outputPath}: ${error instanceof Error ? error.message : String(error)}`, { hint: "Check target permissions and free disk space.", cause: error });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
  }
}
