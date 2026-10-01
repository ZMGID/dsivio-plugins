import type { Json, ResourceRef, TypeRef } from "../core/value.ts";
import type { FontStack } from "../fonts/types.ts";
import type { Extent, Path } from "../space/types.ts";
import type { Bounds, Clock, Rational } from "../timeline/types.ts";

export const VISUAL_IR_VERSION = "dsivio-video.visual/1";
export const BROWSER_PROGRAM_VERSION = "dsivio-video.browser-program/1";
export const renderTypes = {
  visual: "dsivio-video/visual@1#VisualTrack",
  audio: "dsivio-video/visual@1#AudioTrack",
  surface: "dsivio-video/visual@1#Surface",
  composition: "dsivio-video/film@1#Composition",
  document: "dsivio-video/render@1#RenderDocument",
  silentVideo: "dsivio-video/render@1#SilentVideo",
  mixedAudio: "dsivio-video/render@1#MixedAudio",
  finalVideo: "dsivio-video/render@1#FinalVideo",
  frames: "dsivio-video/render@1#CapturedFrames",
  range: "dsivio-video/render@1#FrameRange",
  quality: "dsivio-video/render@1#Quality",
} as const satisfies Record<string, TypeRef>;

/** Closed CSS vocabulary. Values are validated; resource-bearing CSS functions are forbidden. */
export const STYLE_PROPERTIES = [
  "position", "left", "top", "right", "bottom", "width", "height", "min-width", "max-width", "min-height", "max-height",
  "display", "box-sizing", "overflow", "overflow-x", "overflow-y", "padding", "margin", "gap", "row-gap", "column-gap",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "justify-content", "align-items", "align-self", "align-content",
  "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-column", "grid-row",
  "background-color", "background-image", "border", "border-color", "border-style", "border-width", "border-radius", "box-shadow",
  "opacity", "transform", "transform-origin", "filter", "backdrop-filter", "clip-path", "mix-blend-mode", "isolation",
  "object-fit", "object-position", "color", "text-align", "white-space", "writing-mode", "direction", "vertical-align",
] as const;
export type StyleProperty = typeof STYLE_PROPERTIES[number];
export type StyleDeclaration = { property: StyleProperty; value: string };
export type AnimatedProperty = "opacity" | "transform" | "filter" | "backdrop-filter" | "clip-path";
export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type Keyframe = {
  /** Present-local frame offset, strictly increasing; may exceed its lifetime. */
  offsetFrames: number;
  easing: Easing;
  declarations: { property: AnimatedProperty; value: string }[];
};
export type HtmlAttribute = { name: `data-${string}` | `aria-${string}` | "role" | "title" | "lang" | "dir"; value: string };
export type VideoSamplePiece = {
  /** Target frame boundaries relative to Present start; gaps mean no image. */
  target: Bounds;
  sourceStart: Rational;
  sourceStep: Rational;
  /** Phase is relative to loop start; sourceStart must equal loop start + phase. Wrap before flooring. */
  loop?: { sourceFrames: Bounds; phase: Rational };
};
export type VideoSamplingMap = { sourceClock: Clock; sourceTotalFrames: number; pieces: VideoSamplePiece[] };
/** Terminal path coordinates are node-local; the component subtracts the spatial origin exactly once. */
export type TextPath = Omit<Path, "canvasKey">;
export type Surface = {
  resource: ResourceRef;
  extent: Extent;
  alpha: "opaque" | "straight";
  color: "srgb-sdr";
  timing: { kind: "still" } | { kind: "frames"; clock: Clock; totalFrames: number };
};
export type GradientStop = { offset: number; color: string; opacity: number };
export type Ink =
  | { kind: "solid"; color: string }
  | { kind: "linear"; angleDegrees: number; stops: GradientStop[] }
  | { kind: "radial"; centerX: number; centerY: number; stops: GradientStop[] };
export type Paint =
  | { kind: "fill"; ink: Ink }
  | { kind: "stroke"; ink: Ink; widthPx: number; placement: "inside" | "center" | "outside" }
  | { kind: "shadow"; ink: Ink; xPx: number; yPx: number; blurPx: number; spreadPx: number }
  | { kind: "glow"; ink: Ink; blurPx: number; spreadPx: number }
  | {
      kind: "box"; ink: Ink; target: "frame" | "content" | "paragraph" | "line" | "run" | "word" | "grapheme";
      continuity: "isolated" | "joined"; paddingPx: [number, number, number, number]; radiusPx: [number, number, number, number];
      border?: { ink: Ink; widthPx: [number, number, number, number]; style: "solid" | "dashed" | "dotted" };
      shadows: { color: string; xPx: number; yPx: number; blurPx: number; spreadPx: number }[];
      tail?: { side: "top" | "right" | "bottom" | "left"; offsetPx: number; widthPx: number; heightPx: number; color: string };
    };
