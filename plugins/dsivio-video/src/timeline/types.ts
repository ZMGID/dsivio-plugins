import type { ResourceRef, TypeRef } from "../core/value.ts";
import type { Extent } from "../space/types.ts";

export const timelineTypes = {
  narrative: "dsivio-video/script@1#Narrative",
  segment: "dsivio-video/script@1#SegmentRef",
  selection: "dsivio-video/script@1#SelectionRef",
  moment: "dsivio-video/script@1#MomentRef",
  caption: "dsivio-video/script@1#CaptionDocument",
  clock: "dsivio-video/program@1#Clock",
  media: "dsivio-video/pipeline@1#SynchronizedMedia",
  take: "dsivio-video/align@1#SemanticTake",
  timeline: "dsivio-video/time@1#Timeline",
  instant: "dsivio-video/time@1#Instant",
  window: "dsivio-video/time@1#Window",
  placementPlan: "dsivio-video/time@1#PlacementPlan",
  endExpression: "dsivio-video/time@1#EndExpression",
  instantExpression: "dsivio-video/time@1#InstantExpression",
  windowExpression: "dsivio-video/time@1#WindowExpression",
  consumerKey: "dsivio-video/time@1#ConsumerKey",
  adjustment: "dsivio-video/align@1#Adjustment",
} as const satisfies Record<string, TypeRef>;

/** Safe integer numerator, positive safe integer denominator. Clock additionally requires numerator > 0. */
export type Rational = { numerator: number; denominator: number };
export type Clock = { fps: Rational };
/** Half-open boundaries. Frames, tokens and samples use the same shape, never the same domain. */
export type Bounds = { start: number; end: number };
export type AnchorPair = { start: string; end: string };
export type SegmentRef = {
  kind: "segment";
  storyKey: string;
  segmentKey: string;
  tokenBounds: Bounds;
  anchors: AnchorPair;
};
export type SelectionRef = {
  kind: "selection";
  storyKey: string;
  selectionKey: string;
  tokenBounds: Bounds;
  anchors: AnchorPair;
};
export type MomentRef = { kind: "moment"; storyKey: string; momentKey: string; anchorKey: string };
export type SemanticRef = SegmentRef | SelectionRef | MomentRef;
export type SpokenToken = {
  tokenKey: string;
  segmentKey: string;
  turnKey: string;
  speechText: string;
  matchText: string;
  anchors: AnchorPair;
};
export type Turn = { turnKey: string; segmentKey: string; role?: string; tokenBounds: Bounds };
export type Anchor = {
  anchorKey: string;
  owner: "story" | "segment" | "token";
  ownerKey: string;
  edge: "start" | "end";
};
export type CaptionUnit = {
  unitKey: string;
  text: string;
  /** Original separator before this unit; never infer CJK spaces. */
  separator: string;
  tokenBounds: Bounds;
  attributes: Record<string, string | number | boolean>;
};
/** A cue belongs to exactly one Turn; role is authored metadata, never inferred from speech. */
export type CaptionCue = { cueKey: string; segmentKey: string; turnKey: string; role?: string; unitKeys: string[] };
export type CaptionDocument = { storyKey: string; units: CaptionUnit[]; cues: CaptionCue[] };
export type Narrative = {
  storyKey: string;
  segments: SegmentRef[];
  turns: Turn[];
  tokens: SpokenToken[];
  /** Distinct identities even when their positions coincide. */
  anchors: Anchor[];
  storyAnchors: AnchorPair;
  selections: SelectionRef[];
  moments: MomentRef[];
  captions: CaptionDocument;
};

/** CFR picture and PCM s16 stereo 48 kHz sound share local zero and exactly totalFrames. */
export type SynchronizedMedia = {
  clock: Clock;
  totalFrames: number;
  picture?: { resource: ResourceRef; extent: Extent; alpha: "opaque" | "straight" };
  sound?: { resource: ResourceRef; totalSamples: number };
};
export type LocatedToken = { tokenKey: string; frames: Bounds };
export type SemanticTake = {
  storyKey: string;
  /** Narrative identities only; these have no positions in local anchorFrames. */
  storyAnchors: AnchorPair;
  segment: SegmentRef;
  media: SynchronizedMedia;
  tokens: LocatedToken[];
  /** Local integer frame boundaries; excludes story anchors. */
  anchorFrames: Record<string, number>;
};
export type Placement = { placementKey: string; take: SemanticTake; offsetFrames: number };
/** Static metadata, paired by declaration index with the producer's typed takes[] input. `timelineKey` is the author identity (file + element id) that axisKey hashes. */
export type PlacementPlan = { timelineKey: string; placements: { placementKey: string; at?: string }[] };
export type EndExpression = string;
export type Adjustment = { storyKey: string; edits: { anchorKey: string; localFrame: number }[] };
export type Timeline = {
  axisKey: string;
  clock: Clock;
  totalFrames: number;
  /** Both absent for an explicitly timed, take-less program. */
  storyKey?: string;
  storyAnchors?: AnchorPair;
  /** Author declaration order, not chronological order. */
  placements: Placement[];
};

export type TimeLiteral = `${number}f` | `${number}ms` | `${number}s`;
/** Lexical validation further restricts decimal/exponent/sign syntax; see phase3 §3. */
export type PointExpression = string;
export type InstantExpression =
  | { kind: "at"; source: TimeLiteral | MomentRef }
  | { kind: "at-boundary"; source: SegmentRef | SelectionRef; boundary: "start" | "end" }
  | { kind: "expression"; expression: PointExpression; source?: SemanticRef };
export type InstantOrigin =
  | { kind: "absolute" }
  | { kind: "program"; edge: "start" | "end" }
  | { kind: "semantic"; reference: SegmentRef | SelectionRef; edge: "start" | "end" }
  | { kind: "semantic"; reference: MomentRef; edge: "cue" };
export type EditAuthority = "none" | "semantic-anchor" | "local-offset" | "duration";
export type Instant = {
  axisKey: string;
  consumerKey: string;
  origin: InstantOrigin;
  expression: PointExpression;
  editAuthority: EditAuthority;
  frame: number;
};
export type Window = { axisKey: string; consumerKey: string; leading: Instant; trailing: Instant; frames: Bounds };
export type WindowExpression =
  | { kind: "during"; source: "program" | SegmentRef | SelectionRef }
  /** expression retains an authored local offset; boundary is used only by direct range refs. */
  | { kind: "at"; source: TimeLiteral | SemanticRef | "program"; duration: TimeLiteral; expression?: PointExpression; boundary?: "start" | "end" }
  | { kind: "until"; source: TimeLiteral | SemanticRef | "program"; duration: TimeLiteral; expression?: PointExpression; boundary?: "start" | "end" }
  | { kind: "edges"; start: PointExpression; end: PointExpression; startSource?: SemanticRef; endSource?: SemanticRef };

/** Round half up once, using exact rational arithmetic; output must remain a safe integer. */
export type FrameToSampleBoundary = (frameBoundary: number, clock: Clock) => number;
export const MASTER_SAMPLE_RATE = 48_000;
export const EVIDENCE_SAMPLE_RATE = 16_000;
