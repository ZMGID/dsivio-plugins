import type { TypeRef } from "../core/value.ts";
import type { Canvas, ContentFit, Frame, Path, Point } from "../space/types.ts";
import type { Timeline, Window } from "../timeline/types.ts";
import type { AnimatedProperty, Easing, Paint, StyleDeclaration, TextFlow, TextFormat, TextLayout, VisualNode } from "../render/ir.ts";

export const trackTypes = {
  soundStyle: "dsivio-video/sound@1#Style",
  soundProgram: "dsivio-video/sound@1#Program",
  performanceStyle: "dsivio-video/performance@1#Style",
  performanceProgram: "dsivio-video/performance@1#Program",
  typographyStyle: "dsivio-video/typo@1#Style",
  typographyMotion: "dsivio-video/typo@1#Motion",
  typographyProgram: "dsivio-video/typo@1#Program",
  soundPlan: "dsivio-video/sound@1#UsePlan",
  performancePlan: "dsivio-video/performance@1#UsePlan",
  typographyPlan: "dsivio-video/typo@1#AuthorPlan",
} as const satisfies Record<string, TypeRef>;

/** Static graph metadata. Indexes address separate, nominally typed producer list ports. */
export type UsePlan = { trackKey: string; uses: { useKey: string; windowIndex: number; styleIndex: number }[] };
export type TypographyAuthorPlan = {
  trackKey: string;
  items: {
    itemKey: string;
    windowIndex: number;
    styleIndex: number;
    motionIndex?: number;
    placement: { kind: "point" | "area" | "path"; index: number };
    content: { kind: "text"; textIndex: number } | {
      kind: "paragraphs";
      paragraphs: {
        paragraphKey: string;
        styleIndex?: number;
        runs: (
          | { kind: "break" }
          | { kind: "run"; runKey: string; text: string; styleIndex?: number; language?: string; direction?: "auto" | "ltr" | "rtl" }
        )[];
      }[];
    };
  }[];
};
export type SoundStyle = { styleKey: string; gain: number; endGain: number };
export type SoundProgram = {
  /** Identity of the terminal track this program lowers to (Film requires unique track keys). */
  trackKey: string;
  timeline: Timeline;
  /** Author order is last-Use-wins; zero gain still masks earlier uses. */
  uses: { useKey: string; window: Window; style: SoundStyle }[];
};
export type PerformanceStyle = {
  styleKey: string;
  frame: Frame;
  layer: number;
  fit: ContentFit;
  outerStyle: StyleDeclaration[];
  contentInsetPx: [number, number, number, number];
  framePaint?: Paint;
  clip: "none" | "frame" | "rounded";
  radiusPx: number;
};
export type PerformanceProgram = { trackKey: string; timeline: Timeline; canvas: Canvas; uses: { useKey: string; window: Window; style: PerformanceStyle }[] };
export type TypographyStyle = {
  styleKey: string; layer: number; format: TextFormat; layout: TextLayout; outerStyle: StyleDeclaration[];
  path: Pick<Extract<VisualNode, { kind: "path-text" }>, "side" | "orientation" | "startMarginPx" | "endMarginPx" | "reverse" | "align" | "overflow">;
};
export type TypographyMotion = {
  motionKey: string;
  itemKeys: { offsetFrames: number; easing: Easing; declarations: { property: AnimatedProperty | "color"; value: string }[] }[];
  pathKeys: { offsetFrames: number; marginPx: number; easing: Easing }[];
  sequences: TextFlow["sequences"];
};
export type TypographyProgram = {
  trackKey: string;
  timeline: Timeline;
  items: {
    itemKey: string;
    window: Window;
    placement: { kind: "point"; point: Point } | { kind: "area"; frame: Frame } | { kind: "path"; path: Path };
    style: TypographyStyle;
    motion?: TypographyMotion;
    content: TextFlow;
  }[];
};
