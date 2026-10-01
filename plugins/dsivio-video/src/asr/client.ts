import { DvError } from "../core/errors.ts";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, WHISPERX_VERSION } from "./install.ts";
import type { AsrConfiguration } from "./install.ts";

export interface AsrHealth { ok: true; protocol: string; serviceVersion: string; whisperxVersion: string; model: string; device: string; compute: string; batchSize: number }
export interface AsrWord { text: string; start?: number; end?: number; score?: number }
export interface AsrSegment { text: string; start?: number; end?: number; words: AsrWord[] }
export interface AsrReply { language: string; segments: AsrSegment[]; words?: AsrWord[] }
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function requestJson(url: string, options: RequestInit, limit: number): Promise<unknown> {
  try {
    const response = await fetch(url, options);
    const reader = response.body?.getReader();
    if (!reader) throw new DvError("ASR_RESPONSE_INVALID", "ASR returned no response body.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new DvError("ASR_RESPONSE_TOO_LARGE", "ASR response exceeds the size limit."); }
      chunks.push(part.value);
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch (error) { throw new DvError("ASR_RESPONSE_INVALID", "ASR did not return valid JSON.", { cause: error }); }
    if (!response.ok) {
      if (record(value) && record(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string") throw new DvError(value.error.code, value.error.message, { hint: value.error.code === "RESOURCE_NOT_PREPARED" ? "Run dsivio-video setup asr." : value.error.code === "BUSY" ? "Wait for the active transcription or startup to finish, then retry." : "See the ASR service log." });
      throw new DvError("ASR_RESPONSE_INVALID", `ASR returned HTTP ${response.status} without an error object.`);
    }
    return value;
  } catch (error) {
    if (error instanceof DvError) throw error;
    if (options.signal?.aborted) {
      const timedOut = options.signal.reason instanceof Error && options.signal.reason.name === "TimeoutError";
      throw new DvError(timedOut ? "ASR_TIMEOUT" : "ABORTED", timedOut ? "ASR request timed out." : "ASR request was interrupted.", { cause: error });
    }
    throw new DvError("ASR_UNAVAILABLE", `Cannot contact local ASR service: ${String(error)}`, { cause: error });
  }
}
export async function healthAsr(port: number, config: Pick<AsrConfiguration, "model" | "device" | "compute" | "batchSize">, signal: AbortSignal = AbortSignal.timeout(10_000)): Promise<AsrHealth> {
  const value = await requestJson(`http://127.0.0.1:${port}/health`, { signal }, 64 * 1024);
  if (!record(value) || value.ok !== true || value.protocol !== ASR_PROTOCOL || value.serviceVersion !== ASR_SERVICE_VERSION || value.whisperxVersion !== WHISPERX_VERSION || value.model !== config.model || value.device !== config.device || value.compute !== config.compute || value.batchSize !== config.batchSize) throw new DvError("ASR_CONFIG_MISMATCH", "ASR health does not match the expected protocol, versions or execution configuration.", { hint: "Stop the old ASR service and run dsivio-video setup asr." });
  return { ok: true, protocol: ASR_PROTOCOL, serviceVersion: ASR_SERVICE_VERSION, whisperxVersion: WHISPERX_VERSION, ...config };
}
export async function shutdownAsr(port: number, config: Pick<AsrConfiguration, "model" | "device" | "compute" | "batchSize">): Promise<void> {
  const signal = AbortSignal.timeout(10_000);
  await healthAsr(port, config, signal);
  const value = await requestJson(`http://127.0.0.1:${port}/shutdown`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal }, 64 * 1024);
  if (!record(value) || value.ok !== true) throw new DvError("ASR_RESPONSE_INVALID", "ASR did not acknowledge idle shutdown.");
}
export function parseAsrReply(value: unknown): AsrReply {
  if (!record(value) || typeof value.language !== "string" || (!Array.isArray(value.segments) && !Array.isArray(value.words))) throw new DvError("ASR_RESPONSE_INVALID", "ASR reply must contain language and segments or words.");
  const parseWord = (word: unknown): AsrWord => {
    if (!record(word) || (typeof word.text !== "string" && typeof word.word !== "string")) throw new DvError("ASR_RESPONSE_INVALID", "ASR word must contain text.");
    return { text: typeof word.text === "string" ? word.text : String(word.word), ...(typeof word.start === "number" ? { start: word.start } : {}), ...(typeof word.end === "number" ? { end: word.end } : {}), ...(typeof word.score === "number" ? { score: word.score } : {}) };
  };
  const segments = (Array.isArray(value.segments) ? value.segments : []).map((segment: unknown): AsrSegment => {
    if (!record(segment) || typeof segment.text !== "string" || (segment.words !== undefined && !Array.isArray(segment.words))) throw new DvError("ASR_RESPONSE_INVALID", "ASR segment must contain text and optional words.");
    return { text: segment.text, words: Array.isArray(segment.words) ? segment.words.map(parseWord) : [], ...(typeof segment.start === "number" ? { start: segment.start } : {}), ...(typeof segment.end === "number" ? { end: segment.end } : {}) };
  });
  return { language: value.language, segments, ...(Array.isArray(value.words) ? { words: value.words.map(parseWord) } : {}) };
}
export async function transcribeAsr(port: number, config: Pick<AsrConfiguration, "model" | "device" | "compute" | "batchSize">, audioPath: string, language: string, timeoutMs = 600_000, abortSignal?: AbortSignal): Promise<{ health: AsrHealth; reply: AsrReply }> {
  const signal = abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const health = await healthAsr(port, config, signal);
  const reply = parseAsrReply(await requestJson(`http://127.0.0.1:${port}/transcribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio_path: audioPath, language }), signal }, 64 * 1024 * 1024));
  return { health, reply };
}
