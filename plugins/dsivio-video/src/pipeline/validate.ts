import { DvError } from "../core/errors.ts";
import { frameToSample48k } from "../timeline/math.ts";
import type { ResourceRef } from "../core/value.ts";
import type { Clock, Rational, SynchronizedMedia } from "../timeline/types.ts";
import type { AlignmentEvidence, Inspection, StreamPolicy, StreamSelection, TransformPlan, NormalizedAudio, SpeechAudio, ExtractAudioOptions, ExtractFrameOptions } from "./types.ts";

export function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DvError("TYPE_INVALID", "Expected an object");
}
export function integer(value: unknown, name: string, minimum = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new DvError("TYPE_INVALID", `${name} must be a safe integer >= ${minimum}`);
}
export function finite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new DvError("TYPE_INVALID", `${name} must be finite`);
}
export function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new DvError("TYPE_INVALID", `${name} must be nonempty text`);
}
export function resource(value: unknown): asserts value is ResourceRef {
  object(value); text(value.$resource, "Resource id"); text(value.mime, "Resource MIME"); integer(value.bytes, "Resource bytes", 1);
}
export function rational(value: unknown, positive = false): asserts value is Rational {
  object(value); integer(value.denominator, "Denominator", 1);
  if (typeof value.numerator !== "number" || !Number.isSafeInteger(value.numerator) || (positive && value.numerator <= 0)) throw new DvError("TYPE_INVALID", "Invalid rational numerator");
}
export function clock(value: unknown): asserts value is Clock { object(value); rational(value.fps, true); }
export function validateAudio(value: unknown): asserts value is NormalizedAudio {
  object(value); resource(value.resource); integer(value.totalSamples, "Audio samples", 1);
  if (value.resource.mime !== "audio/wav") throw new DvError("TYPE_INVALID", "Normalized audio must be WAV");
}
export function validateSpeechAudio(value: unknown): asserts value is SpeechAudio {
  object(value); const sampleRate = value.sampleRate; validateAudio(value);
  if (sampleRate !== 16000) throw new DvError("TYPE_INVALID", "Speech audio must be 16 kHz");
}
export function validateMedia(value: unknown): asserts value is SynchronizedMedia {
  object(value); clock(value.clock); integer(value.totalFrames, "Media frames", 1);
  if (!value.picture && !value.sound) throw new DvError("TYPE_INVALID", "Synchronized media needs picture or sound");
  if (value.picture !== undefined) {
    object(value.picture); resource(value.picture.resource); object(value.picture.extent);
    for (const key of ["widthPx", "heightPx"]) { finite(value.picture.extent[key], key); if (value.picture.extent[key] <= 0) throw new DvError("TYPE_INVALID", "Picture dimensions must be positive"); }
    if (value.picture.alpha !== "opaque" && value.picture.alpha !== "straight") throw new DvError("TYPE_INVALID", "Invalid picture alpha");
  }
  if (value.sound !== undefined) { validateAudio(value.sound); if (value.sound.totalSamples !== frameToSample48k(value.totalFrames, value.clock)) throw new DvError("TYPE_INVALID", "Sound samples disagree with media clock"); }
}
export function validateInspection(value: unknown): asserts value is Inspection {
  object(value); resource(value.source);
  if (!Array.isArray(value.streams)) throw new DvError("TYPE_INVALID", "Inspection streams must be an array");
  const seen = new Set<number>();
  for (const stream of value.streams) {
    object(stream); integer(stream.streamIndex, "Stream index"); text(stream.codec, "Codec");
    if (seen.has(stream.streamIndex)) throw new DvError("TYPE_INVALID", "Duplicate stream index"); seen.add(stream.streamIndex);
    if (!["video", "audio", "other"].includes(String(stream.kind)) || typeof stream.default !== "boolean" || typeof stream.attachedPicture !== "boolean") throw new DvError("TYPE_INVALID", "Invalid stream kind/disposition");
    if (stream.timing !== undefined) { object(stream.timing); rational(stream.timing.startSeconds); rational(stream.timing.durationSeconds, true); }
    if (stream.picture !== undefined) {
      object(stream.picture); object(stream.picture.extent); finite(stream.picture.extent.widthPx, "Width"); finite(stream.picture.extent.heightPx, "Height");
      if (stream.picture.extent.widthPx <= 0 || stream.picture.extent.heightPx <= 0) throw new DvError("TYPE_INVALID", "Invalid extent");
      rational(stream.picture.fps, true); rational(stream.picture.pixelAspect, true);
      if (typeof stream.picture.moving !== "boolean" || typeof stream.picture.alpha !== "boolean" || ![0, 90, 180, 270].includes(Number(stream.picture.rotationDegrees))) throw new DvError("TYPE_INVALID", "Invalid picture facts");
    }
    if (stream.sound !== undefined) { object(stream.sound); integer(stream.sound.sampleRate, "Sample rate", 1); integer(stream.sound.channels, "Channels", 1); if (stream.sound.totalSamples !== undefined) integer(stream.sound.totalSamples, "Samples", 1); }
  }
}
export function validatePolicy(value: unknown): asserts value is StreamPolicy {
  object(value);
  if (!(value.video === "none" || value.video === "primary-moving" || typeof value.video === "string" && /^stream:\d+$/.test(value.video)) || !(value.audio === "none" || value.audio === "default" || typeof value.audio === "string" && /^stream:\d+$/.test(value.audio)) || !["video", "audio"].includes(String(value.spanAuthority))) throw new DvError("STREAM_POLICY_INVALID", "Invalid stream policy");
}
export function validateSelection(value: unknown): asserts value is StreamSelection {
  object(value); validateInspection(value.inspection);
  if (value.videoIndex !== undefined) integer(value.videoIndex, "Video index");
  if (value.audioIndex !== undefined) integer(value.audioIndex, "Audio index");
  if (value.videoIndex === undefined && value.audioIndex === undefined || !["video", "audio"].includes(String(value.spanAuthority))) throw new DvError("STREAM_SELECTION_INVALID", "Invalid stream selection");
  if (value.videoIndex !== undefined && value.spanAuthority !== "video" || value.spanAuthority === "video" && value.videoIndex === undefined || value.spanAuthority === "audio" && value.audioIndex === undefined) throw new DvError("STREAM_AUTHORITY_INVALID", "Authority must be an enabled stream; pictures require video authority");
  for (const [key, kind] of [["videoIndex", "video"], ["audioIndex", "audio"]] as const) {
    if (value[key] === undefined) continue;
    const selected = value.inspection.streams.find(s => s.streamIndex === value[key]);
    if (!selected || selected.kind !== kind || !selected.timing || kind === "video" && (!selected.picture?.moving || selected.attachedPicture)) throw new DvError("STREAM_SELECTION_INVALID", `Invalid ${kind} stream ${String(value[key])}`);
  }
}
export function validateTransform(value: unknown): asserts value is TransformPlan {
  object(value); if (!Array.isArray(value.operations) || !value.operations.length) throw new DvError("TRANSFORM_INVALID", "Transform needs operations");
  for (const op of value.operations) {
    object(op);
    if (op.kind === "trim") { object(op.frames); integer(op.frames.start, "Trim start"); if (op.frames.end !== undefined) { integer(op.frames.end, "Trim end", 1); if (op.frames.end <= op.frames.start) throw new DvError("TRANSFORM_INVALID", "Trim must be nonempty"); } }
    else if (op.kind === "retime") { rational(op.speed, true); if (op.preservePitch !== true) throw new DvError("TRANSFORM_INVALID", "Retime must preserve pitch"); }
    else throw new DvError("TRANSFORM_INVALID", "Unknown operation");
  }
}
export function validateEvidence(value: unknown): asserts value is AlignmentEvidence {
  object(value); integer(value.totalSamples, "Evidence samples", 1); text(value.language, "Language"); text(value.engine, "Engine");
  if (value.sampleRate !== 16000 || !Array.isArray(value.blocks)) throw new DvError("EVIDENCE_INVALID", "Invalid evidence format");
  const totalSamples = value.totalSamples;
  const measurement = (item: unknown): void => {
    object(item); text(item.text, "Evidence text");
    if (item.samples !== undefined) { object(item.samples); integer(item.samples.start, "Sample start"); integer(item.samples.end, "Sample end"); if (item.samples.start > totalSamples || item.samples.end > totalSamples) throw new DvError("EVIDENCE_WINDOW", "Measurement exceeds audio domain"); }
    if (item.confidence !== undefined) finite(item.confidence, "Confidence");
  };
  for (const block of value.blocks) {
    object(block); if (!Array.isArray(block.words) || !Array.isArray(block.characters)) throw new DvError("EVIDENCE_INVALID", "Invalid evidence block");
    block.words.forEach(measurement);
    for (const char of block.characters) { measurement(char); object(char); integer(char.wordIndex, "Character word index"); if (char.wordIndex >= block.words.length) throw new DvError("EVIDENCE_CHAR_WORD", "Character points outside its block"); }
  }
  if (value.voiceRegions !== undefined) { if (!Array.isArray(value.voiceRegions)) throw new DvError("EVIDENCE_INVALID", "Invalid voice regions"); for (const b of value.voiceRegions) { object(b); integer(b.start, "Voice start"); integer(b.end, "Voice end"); if (b.start > value.totalSamples || b.end > value.totalSamples) throw new DvError("EVIDENCE_WINDOW", "Voice region exceeds audio domain"); } }
}
export function validateAudioOptions(value: unknown): asserts value is ExtractAudioOptions { object(value); integer(value.streamIndex, "Stream index"); }
export function validateFrameOptions(value: unknown): asserts value is ExtractFrameOptions {
  object(value); const position = value.position; object(position); validateAudioOptions(value);
  if (position.kind === "frame") integer(position.index, "Frame index");
  else if (position.kind === "seconds") { rational(position.value); if (position.value.numerator < 0) throw new DvError("TYPE_INVALID", "Seconds must be nonnegative"); }
  else if (position.kind !== "first" && position.kind !== "last") throw new DvError("TYPE_INVALID", "Invalid frame position");
}
export function language(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[a-z]{2,3}$/.test(value) || value === "auto" || value === "und") throw new DvError("SPEECH_LANGUAGE_INVALID", "Language must be an explicit lowercase two/three letter code"); }
