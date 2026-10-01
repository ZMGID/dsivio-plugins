import type { ResourceRef, TypeRef } from "../core/value.ts";
import type { Extent } from "../space/types.ts";
import type { Bounds, Clock, Rational, SynchronizedMedia } from "../timeline/types.ts";

export const pipelineTypes = {
  inspection: "dsivio-video/pipeline@1#Inspection",
  selection: "dsivio-video/pipeline@1#StreamSelection",
  transform: "dsivio-video/pipeline@1#TransformPlan",
  policy: "dsivio-video/pipeline@1#StreamPolicy",
  audioOptions: "dsivio-video/pipeline@1#ExtractAudioOptions",
  frameOptions: "dsivio-video/pipeline@1#ExtractFrameOptions",
  frameCount: "dsivio-video/pipeline@1#FrameCount",
  audio: "dsivio-video/pipeline@1#NormalizedAudio",
  speechAudio: "dsivio-video/align@1#SpeechAudio",
  evidence: "dsivio-video/align@1#Evidence",
} as const satisfies Record<string, TypeRef>;
export type StreamTiming = { startSeconds: Rational; durationSeconds: Rational };
export type InspectedStream = {
  streamIndex: number;
  kind: "video" | "audio" | "other";
  codec: string;
  default: boolean;
  attachedPicture: boolean;
  timing?: StreamTiming;
  picture?: { extent: Extent; fps: Rational; moving: boolean; alpha: boolean; rotationDegrees: number; pixelAspect: Rational };
  sound?: { sampleRate: number; channels: number; totalSamples?: number };
};
export type Inspection = { source: ResourceRef; streams: InspectedStream[] };
export type VideoPolicy = "primary-moving" | "none" | `stream:${number}`;
export type AudioPolicy = "default" | "none" | `stream:${number}`;
export type StreamPolicy = { video: VideoPolicy; audio: AudioPolicy; spanAuthority: "video" | "audio" };
/** Selected by a pure producer from Inspection + StreamPolicy; no guessing in the executor. */
export type StreamSelection = { inspection: Inspection; videoIndex?: number; audioIndex?: number; spanAuthority: "video" | "audio" };
export type NormalizeRequest = { selection: StreamSelection; clock: Clock };
export type MediaTransform =
  /** `end` absent = the end of the previous step's result. The transform producer resolves it, so requests always carry `end`. */
  | { kind: "trim"; frames: { start: number; end?: number } }
  | { kind: "retime"; speed: Rational; preservePitch: true };
export type TransformPlan = { operations: MediaTransform[] };
export type TransformRequest = { media: SynchronizedMedia; plan: TransformPlan };
export type NormalizedAudio = { resource: ResourceRef; totalSamples: number };
export type ExtractAudioRequest = { source: ResourceRef; streamIndex: number };
export type ExtractFrameRequest = {
  source: ResourceRef;
  streamIndex: number;
  position: { kind: "first" } | { kind: "last" } | { kind: "frame"; index: number } | { kind: "seconds"; value: Rational };
};
export type ExtractAudioOptions = Omit<ExtractAudioRequest, "source">;
export type ExtractFrameOptions = Omit<ExtractFrameRequest, "source">;
export type StillVideoRequest = { image: ResourceRef; clock: Clock; totalFrames: number };
export type SpeechAudio = { resource: ResourceRef; totalSamples: number; sampleRate: 16000 };
export type SpeechAudioRequest = { sound: NormalizedAudio; totalSamples16k: number };
export type EvidenceWord = { text: string; samples?: Bounds; confidence?: number };
export type EvidenceCharacter = { wordIndex: number; text: string; samples?: Bounds; confidence?: number };
/** Internal evidence is lossless integer samples, never the phase-2 rounded transcript file. */
export type AlignmentEvidence = {
  sampleRate: 16000;
  totalSamples: number;
  language: string;
  engine: string;
  blocks: { words: EvidenceWord[]; characters: EvidenceCharacter[] }[];
  voiceRegions?: Bounds[];
};
export type AlignRequest = { audio: SpeechAudio; language: string };
