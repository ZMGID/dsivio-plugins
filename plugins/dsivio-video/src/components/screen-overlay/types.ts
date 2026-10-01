import type { TypeRef } from "../../core/value.ts";
import type { Canvas } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";

export const overlayTypes = {
  plan: "dsivio-video/screen-overlay@1#AuthorPlan",
  program: "dsivio-video/screen-overlay@1#Program",
} as const satisfies Record<string, TypeRef>;

export type OverlayOptions = {
  Flash: { color: string; intensity: number; attack: number; hold: number; decay: number };
  ColorWash: { color: string; opacity: number };
  Vignette: { "center-x": number; "center-y": number; "radius-x": number; "radius-y": number; softness: number; color: string; opacity: number };
  ScanLines: { spacing: number; thickness: number; angle: number; opacity: number; travel: number };
  DirectionalMatte: { angle: number; coverage: number; feather: number; color: string; opacity: number; from: number; to: number };
  WhipVeil: { direction: "left" | "right" | "up" | "down"; width: number; softness: number; travel: number; opacity: number };
  GlitchVeil: { bars: number; colors: string[]; opacity: number; travel: number; seed: number };
  Grain: { amount: number; size: number; chroma: "monochrome" | "color"; "motion-rate": number; seed: number };
  LightLeak: { colors: string[]; angle: number; softness: number; travel: number; intensity: number; seed: number };
  Bokeh: { amount: number; "min-size": number; "max-size": number; color: string; warmth: number; drift: number; seed: number };
  TVStatic: { amount: number; size: number; "scan-lines": number; "motion-rate": number; seed: number };
};
export type OverlayKind = keyof OverlayOptions;
export type OverlayEffect = { [K in OverlayKind]: { kind: K; options: OverlayOptions[K]; effectKey: string; z: number } }[OverlayKind];
export type OverlayAuthorPlan = { effects: (OverlayEffect & { windowIndex: number })[] };
export type OverlayProgram = { trackKey: string; canvas: Canvas; timeline: Timeline; effects: (OverlayEffect & { window: Window })[] };
