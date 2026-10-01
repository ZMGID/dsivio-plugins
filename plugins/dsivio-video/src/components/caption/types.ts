import type { TypeRef } from "../../core/value.ts";
import type { Bounds, CaptionUnit, Timeline, Window } from "../../timeline/types.ts";
import type { FineStyle } from "../caption-fine/types.ts";
export const captionTypes = {
 style: "dsivio-video/caption@1#Style", content: "dsivio-video/caption@1#Content", uses: "dsivio-video/caption@1#Uses", plan: "dsivio-video/caption@1#UsePlan",
} as const satisfies Record<string, TypeRef>;
export type CaptionStyle = { kind: "hidden"; styleKey: string } | FineStyle;
export type TimedUnit = CaptionUnit & { frames: Bounds };
export type TimedCue = { cueKey: string; segmentKey: string; turnKey: string; role?: string; frames: Bounds; units: TimedUnit[] };
export type CaptionContent = { axisKey: string; storyKey: string; cues: TimedCue[] };
export type CaptionUse = { useKey: string; role?: string; window: Window; style: CaptionStyle };
export type CaptionUses = { axisKey: string; uses: CaptionUse[] };
export type CaptionUsePlan = { uses: { useKey: string; role?: string; windowIndex: number; styleIndex: number }[] };
export type CaptionProgram = { trackKey: string; timeline: Timeline; content: CaptionContent; uses: CaptionUse[] };
