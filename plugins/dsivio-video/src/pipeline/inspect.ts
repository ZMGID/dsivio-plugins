import { stat } from "node:fs/promises";
import { DvError } from "../core/errors.ts";
import type { ResourceRef } from "../core/value.ts";
import type { ExecuteContext } from "../core/capability.ts";
import type { Rational } from "../timeline/types.ts";
import type { InspectedStream, Inspection } from "./types.ts";
import { runTool, toolVersion } from "../tools/index.ts";
import { object, resource, validateInspection } from "./validate.ts";

export async function inputPath(ref: ResourceRef, ctx: ExecuteContext): Promise<string> {
  resource(ref); const path = ctx.store.pathOf(ref);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== ref.bytes) throw new DvError("MEDIA_RESOURCE_INVALID", `Resource ${ref.$resource} byte count or file shape disagrees with declaration`);
  } catch (cause) {
    if (cause instanceof DvError) throw cause;
    throw new DvError("MEDIA_RESOURCE_MISSING", `Cannot read resource ${ref.$resource}`, { cause });
  }
  return path;
}

export function safeRational(numerator: bigint, denominator: bigint): Rational {
  const gcd = (a: bigint, b: bigint): bigint => { while (b) { const next = a % b; a = b; b = next; } return a < 0n ? -a : a; };
  const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
  if (denominator < 0n) { denominator = -denominator; numerator = -numerator; }
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || numerator < BigInt(Number.MIN_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER) || denominator <= 0n) throw new DvError("MEDIA_TIME_OVERFLOW", "Media rational exceeds safe integers");
  return { numerator: Number(numerator), denominator: Number(denominator) };
}
export function parseRational(value: unknown, separator = "/"): Rational | undefined {
  if (typeof value !== "string") return undefined;
  const pieces = value.split(separator); if (pieces.length !== 2 || !/^-?\d+$/.test(pieces[0]!) || !/^\d+$/.test(pieces[1]!) || BigInt(pieces[1]!) === 0n) return undefined;
  return safeRational(BigInt(pieces[0]!), BigInt(pieces[1]!));
}
function tick(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}
export async function readProbe(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const result = await runTool("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-show_frames", "-of", "json", path], { signal, maxStdoutBytes: 256 * 1024 * 1024 });
  let raw: unknown;
  try { raw = JSON.parse(result.stdout.toString("utf8")); } catch (cause) { throw new DvError("MEDIA_PROBE_INVALID", "Invalid ffprobe JSON", { cause }); }
  object(raw); return raw;
}
export async function inspectMedia(source: ResourceRef, ctx: ExecuteContext): Promise<Inspection> {
  resource(source);
  const raw = await readProbe(await inputPath(source, ctx), ctx.signal);
  if (!Array.isArray(raw.streams) || !Array.isArray(raw.frames)) throw new DvError("MEDIA_PROBE_INVALID", "Missing streams or decoded frames");
  const streams: InspectedStream[] = [];
  for (const item of raw.streams) {
    object(item);
    const kind = item.codec_type === "video" || item.codec_type === "audio" ? item.codec_type : "other";
    const disposition = item.disposition; if (disposition !== undefined) object(disposition);
    const stream: InspectedStream = { streamIndex: Number(item.index), kind, codec: String(item.codec_name ?? "unknown"), default: disposition?.default === 1, attachedPicture: disposition?.attached_pic === 1 };
    const frames = raw.frames.filter(f => { object(f); return f.stream_index === item.index; });
    const timeBase = parseRational(item.time_base);
    const pts = frames.map(f => { object(f); return tick(f.best_effort_timestamp ?? f.pts); });
    let timingValid = Boolean(timeBase && frames.length && pts.every(p => p !== undefined));
    const diffs: bigint[] = [];
    for (let i = 1; i < pts.length; i++) { if (pts[i] === undefined || pts[i - 1] === undefined) continue; const diff = pts[i]! - pts[i - 1]!; diffs.push(diff); if (diff <= 0n) timingValid = false; }
    const durations = frames.map((frame, i) => {
      object(frame);
      const reported = tick(frame.duration ?? frame.pkt_duration);
      if (reported !== undefined && reported > 0n) return reported;
      if (kind === "audio" && timeBase && Number(item.sample_rate) > 0 && Number(frame.nb_samples) > 0) return BigInt(Number(frame.nb_samples)) * BigInt(timeBase.denominator) / (BigInt(Number(item.sample_rate)) * BigInt(timeBase.numerator));
      return i + 1 < pts.length && pts[i + 1] !== undefined && pts[i] !== undefined ? pts[i + 1]! - pts[i]! : diffs.at(-1);
    });
    if (durations.some(d => d === undefined || d <= 0n)) timingValid = false;
    if (timingValid && timeBase) {
      if (kind === "audio") for (let i = 1; i < pts.length; i++) { const gap = pts[i]! - pts[i - 1]! - durations[i - 1]!; if (gap < -2n || gap > 2n) timingValid = false; }
      if (kind === "video" && diffs.length >= 2) {
        const sorted = [...diffs].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
        const halfSecond = (BigInt(timeBase.denominator) + 2n * BigInt(timeBase.numerator) - 1n) / (2n * BigInt(timeBase.numerator));
        const limit = median * 4n > halfSecond ? median * 4n : halfSecond;
        if (diffs.some(d => d > limit)) timingValid = false;
      }
      if (timingValid) stream.timing = { startSeconds: safeRational(pts[0]! * BigInt(timeBase.numerator), BigInt(timeBase.denominator)), durationSeconds: safeRational((pts.at(-1)! - pts[0]! + durations.at(-1)!) * BigInt(timeBase.numerator), BigInt(timeBase.denominator)) };
    }
    if (!timingValid && kind !== "other") ctx.log(`Stream ${stream.streamIndex}: missing, discontinuous or non-monotonic decoded timing`);
    if (kind === "video") {
      const side = item.side_data_list; let rotation = 0;
      if (Array.isArray(side)) for (const entry of side) { object(entry); if (entry.rotation !== undefined) rotation = ((Number(entry.rotation) % 360) + 360) % 360; }
      if (![0, 90, 180, 270].includes(rotation)) throw new DvError("MEDIA_ROTATION_INVALID", `Unsupported rotation ${rotation}`);
      const fps = parseRational(item.avg_frame_rate) ?? parseRational(item.r_frame_rate);
      if (fps && fps.numerator > 0) {
        const tags = item.tags; if (tags !== undefined) object(tags);
        const alpha = /^(?:yuva|rgba|bgra|argb|abgr|gbrap|ya)/.test(String(item.pix_fmt)) || tags?.alpha_mode === "1" || tags?.ALPHA_MODE === "1";
        stream.picture = { extent: { widthPx: Number(item.width), heightPx: Number(item.height) }, fps, moving: frames.length > 1 && !stream.attachedPicture, alpha, rotationDegrees: rotation, pixelAspect: parseRational(item.sample_aspect_ratio, ":") ?? { numerator: 1, denominator: 1 } };
      }
    }
    if (kind === "audio") stream.sound = { sampleRate: Number(item.sample_rate), channels: Number(item.channels), ...(frames.length ? { totalSamples: frames.reduce((sum, f) => { object(f); return sum + Number(f.nb_samples ?? 0); }, 0) } : {}) };
    streams.push(stream);
  }
  streams.sort((a, b) => a.streamIndex - b.streamIndex);
  ctx.log(`Inspection: ${(await toolVersion("ffprobe"))}; ${streams.length} streams`);
  const inspection = { source, streams }; validateInspection(inspection); return inspection;
}
