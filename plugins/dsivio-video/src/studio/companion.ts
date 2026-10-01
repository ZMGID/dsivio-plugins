import type { Json, ResourceRef, TypeRef, Value } from "../core/value.ts";
import type { AuthorGraph, InputSource } from "../core/graph.ts";
import type { SourceSpan } from "../core/errors.ts";
import type { AuthoringIndex } from "../core/authoring.ts";
import type { Timeline, Instant, Window } from "../timeline/types.ts";
import type { RenderDocument } from "../render/ir.ts";
import type { FieldSchema } from "./protocol.ts";

export interface SourceSlice { unit: string; span: SourceSpan; text?: string }
export interface SourcePatch { unit: string; start: number; end: number; expectedText: string; text: string }
export interface SourceBinding {
  ownerKey: string; sourceUnit: string; attribute?: string; path?: readonly (string | number)[];
  access: "read" | "write"; reference?: string; endpointKey?: string;
  groupMembers?: readonly string[];
  children?: { discriminator: string; variants: Readonly<Record<string, { tag: string; attributes: Readonly<Record<string, string>> }>> };
}
export interface TemporalAuthority {
  key: string; originKind: "semantic" | "parameter" | "fixed"; originKey: string; consumerPort: string;
  instant?: Instant; window?: Window; gestures: readonly ("move" | "trim-start" | "trim-end" | "reanchor")[];
  anchors?: readonly { anchorKey: string; frame: number }[]; binding?: SourceBinding;
  anchorKey?: string;
}
export interface StudioLane { key: string; title: string; height: number; order: number; parentLaneKey?: string }
export interface StudioBand { key: string; laneKey: string; title: string; height: number; order: number }
export interface StudioMaterial {
  key: string; kind: "image" | "video" | "audio" | "surface";
  resource?: ResourceRef; value?: Value; facts?: Readonly<Record<string, Json>>;
}
export interface StudioEntity {
  editorKey: string; authorKey: string; title: string; paintRank: number;
  intervals: readonly { start: number; end: number }[]; laneKey: string; bandKey?: string;
  text?: string; materials?: readonly string[]; sourceSlice?: SourceSlice; pictureParts: readonly string[];
  selectionGroup?: string; parameterOwners: readonly string[]; facts: Readonly<Record<string, Json>>;
  temporal: readonly TemporalAuthority[]; visibleIntervals?: readonly { start: number; end: number }[];
  semanticKind?: "segment" | "word" | "selection" | "moment";
  fieldGroupKeys?: readonly string[];
}
export interface FieldOption { value: Json; label: string }
export interface StudioField {
  fieldKey: string; ownerKey: string; label: string; widget: "text" | "number" | "boolean" | "select" | "color" | "list" | "record";
  schemaKey: string; authorValue: Json; displayScale?: number; units?: readonly string[];
  options?: readonly FieldOption[]; endpointKey?: string; binding?: SourceBinding; readonly?: boolean;
  schema?: FieldSchema;
}
export interface FieldGroup { key: string; ownerKey: string; domain: "Where" | "When" | "How"; pageKey: string; sectionKey: string; fields: readonly StudioField[] }
export interface ParameterOwner { key: string; authorKey: string; moduleId: string; surface: string; output: string; value: Value; bindings: readonly SourceBinding[] }
export interface ExecutionEdge { operation: string; port: string; index?: number; source: InputSource }
export interface CompanionInput {
  value: Value; type: TypeRef; moduleId: string; surface: string; output: string; outputKey: string;
  authorKey: string; authorGraph: AuthorGraph; authoring: AuthoringIndex; sourceSlice?: SourceSlice;
  values?: ReadonlyMap<string, Value>;
  provenance: { kind: "author" | "candidate"; candidate?: string; build?: string; output?: string };
  inputs: Readonly<Record<string, readonly Value[]>>; executionEdges: readonly ExecutionEdge[];
  supports: Readonly<Record<string, Value>>; timeline: Timeline; document: RenderDocument;
  fallback(): CompanionProjection;
}
export interface CompanionProjection {
  entities: readonly StudioEntity[]; lanes: readonly StudioLane[]; bands: readonly StudioBand[];
  materials: readonly StudioMaterial[]; fieldGroups: readonly FieldGroup[]; parameterOwners: readonly ParameterOwner[];
}
export interface SupportOutput { output: string; type: TypeRef }
export interface FilmFacet {
  composition: { output: string; type: TypeRef };
  timeline: { input: string; type: TypeRef };
  tracks: readonly { input: string; types: readonly TypeRef[]; kind: "visual" | "audio" }[];
}
export interface ScriptObservation {
  rows: readonly StudioEntity[]; anchors: readonly { anchorKey: string; frame?: number; sourceSlice?: SourceSlice }[];
}
export interface ScriptRewriteInput { text: string; sourceUnit: string; anchorKey: string; targetAnchorKey: string; timeline: Timeline }
export interface ScriptFacet {
  observe(input: CompanionInput): ScriptObservation;
  rewriteAnchor(input: ScriptRewriteInput): readonly SourcePatch[];
}
export interface StudioCompanion {
  protocol: "dsivio-video.studio-companion/1"; key: string; moduleId: string;
  matches: readonly { surface: string; output: string; type: TypeRef }[];
  family: string; icon: "audio" | "video" | "image" | "text" | "board" | "effect" | "film" | "script";
  tone: "neutral" | "blue" | "green" | "orange" | "purple"; supports?: readonly SupportOutput[];
  project(input: CompanionInput): CompanionProjection; film?: FilmFacet; script?: ScriptFacet;
}
