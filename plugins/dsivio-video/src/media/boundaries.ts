import { DvError } from "../core/errors.ts";
import { runTool } from "../tools/index.ts";
import { probeMedia } from "./probe.ts";

export interface BoundaryOptions { rate?: number; threshold?: number }
export interface BoundaryReport {
  inputPath: string;
  rateHz: number;
  minChange: number;
  events: { observedAtSec: number; changeMagnitude: number }[];
}
export async function findBoundaries(path: string, options: BoundaryOptions = {}): Promise<BoundaryReport> {
  const rate = options.rate ?? 12;
  const threshold = options.threshold ?? 0.1;
  if (!Number.isFinite(rate) || rate < 1 || rate > 120) throw new DvError("CLI_USAGE", "--rate must be finite and within 1..120 samples/s.", { hint: "Use a rate such as 12." });
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new DvError("CLI_USAGE", "--threshold must be finite and within 0..1.", { hint: "Use a normalized pixel difference threshold such as 0.1." });
  const input = await probeMedia(path);
  if (!input.hasVideo) throw new DvError("MEDIA_VIDEO_REQUIRED", `Boundaries require video: ${input.path}`, { hint: "Provide a video file rather than audio or cover art." });
  const report: BoundaryReport = { inputPath: input.path, rateHz: rate, minChange: threshold, events: [] };
  let current = Buffer.alloc(3072);
  let previous = Buffer.alloc(3072);
  let used = 0;
  let frame = 0;
  await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", input.path, "-map", `0:${input.videoStreamIndex}`, "-an", "-vf", `fps=${rate},scale=32:32`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], {
    collectStdout: false,
    maxStdoutBytes: Number.MAX_SAFE_INTEGER,
    onStdoutChunk(chunk) {
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(3072 - used, chunk.length - offset);
        chunk.copy(current, used, offset, offset + length);
        offset += length;
        used += length;
        if (used !== 3072) continue;
        if (frame > 0) {
          let difference = 0;
          for (let i = 0; i < 3072; i++) difference += Math.abs(current[i]! - previous[i]!);
          const score = difference / 3072 / 255;
          if (score >= threshold) report.events.push({ observedAtSec: Math.round(frame / rate * 1000) / 1000, changeMagnitude: Math.round(score * 1000) / 1000 });
        }
        const swap = previous;
        previous = current;
        current = swap;
        frame++;
        used = 0;
      }
    },
  });
  return report;
}
