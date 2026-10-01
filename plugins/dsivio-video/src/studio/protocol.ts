import type { Json, ResourceRef } from "../core/value.ts";
import type { SourceSpan } from "../core/errors.ts";
import type { AudioTrack, RenderDocument } from "../render/ir.ts";
import type { Timeline } from "../timeline/types.ts";
import type { FieldGroup, ParameterOwner, StudioBand, StudioEntity, StudioLane, StudioMaterial } from "./companion.ts";

export type StudioProtocol = "dsivio-video.studio/1";
export interface SourceUnit { unit: string; fileName: string; language: "dvml" | "dvs" | "dvrun"; sourceVersion: string }
export interface StudioDiagnostic { code: string; message: string; span?: SourceSpan; viewRevision?: number }
export interface ViewRevision {
  protocol: StudioProtocol; sessionId: string; viewRevision: number; runFile: string; projectRoot: string;
  sourceUnits: readonly SourceUnit[]; clock: Timeline["clock"]; totalFrames: number;
  timeline: Timeline; document: RenderDocument; audioTracks: readonly AudioTrack[];
  lanes: readonly StudioLane[]; bands: readonly StudioBand[]; entities: readonly StudioEntity[];
  materials: readonly StudioMaterial[]; fieldGroups: readonly FieldGroup[]; parameterOwners: readonly ParameterOwner[];
  targets: readonly string[]; candidateCount: number;
  audioPlayback?: readonly { clipKey: string; resource: ResourceRef; totalSamples: number }[];
  fieldSchemas?: Readonly<Record<string, FieldSchema>>;
}
export interface StudioState {
  requestedRevision: number; publishedRevision: number; dirty: boolean;
  status: "compiling" | "ready" | "error"; view?: ViewRevision; error?: StudioDiagnostic;
  sourceUnits?: readonly SourceUnit[];
}
export interface Bootstrap { protocol: StudioProtocol; sessionId: string; token: string; locale: "en" | "zh-CN"; state: StudioState }
export interface SourceResponse { unit: string; fileName: string; text: string; sourceVersion: string; viewRevision: number }
export interface SourceEditRequest { unit: string; text: string; expectedSourceVersion: string; expectedViewRevision: number }
export interface FieldEditRequest { expectedViewRevision: number; editorKey: string; fieldKey: string; value: Json }
export interface TimeEditRequest { expectedViewRevision: number; editorKey: string; authorityKey: string; gesture: "move" | "trim-start" | "trim-end" | "reanchor"; targetFrame?: number; deltaFrames?: number; anchorKey?: string }
export interface StudioEvent { sessionId: string; viewRevision?: number; commentsRevision?: string; state?: StudioState }
export interface FeedbackComment { id: string; run: string; at: number; text: string; resolved?: boolean; [extension: string]: Json | undefined }
export interface CommentsList { schema: "dsivio-video.comments-list/1"; run: string; commentsRevision: string; comments: readonly NumberedComment[] }
export interface NumberedComment { id: string; run: string; at: number; text: string; resolved: boolean; number: number; expectedComment: FeedbackComment }
export interface CommentChanges { at?: number; text?: string; resolved?: boolean }
export interface TaskQuery { state?: "all" | "active" | "ended"; before?: string; limit?: number }
export interface ArtifactQuery { kind?: "all" | "video" | "image" | "audio"; build?: string; before?: string; limit?: number }
export interface TaskCard { id: string; state: string; runFile?: string; title?: string; error?: string; operations: readonly Json[]; result?: Json; [key: string]: Json | readonly Json[] | undefined }
export interface TasksPage { tasks: readonly TaskCard[]; before?: string }
export interface ArtifactSource { build: string; output: string; displayName: string; manifestVersion: string; outcome: string }
export interface ArtifactCard { key: string; kind: "image" | "video" | "audio"; resource: ResourceRef; owner: { build: string; output: string }; sources: readonly ArtifactSource[]; highlight?: boolean }
export interface ArtifactsPage { artifacts: readonly ArtifactCard[]; before?: string }
export interface RenameArtifactRequest { build: string; output: string; expectedManifestVersion: string; displayName: string }
export interface FieldSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  enum?: readonly Json[]; minimum?: number; maximum?: number; pattern?: string;
  items?: FieldSchema; minItems?: number; maxItems?: number;
  properties?: Readonly<Record<string, FieldSchema>>; required?: readonly string[]; additionalProperties?: boolean;
}
