import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import type { Json, Value } from "../core/value.ts";
import { isPending } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import { pipelineTypes } from "./types.ts";
import { timelineTypes } from "../timeline/types.ts";
import type { AlignmentEvidence, EvidenceWord } from "./types.ts";
import type { AsrReply } from "../asr/client.ts";
import { inspectMedia } from "./inspect.ts";
import { normalizeMedia, speechAudio } from "./normalize.ts";
import { transformMedia } from "./transform.ts";
import { extractAudio, extractFrame, stillVideo } from "./extract.ts";
import { object, resource, clock, integer, language, validateSelection, validateMedia, validateTransform, validateAudio, validateSpeechAudio, validateAudioOptions, validateFrameOptions, validateEvidence } from "./validate.ts";

export function evidenceFromReply(reply: AsrReply, totalSamples: number, requestedLanguage: string, engine: string): AlignmentEvidence {
  integer(totalSamples, "Evidence samples", 1); language(requestedLanguage);
  const adapt = (word: AsrReply["segments"][number]["words"][number]): EvidenceWord => {
    const start = word.start === undefined ? NaN : Math.round(word.start * 16000);
    const end = word.end === undefined ? NaN : Math.round(word.end * 16000);
    const valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end <= totalSamples;
    return { text: word.text, ...(valid ? { samples: { start, end } } : {}), ...(word.score !== undefined && Number.isFinite(word.score) && word.score >= 0 && word.score <= 1 ? { confidence: word.score } : {}) };
  };
  const segments = reply.segments.filter(s => s.words.length);
  const blocks = segments.length ? segments.map(s => ({ words: s.words.map(adapt), characters: [] })) : reply.words ? [{ words: reply.words.map(adapt), characters: [] }] : [];
  const evidence: AlignmentEvidence = { sampleRate: 16000, totalSamples, language: requestedLanguage, engine, blocks };
  validateEvidence(evidence); return evidence;
}
function hasPending(value: unknown): boolean {
  if (isPending(value)) return true;
  if (Array.isArray(value)) return value.some(hasPending);
  return value !== null && typeof value === "object" && Object.values(value).some(hasPending);
}
type Operation = "inspect" | "normalize" | "transform" | "extract-audio" | "extract-frame" | "still-video" | "speech-audio";
const returns: Record<Operation, string> = { inspect: pipelineTypes.inspection, normalize: timelineTypes.media, transform: timelineTypes.media, "extract-audio": pipelineTypes.audio, "extract-frame": "dsivio-video/media@1#Image", "still-video": "dsivio-video/media@1#Video", "speech-audio": pipelineTypes.speechAudio };
function validateRequest(kind: Operation, request: unknown, allowPending = false): void {
  object(request);
  const check = (value: unknown, validate: (value: unknown) => void): void => { if (!allowPending || !hasPending(value)) validate(value); };
  switch (kind) {
    case "inspect": check(request.source, resource); break;
    case "normalize": check(request.selection, validateSelection); check(request.clock, clock); break;
    case "transform": check(request.media, validateMedia); check(request.plan, validateTransform); break;
    case "extract-audio": check(request.source, resource); validateAudioOptions(request); break;
    case "extract-frame": check(request.source, resource); validateFrameOptions(request); break;
    case "still-video": check(request.image, resource); check(request.clock, clock); check(request.totalFrames, value => integer(value, "Frames", 1)); break;
    case "speech-audio": check(request.sound, validateAudio); check(request.totalSamples16k, value => integer(value, "Speech samples", 1)); break;
  }
}
async function execute(kind: Operation, raw: Json, ctx: ExecuteContext): Promise<Value> {
  validateRequest(kind, raw); object(raw); let data: unknown;
  switch (kind) {
    case "inspect": resource(raw.source); data = await inspectMedia(raw.source, ctx); break;
    case "normalize": validateSelection(raw.selection); clock(raw.clock); data = await normalizeMedia({ selection: raw.selection, clock: raw.clock }, ctx); break;
    case "transform": validateMedia(raw.media); validateTransform(raw.plan); data = await transformMedia({ media: raw.media, plan: raw.plan }, ctx); break;
    case "extract-audio": { const source = raw.source; resource(source); validateAudioOptions(raw); data = await extractAudio({ source, streamIndex: raw.streamIndex }, ctx); break; }
    case "extract-frame": { const source = raw.source; resource(source); validateFrameOptions(raw); data = await extractFrame({ source, streamIndex: raw.streamIndex, position: raw.position }, ctx); break; }
    case "still-video": resource(raw.image); clock(raw.clock); integer(raw.totalFrames, "Frames", 1); data = await stillVideo({ image: raw.image, clock: raw.clock, totalFrames: raw.totalFrames }, ctx); break;
    case "speech-audio": validateAudio(raw.sound); integer(raw.totalSamples16k, "Speech samples", 1); data = await speechAudio({ sound: raw.sound, totalSamples16k: raw.totalSamples16k }, ctx); break;
  }
  return { type: returns[kind], data: data as Json };
}
export const localCapabilities: CapabilityDef[] = (Object.keys(returns) as Operation[]).map(kind => ({
  name: `local/${kind}`, returns: returns[kind],
  async resolve(request) {
    try { validateRequest(kind, request, true); }
    catch (error) { if (error instanceof DvError) return { ok: false, code: error.code, reason: error.message }; throw error; }
    return { ok: true, request, backend: "local", summary: { operation: kind, pending: hasPending(request) }, cost: "local" };
  },
  executor: { kind: "immediate", run: (request, ctx) => execute(kind, request, ctx) },
}));
