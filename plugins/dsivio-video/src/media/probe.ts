import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DvError } from "../core/errors.ts";
import { runTool } from "../tools/index.ts";

export interface FfprobeStream {
  index: number;
  codecType: string;
  attachedPicture: boolean;
  width?: number;
  height?: number;
  frameRate?: string;
}
export interface StreamProbe { path: string; durationSec: number; streams: FfprobeStream[] }
export interface MediaProbe {
  path: string;
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
  videoStreamIndex?: number;
  audioStreamIndex?: number;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export async function ffprobeStreams(path: string): Promise<StreamProbe> {
  const input = resolve(path);
  try {
    if (!(await stat(input)).isFile()) throw new Error("Input is not a regular file.");
  } catch (error) {
    throw new DvError("MEDIA_INPUT_INVALID", `Cannot read media file ${input}: ${error instanceof Error ? error.message : String(error)}`, { cause: error, hint: "Provide an existing regular media file." });
  }
  const result = await runTool("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", input], { maxStdoutBytes: 8 * 1024 * 1024 });
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout.toString("utf8")); }
  catch (error) { throw new DvError("MEDIA_PROBE_INVALID", `ffprobe returned invalid JSON for ${input}.`, { cause: error, hint: "Check the ffprobe installation." }); }
  if (!object(parsed) || !object(parsed.format) || !Array.isArray(parsed.streams)) throw new DvError("MEDIA_PROBE_INVALID", `ffprobe returned incomplete metadata for ${input}.`, { hint: "Use a media container with valid stream metadata and duration." });
  const durationSec = Number(parsed.format.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new DvError("MEDIA_DURATION_INVALID", `Media duration must be finite and positive: ${input}`, { hint: "Use a timed video or audio container, not a still image." });
  const streams: FfprobeStream[] = [];
  for (const raw of parsed.streams) {
    if (!object(raw) || !Number.isSafeInteger(raw.index) || typeof raw.index !== "number" || typeof raw.codec_type !== "string") throw new DvError("MEDIA_PROBE_INVALID", `Invalid stream metadata in ${input}.`, { hint: "Check that ffprobe can read this file." });
    const stream: FfprobeStream = { index: raw.index, codecType: raw.codec_type, attachedPicture: object(raw.disposition) && raw.disposition.attached_pic === 1 };
    if (typeof raw.width === "number") stream.width = raw.width;
    if (typeof raw.height === "number") stream.height = raw.height;
    if (typeof raw.r_frame_rate === "string") stream.frameRate = raw.r_frame_rate;
    streams.push(stream);
  }
  return { path: input, durationSec, streams };
}
export async function probeMedia(path: string): Promise<MediaProbe> {
  const probe = await ffprobeStreams(path);
  const video = probe.streams.find(stream => stream.codecType === "video" && !stream.attachedPicture);
  const audio = probe.streams.find(stream => stream.codecType === "audio");
  if (!video && !audio) throw new DvError("MEDIA_STREAMS_MISSING", `No video or audio stream found in ${probe.path}.`, { hint: "Provide a video or audio file." });
  const result: MediaProbe = { path: probe.path, durationSec: Math.round(probe.durationSec * 1000) / 1000, hasVideo: Boolean(video), hasAudio: Boolean(audio) };
  if (audio) result.audioStreamIndex = audio.index;
  if (video) {
    if (!video.width || !video.height || !Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) || video.width <= 0 || video.height <= 0) throw new DvError("MEDIA_VIDEO_SIZE_INVALID", `Video dimensions missing or invalid in ${probe.path}.`, { hint: "Provide a decodable video with valid dimensions." });
    const parts = video.frameRate?.split("/") ?? [];
    const fps = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number.NaN;
    result.width = video.width;
    result.height = video.height;
    result.fps = Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : 0;
    result.videoStreamIndex = video.index;
  }
  return result;
}
