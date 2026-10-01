import { createHash, randomUUID } from "node:crypto";
import { open, rename, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { locateTool } from "../../tools/index.ts";
import { privateDirectory } from "../standalone-config.ts";
import { ProviderFailure } from "./types.ts";
import type { Json } from "../../core/value.ts";
import { wireObject } from "./description.ts";

export interface SavedOutput { path: string; mime: string; sha256: string; bytes: number; metadata: Record<string, Json> }
export function signatureMime(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (bytes.toString("ascii", 0, 4) === "fLaC") return "audio/flac";
  if (bytes.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (bytes.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  return undefined;
}
export function decodeBase64(value: unknown, limit = 128 * 1024 * 1024): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Invalid or oversized base64 media", "uncertain");
  const bytes = Buffer.from(value, "base64"); if (!bytes.length || bytes.length > limit) throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Empty or oversized media", "uncertain"); return bytes;
}
export async function probeProviderMedia(path: string, mime: string): Promise<Record<string, Json>> {
  if (mime.startsWith("image/")) { const metadata = await sharp(path, { limitInputPixels: 64_000_000 }).metadata(); if (!metadata.width || !metadata.height) throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Image has no decoded dimensions", "query"); return { width: metadata.width, height: metadata.height, hasAlpha: !!metadata.hasAlpha }; }
  const tool = await locateTool("ffprobe");
  const environment: NodeJS.ProcessEnv = {}; for (const name of ["PATH", "HOME", "TMPDIR", "SystemRoot", "WINDIR"]) if (process.env[name]) environment[name] = process.env[name];
  const { stdout } = await promisify(execFile)(tool.path, ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], { env: environment, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  const data = wireObject(JSON.parse(stdout)); const format = wireObject(data.format);
  if (!Array.isArray(data.streams)) throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Media lacks streams", "query");
  const streams = data.streams.map(wireObject); const duration = Number(format.duration);
  const stream = streams.find(s => s.codec_type === (mime.startsWith("audio/") ? "audio" : "video"));
  if (!stream || !Number.isFinite(duration) || duration <= 0) throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Media lacks a valid timed stream", "query");
  if (mime === "audio/ogg" && stream.codec_name !== "opus") throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Expected Opus in Ogg container", "query");
  if (mime === "audio/mpeg" && stream.codec_name !== "mp3" || mime === "audio/flac" && stream.codec_name !== "flac") throw new ProviderFailure("GATEWAY_MIME_INVALID", "Audio codec contradicts container MIME", "query");
  const frameRate = typeof stream.avg_frame_rate === "string" ? stream.avg_frame_rate.split("/").map(Number) : [];
  return { duration, ...(typeof stream.width === "number" && typeof stream.height === "number" ? { width: stream.width, height: stream.height } : {}), ...(stream.sample_rate && typeof stream.channels === "number" ? { sampleRate: Number(stream.sample_rate), channels: stream.channels } : {}), ...(frameRate.length === 2 && frameRate[1] ? { frameRate: frameRate[0]! / frameRate[1] } : {}), codec: stream.codec_name ?? null, audioCodecs: streams.filter(s => s.codec_type === "audio").map(s => s.codec_name ?? null), format: format.format_name ?? null, streams };
}
export async function saveProviderArtifact(directory: string, index: number, bytes: Buffer, declaredMime: string, kind: "image" | "video" | "audio"): Promise<SavedOutput> {
  const mime = signatureMime(bytes); const aliases: Record<string, string> = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg", "audio/opus": "audio/ogg", "image/jpg": "image/jpeg" };
  if (!mime || !mime.startsWith(`${kind}/`) || (aliases[declaredMime] ?? declaredMime) !== mime || bytes.length > 512 * 1024 * 1024) throw new ProviderFailure("GATEWAY_MIME_INVALID", "Media signature contradicts declared MIME or requested kind", "query");
  await privateDirectory(directory);
  const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/ogg": "opus" };
  const path = join(directory, `${index}.${extensions[mime]}`); const part = `${path}.${randomUUID()}.part`;
  const file = await open(part, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  try { const metadata = await probeProviderMedia(part, mime); await rename(part, path); const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } return { path, mime, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, metadata }; }
  catch (error) { await rm(part, { force: true }); throw error; }
}
export async function verifySavedOutputs(outputs: SavedOutput[]): Promise<void> {
  for (const output of outputs) { const bytes = await readFile(output.path); if (bytes.length !== output.bytes || createHash("sha256").update(bytes).digest("hex") !== output.sha256) throw new ProviderFailure("GATEWAY_ARTIFACT_CHANGED", "Saved task artifact is missing or changed; receipt is retained and generation will not be repeated", "query"); }
}
