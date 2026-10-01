import { mkdtemp, open, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { DvError } from "../core/errors.ts";
import { runTool } from "../tools/index.ts";
import { probeMedia } from "./probe.ts";
import type { MediaProbe } from "./probe.ts";
import { prepareOutput, publishFile } from "./publish.ts";
import { renderTimeLabel } from "./time-label.ts";

export interface CutInterval { startSec: number; endSec: number }
export interface CutOptions { startSec?: number; endSec?: number; keep?: CutInterval[]; labelTime?: boolean }
export interface CutReport {
  outputPath: string;
  inputIntervals: CutInterval[];
  nominalMap: { inputStartSec: number; inputEndSec: number; outputStartSec: number; outputEndSec: number }[];
  requestedDuration: number;
  measuredDuration: number;
  videoPresent: boolean;
  audioPresent: boolean;
  timeLabelled: boolean;
  startSec?: number;
  endSec?: number;
}
async function encodeIntervals(input: MediaProbe, intervals: CutInterval[], output: string, evidence: boolean): Promise<void> {
  const seek = Math.max(0, intervals[0]!.startSec - 2);
  const filters: string[] = [];
  const count = intervals.length;
  for (const kind of ["video", "audio"] as const) {
    const index = kind === "video" ? input.videoStreamIndex : input.audioStreamIndex;
    if (index === undefined) continue;
    const prefix = kind === "video" ? "v" : "a";
    if (count > 1) filters.push(`[0:${index}]${kind === "video" ? "split" : "asplit"}=${count}${intervals.map((_, i) => `[${prefix}in${i}]`).join("")}`);
    intervals.forEach((interval, i) => {
      const source = count === 1 ? `0:${index}` : `${prefix}in${i}`;
      filters.push(`[${source}]${kind === "video" ? "trim" : "atrim"}=start=${interval.startSec - seek}:end=${interval.endSec - seek},${kind === "video" ? "setpts" : "asetpts"}=PTS-STARTPTS[${prefix}${i}]`);
    });
  }
  if (count > 1) filters.push(`${intervals.map((_, i) => `${input.hasVideo ? `[v${i}]` : ""}${input.hasAudio ? `[a${i}]` : ""}`).join("")}concat=n=${count}:v=${input.hasVideo ? 1 : 0}:a=${input.hasAudio ? 1 : 0}${input.hasVideo ? "[vout]" : ""}${input.hasAudio ? "[aout]" : ""}`);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-ss", String(seek), "-i", input.path, "-filter_complex", filters.join(";")];
  if (input.hasVideo) args.push("-map", count === 1 ? "[v0]" : "[vout]", "-c:v", "libx264", "-preset", evidence ? "veryfast" : "medium", "-crf", evidence ? "23" : "17", "-pix_fmt", "yuv420p", "-fps_mode", "vfr");
  if (input.hasAudio) args.push("-map", count === 1 ? "[a0]" : "[aout]", "-c:a", input.hasVideo ? "aac" : "pcm_s24le", ...(input.hasVideo ? ["-b:a", evidence ? "96k" : "192k"] : []));
  if ([".mp4", ".mov"].includes(extname(output).toLowerCase())) args.push("-movflags", "+faststart");
  args.push(output);
  await runTool("ffmpeg", args);
}
/** Writes one small label frame at a time to disk, keeping memory independent of clip length. */
async function writeLabels(path: string, start: number, duration: number, rate: number): Promise<{ width: number; height: number }> {
  // Fixed hour digits keep every frame the same size for the raw stream.
  const hourDigits = Math.max(2, String(Math.floor((start + duration) / 3600)).length);
  const file = await open(path, "wx");
  let size = { width: 0, height: 0 };
  try {
    for (let frame = 0; frame < Math.ceil(duration * rate) + 1; frame++) {
      const label = renderTimeLabel(start + frame / rate, hourDigits);
      size = { width: label.width, height: label.height };
      let offset = 0;
      while (offset < label.rgba.length) offset += (await file.write(label.rgba, offset, label.rgba.length - offset)).bytesWritten;
    }
  } finally { await file.close(); }
  return size;
}
export async function cutMedia(path: string, to: string, options: CutOptions = {}): Promise<CutReport> {
  const input = await probeMedia(path);
  if (options.keep && (options.startSec !== undefined || options.endSec !== undefined)) throw new DvError("CLI_USAGE", "--keep cannot be combined with --start or --end.", { hint: "Choose one interval mode." });
  const intervals = options.keep ?? [{ startSec: options.startSec ?? 0, endSec: options.endSec ?? input.durationSec }];
  if (intervals.length === 0) throw new DvError("CLI_USAGE", "--keep must contain at least one interval.", { hint: "Use --keep start:end." });
  let previousEnd = 0;
  for (const interval of intervals) {
    if (!Number.isFinite(interval.startSec) || !Number.isFinite(interval.endSec) || interval.startSec < previousEnd || interval.endSec <= interval.startSec || interval.endSec > input.durationSec + 0.001000001) throw new DvError("CLI_USAGE", `Invalid cut interval ${interval.startSec}:${interval.endSec}; intervals must be ordered, non-overlapping, and within 0..${input.durationSec} seconds (end tolerance 0.001).`, { hint: "Use finite non-negative seconds with end greater than start." });
    previousEnd = interval.endSec;
  }
  if (options.labelTime && (!input.hasVideo || intervals.length !== 1)) throw new DvError("CLI_USAGE", "--label-time requires exactly one video interval.", { hint: "Use one interval on a video file." });
  if (!input.hasVideo && extname(to).toLowerCase() !== ".wav") throw new DvError("CLI_USAGE", "Audio-only cuts require a .wav target.", { hint: "Set --to to a new WAV path." });
  const target = await prepareOutput(to);
  let temp: string | undefined;
  try {
    temp = await mkdtemp(join(dirname(target), ".dv-cut-"));
    const output = join(temp, `output${extname(target)}`);
    if (options.labelTime) {
      const clean = join(temp, "clean.mp4");
      await encodeIntervals(input, intervals, clean, true);
      const cleanProbe = await probeMedia(clean);
      const rate = Math.max(1, Math.min(30, Math.ceil(input.fps || 10)));
      const labelPath = join(temp, "labels.rgba");
      const size = await writeLabels(labelPath, intervals[0]!.startSec, cleanProbe.durationSec, rate);
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i", clean, "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${size.width}x${size.height}`, "-framerate", String(rate), "-i", labelPath, "-filter_complex", "[0:v:0][1:v:0]overlay=8:8:shortest=1[v]", "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-fps_mode", "vfr", "-c:a", "aac", "-b:a", "96k"];
      if ([".mp4", ".mov"].includes(extname(output).toLowerCase())) args.push("-movflags", "+faststart");
      await runTool("ffmpeg", [...args, output]);
    } else await encodeIntervals(input, intervals, output, false);
    const measured = await probeMedia(output);
    // Seconds are reported at millisecond precision, like every other media report.
    const ms = (value: number) => Math.round(value * 1000) / 1000;
    let cursor = 0;
    const nominalMap = intervals.map(interval => {
      const begin = cursor;
      cursor = ms(cursor + interval.endSec - interval.startSec);
      return { inputStartSec: interval.startSec, inputEndSec: interval.endSec, outputStartSec: begin, outputEndSec: cursor };
    });
    await publishFile(output, target);
    return { outputPath: target, inputIntervals: intervals, nominalMap, requestedDuration: cursor, measuredDuration: measured.durationSec, videoPresent: measured.hasVideo, audioPresent: measured.hasAudio, timeLabelled: Boolean(options.labelTime), ...(intervals.length === 1 ? { startSec: intervals[0]!.startSec, endSec: intervals[0]!.endSec } : {}) };
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("MEDIA_CUT_FAILED", `Cannot cut ${input.path} to ${target}: ${error instanceof Error ? error.message : String(error)}`, { cause: error, hint: "Check the target permissions and media container/codec compatibility." });
  } finally { if (temp) await rm(temp, { recursive: true, force: true }); }
}
