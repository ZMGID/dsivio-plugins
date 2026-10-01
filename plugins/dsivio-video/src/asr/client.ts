import { DvError } from "../core/errors.ts";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, WHISPERX_VERSION } from "./install.ts";
import type { AsrConfiguration } from "./install.ts";

export interface AsrHealth { ok: true; protocol: string; serviceVersion: string; whisperxVersion: string; model: string; device: string; compute: string; batchSize: number; busy?: boolean; activeTaskId?: string | null }
export interface AsrWord { text: string; start?: number; end?: number; score?: number }
export interface AsrSegment { text: string; start?: number; end?: number; words: AsrWord[] }
export interface AsrReply {
  language: string; segments: AsrSegment[]; words?: AsrWord[];
  schema?: "dsivio.media.transcript/1"; sampleRate?: 16000; sampleFrames?: number;
  engine?: { backend: string; model: string; protocol: string; serviceVersion?: string; whisperxVersion?: string };
}
export interface AsrRequestOptions { token?: string; taskId?: string; sampleFrames?: number; timestamps?: "word" | "segment" }
function headers(token?: string): Record<string, string> {
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
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
export async function healthAsr(port: number, config: Pick<AsrConfiguration, "model" | "device" | "compute" | "batchSize">, signal: AbortSignal = AbortSignal.timeout(10_000), token?: string): Promise<AsrHealth> {
  const value = await requestJson(`http://127.0.0.1:${port}/health`, { signal, headers: headers(token) }, 64 * 1024);
  if (!record(value) || value.ok !== true || value.protocol !== ASR_PROTOCOL || value.serviceVersion !== ASR_SERVICE_VERSION || value.whisperxVersion !== WHISPERX_VERSION || value.model !== config.model || value.device !== config.device || value.compute !== config.compute || value.batchSize !== config.batchSize) throw new DvError("ASR_CONFIG_MISMATCH", "ASR health does not match the expected protocol, versions or execution configuration.", { hint: "Stop the old ASR service and run dsivio-video setup asr." });
  if (value.busy !== undefined && typeof value.busy !== "boolean" || value.activeTaskId !== undefined && value.activeTaskId !== null && typeof value.activeTaskId !== "string") throw new DvError("ASR_RESPONSE_INVALID", "ASR health runtime status is invalid.");
  return { ok: true, protocol: ASR_PROTOCOL, serviceVersion: ASR_SERVICE_VERSION, whisperxVersion: WHISPERX_VERSION, model: config.model, device: config.device, compute: config.compute, batchSize: config.batchSize, ...(typeof value.busy === "boolean" ? { busy: value.busy } : {}), ...(value.activeTaskId === null || typeof value.activeTaskId === "string" ? { activeTaskId: value.activeTaskId } : {}) };
}
export async function shutdownAsr(port: number, config: Pick<AsrConfiguration, "model" | "device" | "compute" | "batchSize">, token?: string): Promise<void> {
  const signal = AbortSignal.timeout(10_000);
  await healthAsr(port, config, signal, token);
  const value = await requestJson(`http://127.0.0.1:${port}/shutdown`, { method: "POST", headers: headers(token), body: "{}", signal }, 64 * 1024);
  if (!record(value) || value.ok !== true) throw new DvError("ASR_RESPONSE_INVALID", "ASR did not acknowledge idle shutdown.");
}
export async function cancelAsr(port: number, taskId: string, token: string): Promise<"requested" | "too-late"> {
  const value = await requestJson(`http://127.0.0.1:${port}/cancel`, { method: "POST", headers: headers(token), body: JSON.stringify({ task_id: taskId }), signal: AbortSignal.timeout(10_000) }, 64 * 1024);
  if (!record(value) || value.taskId !== taskId || !["requested", "too-late"].includes(String(value.outcome))) throw new DvError("ASR_RESPONSE_INVALID", "ASR did not acknowledge cancellation.");
  return value.outcome as "requested" | "too-late";
}
export function parseAsrReply(value: unknown): AsrReply {
  if (!record(value) || typeof value.language !== "string" || (!Array.isArray(value.segments) && !Array.isArray(value.words))) throw new DvError("ASR_RESPONSE_INVALID", "ASR reply must contain language and segments or words.");
  const parseWord = (word: unknown): AsrWord => {
    if (!record(word) || (typeof word.text !== "string" && typeof word.word !== "string")) throw new DvError("ASR_RESPONSE_INVALID", "ASR word must contain text.");
    for (const key of ["start", "end", "score"]) if (word[key] !== undefined && (typeof word[key] !== "number" || !Number.isFinite(word[key]) || Number(word[key]) < 0)) throw new DvError("ASR_RESPONSE_INVALID", `ASR word ${key} must be finite and nonnegative.`);
    if (typeof word.start === "number" && typeof word.end === "number" && word.end < word.start) throw new DvError("ASR_RESPONSE_INVALID", "ASR word boundaries are reversed.");
    return { text: typeof word.text === "string" ? word.text : String(word.word), ...(typeof word.start === "number" ? { start: word.start } : {}), ...(typeof word.end === "number" ? { end: word.end } : {}), ...(typeof word.score === "number" ? { score: word.score } : {}) };
  };
  const segments = (Array.isArray(value.segments) ? value.segments : []).map((segment: unknown): AsrSegment => {
    if (!record(segment) || typeof segment.text !== "string" || (segment.words !== undefined && !Array.isArray(segment.words))) throw new DvError("ASR_RESPONSE_INVALID", "ASR segment must contain text and optional words.");
    for (const key of ["start", "end"]) if (segment[key] !== undefined && (typeof segment[key] !== "number" || !Number.isFinite(segment[key]) || Number(segment[key]) < 0)) throw new DvError("ASR_RESPONSE_INVALID", `ASR segment ${key} must be finite and nonnegative.`);
    if (typeof segment.start === "number" && typeof segment.end === "number" && segment.end < segment.start) throw new DvError("ASR_RESPONSE_INVALID", "ASR segment boundaries are reversed.");
    return { text: segment.text, words: Array.isArray(segment.words) ? segment.words.map(parseWord) : [], ...(typeof segment.start === "number" ? { start: segment.start } : {}), ...(typeof segment.end === "number" ? { end: segment.end } : {}) };
  });
  const reply: AsrReply = { language: value.language, segments, ...(Array.isArray(value.words) ? { words: value.words.map(parseWord) } : {}) };
  if (value.schema !== undefined) {
    if (value.schema !== "dsivio.media.transcript/1" || value.sampleRate !== 16000 || !Number.isSafeInteger(value.sampleFrames) || Number(value.sampleFrames) <= 0 || !record(value.engine)) throw new DvError("ASR_RESPONSE_INVALID", "ASR transcript evidence metadata is invalid.");
    const engine = value.engine;
    if (["backend", "model", "protocol"].some((key) => typeof engine[key] !== "string")) throw new DvError("ASR_RESPONSE_INVALID", "ASR transcript engine identity is invalid.");
    const localWhisperX = engine.backend === "local" && engine.protocol === ASR_PROTOCOL;
    for (const key of ["serviceVersion", "whisperxVersion"]) {
      if ((localWhisperX || engine[key] !== undefined) && typeof engine[key] !== "string") throw new DvError("ASR_RESPONSE_INVALID", "ASR transcript engine versions are invalid.");
    }
    reply.schema = value.schema;
    reply.sampleRate = 16000;
    reply.sampleFrames = Number(value.sampleFrames);
    reply.engine = value.engine as unknown as NonNullable<AsrReply["engine"]>;
  }
  return reply;
}
export async function transcribeAsr(port: number, config: Pick<AsrConfiguration, "model" | "device" | "compute" | "batchSize">, audioPath: string, language: string, timeoutMs = 600_000, abortSignal?: AbortSignal, options: AsrRequestOptions = {}): Promise<{ health: AsrHealth; reply: AsrReply }> {
  const signal = abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const health = await healthAsr(port, config, signal, options.token);
  const reply = parseAsrReply(await requestJson(`http://127.0.0.1:${port}/transcribe`, { method: "POST", headers: headers(options.token), body: JSON.stringify({ audio_path: audioPath, language, ...(options.taskId ? { task_id: options.taskId } : {}), ...(options.sampleFrames !== undefined ? { sample_frames: options.sampleFrames } : {}), ...(options.timestamps ? { timestamps: options.timestamps } : {}) }), signal }, 64 * 1024 * 1024));
  if (options.sampleFrames !== undefined && reply.sampleFrames !== options.sampleFrames) throw new DvError("ASR_RESPONSE_INVALID", "ASR evidence sample count does not match its input.");
  if (reply.language !== language) throw new DvError("ASR_RESPONSE_INVALID", "ASR evidence language does not match its input.");
  return { health, reply };
}