export type Decoration = { line: "underline" | "overline" | "line-through"; ink: Ink; style: "solid" | "double" | "dotted" | "dashed" | "wavy"; thicknessPx?: number; offsetPx?: number; skipInk: boolean };
export type TextFormat = {
  fonts: FontStack;
  sizePx: number;
  lineHeight: number;
  trackingPx: number;
  wordSpacingPx: number;
  axes: { tag: string; value: number }[];
  features: { tag: string; enabled: boolean }[];
  language?: string;
  direction: "auto" | "ltr" | "rtl";
  writingMode: "horizontal-tb" | "vertical-rl" | "vertical-lr";
  kerning: "auto" | "normal" | "none";
  synthesis: "none" | "weight" | "style" | "weight-style";
  baselineShiftPx: number;
  verticalAlign: "baseline" | "super" | "sub";
  tabSize: number;
  indentPx: number;
  paragraphBeforePx: number;
  paragraphAfterPx: number;
  transform: "none" | "uppercase" | "lowercase" | "capitalize";
  caps: "normal" | "small-caps" | "all-small-caps";
  cjkSpacing: "normal" | "none";
  punctuationTrim: "none" | "start" | "end" | "adjacent" | "all";
  paints: Paint[];
  decorations: Decoration[];
};
export type TextRun = { kind: "run"; runKey: string; text: string; format?: TextFormat } | { kind: "break" };
export type TextParagraph = { paragraphKey: string; format?: TextFormat; runs: TextRun[] };
export type TextLayout = {
  mode: "point" | "area";
  inlineSize: "hug" | "fixed";
  blockSize: "hug" | "fixed";
  align: "start" | "center" | "end" | "justify";
  blockAlign: "start" | "center" | "end";
  paddingPx: [number, number, number, number];
  wrap: "none" | "word" | "grapheme";
  overflow: "visible" | "clip" | "ellipsis" | "shrink";
  columns: number;
  columnGapPx: number;
  maxLines?: number;
  minimumScale?: number;
  metricEdge: "line-box" | "cap-height" | "ink";
  pointAnchor: { inline: "start" | "center" | "end"; block: "start" | "center" | "end" };
  clip: boolean;
};
export type UnitAnimation = {
  sequenceKey: string;
  unit: "paragraph" | "line" | "run" | "word" | "grapheme";
  units: Bounds;
  startFrame: number;
  durationFrames: number;
  staggerFrames: number;
  cycles: number;
  order: "forward" | "reverse" | "random";
  seed?: number;
  /** Keyframe offsets are normalized unit progress, not frame offsets. */
  poses: { progress: number; easing: Easing; declarations: { property: AnimatedProperty | "color"; value: string }[] }[];
};
export type TextFlow = { paragraphs: TextParagraph[]; format: TextFormat; layout: TextLayout; sequences: UnitAnimation[] };
/** Trusted built-in component code, not a sandbox or public arbitrary-JS import. */
export type BrowserProgram = {
  format: typeof BROWSER_PROGRAM_VERSION;
  html: string;
  css: string;
  /** Function body: (root, data) -> synchronous draw(localFrame). Empty means static. */
  setup: string;
  data: Json;
  resources: ResourceRef[];
};
export type NodeBase = {
  nodeKey: string;
  parentKey: string | null;
  /** Unique across this Present, not merely among siblings. */
  order: number;
  style: StyleDeclaration[];
  keyframes: Keyframe[];
  attributes: HtmlAttribute[];
};
export type VisualNode = NodeBase & (
  | { kind: "box" }
  | { kind: "image"; resource: ResourceRef }
  | { kind: "video"; resource: ResourceRef; sampling?: VideoSamplingMap }
  | { kind: "surface"; surface: Surface; sampling?: VideoSamplingMap }
  | { kind: "text"; text: string; format: TextFormat }
  | { kind: "text-flow"; flow: TextFlow }
  | { kind: "path-text"; flow: TextFlow; path: TextPath; side: "left" | "right"; orientation: "follow" | "upright"; startMarginPx: number; endMarginPx: number; reverse: boolean; align: "start" | "center" | "end"; overflow: "visible" | "clip"; marginKeys: { offsetFrames: number; marginPx: number; easing: Easing }[] }
  | { kind: "mask"; mode: "alpha" | "luminance"; maskRootKey: string; contentRootKey: string }
  | { kind: "program"; program: BrowserProgram }
);
export type Present = {
  presentKey: string;
  axisKey: string;
  lifetime: Bounds;
  /** Absent means the entire lifetime; [] means always hidden. No clock reset. */
  visible?: Bounds[];
  layer: number;
  layerKey: string;
  rootKey: string;
  nodes: VisualNode[];
};
export type VisualTrack = { kind: "visual"; trackKey: string; axisKey: string; presents: Present[] };
export type GainPoint = { sample: number; gain: number };
export type AudioClip = {
  clipKey: string;
  source: ResourceRef;
  sourceTotalSamples: number;
  sourceSamples: Bounds;
  targetSamples: Bounds;
  loop?: { phaseSamples: number };
  speed: Rational;
  preservePitch: true;
  gain: number;
  fadeInSamples: number;
  fadeOutSamples: number;
  /** Global program samples; linear interpolation. No points means multiplier 1. */
  gainCurve: GainPoint[];
  /** Absent means all targetSamples; [] means silence. Does not reset source phase. */
  audible?: Bounds[];
};
export type AudioTrack = { kind: "audio"; trackKey: string; axisKey: string; clips: AudioClip[] };
export type ProgramDomain = { axisKey: string; clock: Clock; totalFrames: number; totalSamples48k: number };
export type Composition = {
  compositionKey: string;
  domain: ProgramDomain;
  canvasKey: string;
  extent: Extent;
  background: string;
  visualTracks: VisualTrack[];
  audioTracks: AudioTrack[];
};
export type ResourceUsage = { resource: ResourceRef; required: "global" } | { resource: ResourceRef; required: "windows"; frames: Bounds[] };
export type RenderDocument = {
  version: typeof VISUAL_IR_VERSION;
  compositionKey: string;
  domain: ProgramDomain;
  extent: Extent;
  resources: ResourceUsage[];
  surfaces: Surface[];
  html: string;
};
