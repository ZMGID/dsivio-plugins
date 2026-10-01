import type { TypeRef } from "../core/value.ts";

export const spaceTypes = {
  canvas: "dsivio-video/space@1#Canvas",
  frame: "dsivio-video/space@1#Frame",
  extent: "dsivio-video/space@1#Extent",
  point: "dsivio-video/space@1#Point",
  path: "dsivio-video/space@1#Path",
} as const satisfies Record<string, TypeRef>;

export type Extent = { widthPx: number; heightPx: number };
export type Rect = Extent & { xPx: number; yPx: number };
export type Canvas = { canvasKey: string; extent: Extent };
/** Accumulated Canvas coordinates, not parent-relative CSS coordinates. Does not imply clipping. */
export type Frame = { canvasKey: string; rect: Rect };
export type Length = { unit: "px" | "%"; value: number };
export type FrameEdges = { left: Length; top: Length; right: Length; bottom: Length };
export type AnchorName = "top-left" | "top-center" | "top-right" | "center-left" | "center" | "center-right" | "bottom-left" | "bottom-center" | "bottom-right";
export type AnchorPoint = { x: number; y: number };
export type AnchoredFrameSpec = {
  x: Length; y: Length; width: Length; height: Length;
  anchor: AnchorName; offsetXPx: number; offsetYPx: number;
};
export type AspectFrameSpec = {
  x: Length; y: Length; anchor: AnchorName; offsetXPx: number; offsetYPx: number;
  aspect: number | Extent;
} & ({ width: Length; height?: never } | { height: Length; width?: never });
export type ContentFitMode = "contain" | "cover" | "fit-width" | "fit-height" | "native" | "scale-down" | "stretch";
export type ContentFit = {
  mode?: ContentFitMode;
  frameAnchor?: AnchorPoint;
  contentAnchor?: AnchorPoint;
  offsetXPx?: number;
  offsetYPx?: number;
  limit?: "bounded" | "free";
};
export type Point = { canvasKey: string; xPx: number; yPx: number; anchor: AnchorPoint };
export type PathPoint = { xPx: number; yPx: number };
export type PathSegment =
  | { kind: "line"; to: PathPoint }
  | { kind: "quadratic"; control: PathPoint; to: PathPoint }
  | { kind: "cubic"; control1: PathPoint; control2: PathPoint; to: PathPoint };
export type Path = { canvasKey: string; start: PathPoint; segments: PathSegment[] };
