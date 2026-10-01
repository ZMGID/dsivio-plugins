import { mkdtemp, open, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { Page } from "puppeteer-core";
import { DvError } from "../core/errors.ts";
import { prepareOutput, publishFile } from "../media/publish.ts";
import { locateTool, runTool } from "../tools/index.ts";
import type { CaptureOutput } from "./session.ts";

export type RecordOptions = { to: string; audio?: boolean; maxWidth?: number; maxHeight?: number; frameRate?: number; signal?: AbortSignal };
export type Recording = { stop(): Promise<CaptureOutput> };
type RecordingStream = { stream: string };
type NativeRecordingSender = (command: "Page.startScreenRecording" | "Page.stopScreenRecording", options?: Omit<RecordOptions, "to" | "signal">) => Promise<RecordingStream>;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export async function startRecording(page: Page, options: RecordOptions): Promise<Recording> {
  await locateTool("ffprobe");
  for (const number of [options.maxWidth, options.maxHeight, options.frameRate]) if (number !== undefined && (!Number.isSafeInteger(number) || number <= 0)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Recording dimensions and frame rate must be positive safe integers.");
  if (options.audio !== undefined && typeof options.audio !== "boolean") throw new DvError("CAPTURE_OPTIONS_INVALID", "Recording audio must be an explicit boolean.");
  if (options.signal?.aborted) throw new DvError("ABORTED", "Recording was cancelled before starting.");
  const target = await prepareOutput(options.to);
  if (extname(target).toLowerCase() !== ".mp4") throw new DvError("CAPTURE_OPTIONS_INVALID", "Native recording output must use .mp4.");
  const client = await page.createCDPSession();
  // Puppeteer 25.8's protocol typings omit these experimental commands; Chrome 153's real CDP supports them.
  const sendRecording = client.send.bind(client) as unknown as NativeRecordingSender;
  const size = await page.evaluate(() => ({ width: Math.round(innerWidth * devicePixelRatio), height: Math.round(innerHeight * devicePixelRatio) }));
  let startStream: string;
  try {
    const result = await sendRecording("Page.startScreenRecording", { audio: options.audio ?? false, maxWidth: options.maxWidth ?? size.width, maxHeight: options.maxHeight ?? size.height, ...(options.frameRate !== undefined ? { frameRate: options.frameRate } : {}) });
    if (!result.stream) throw new Error("Native recording did not return an IO stream.");
    startStream = result.stream;
  } catch (cause) {
    await client.detach();
    throw new DvError("CAPTURE_RECORDING_UNAVAILABLE", "This browser does not provide native CDP MP4 screen recording.", { cause, hint: "Prepare the pinned capture Chrome; no screencast fallback is used." });
  }
  const url = page.url();
  let promise: Promise<CaptureOutput> | undefined;
  let aborted = options.signal?.aborted ?? false;
  const onAbort = (): void => { aborted = true; };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const recording: Recording = {
    stop() {
      promise ??= (async () => {
        let scratch: string | undefined;
        let stream = startStream;
        try {
          const result = await sendRecording("Page.stopScreenRecording");
          stream = result.stream || startStream;
          scratch = await mkdtemp(join(dirname(target), ".dv-record-"));
          const path = join(scratch, "recording.mp4");
          const file = await open(path, "wx");
          try {
            let bytes = 0;
            while (true) {
              const chunk = await client.send("IO.read", { handle: stream, size: 1024 * 1024 });
              const data = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
              bytes += data.byteLength;
              if (bytes > 16 * 1024 ** 3) throw new DvError("CAPTURE_RECORDING_LIMIT", "Recording exceeds the 16 GiB output limit.");
              let offset = 0;
              while (offset < data.byteLength) {
                const written = await file.write(data, offset);
                if (written.bytesWritten <= 0) throw new DvError("CAPTURE_RECORDING_FAILED", "Recording IO made no progress writing its stream.");
                offset += written.bytesWritten;
              }
              if (chunk.eof) break;
            }
          } finally { await file.close(); }
          const probe = await runTool("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path]);
          let metadata: unknown;
          try { metadata = JSON.parse(probe.stdout.toString("utf8")); }
          catch (cause) { throw new DvError("CAPTURE_RECORDING_INVALID", "Recording probe returned invalid JSON.", { cause }); }
          if (!object(metadata) || !object(metadata.format) || typeof metadata.format.format_name !== "string" || !metadata.format.format_name.split(",").includes("mp4") || !Array.isArray(metadata.streams) || !metadata.streams.every(object)) throw new DvError("CAPTURE_RECORDING_INVALID", "Native recording is not a valid MP4 container.");
          const videos = metadata.streams.filter(stream => stream.codec_type === "video");
          const audioPresent = metadata.streams.some(stream => stream.codec_type === "audio");
          const video = videos[0];
          const ratio = typeof video?.avg_frame_rate === "string" ? video.avg_frame_rate.split("/").map(Number) : [];
          const fps = ratio[0]! / ratio[1]!;
          const durationSeconds = Number(metadata.format.duration);
          if (videos.length !== 1 || !video || !Number.isSafeInteger(video.width) || Number(video.width) <= 0 || !Number.isSafeInteger(video.height) || Number(video.height) <= 0 || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || (options.audio !== true && audioPresent)) throw new DvError("CAPTURE_RECORDING_INVALID", "Native recording has invalid video metadata or unexpected audio.");
          if (aborted || options.signal?.aborted) throw new DvError("ABORTED", "Recording was cancelled.");
          await publishFile(path, target);
          return { kind: "video", path: target, url, width: Number(video.width), height: Number(video.height), format: "mp4", durationSeconds, fps, audioPresent };
        } catch (cause) { if (cause instanceof DvError) throw cause; throw new DvError("CAPTURE_RECORDING_FAILED", "Native recording could not be finalized.", { cause }); }
        finally {
          options.signal?.removeEventListener("abort", onAbort);
          try { await client.send("IO.close", { handle: stream }); }
          finally { try { await client.detach(); } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); } }
        }
      })();
      return promise;
    },
  };
  return recording;
}
