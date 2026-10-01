import type { TypeRef } from "../../core/value.ts";
import type { TextFormat } from "../../render/ir.ts";
import type { Bounds } from "../../timeline/types.ts";
import type { CaptionProgram } from "../caption/types.ts";
export const fineTypes = {
 program: "dsivio-video/caption-fine@1#Program", schedule: "dsivio-video/caption-fine@1#Schedule", regions: "dsivio-video/caption-fine@1#RegionTimeline",
} as const satisfies Record<string, TypeRef>;
export type FineRecipe = Record<string, string | number>;
export type FineStyle = { kind: "fine"; styleKey: string; recipe: FineRecipe; base: TextFormat; active: TextFormat };
/** Normalized canvas evidence; lowering uses terminal percentages because Track has no Canvas port. */
export type FractionRect = { x: number; y: number; width: number; height: number };
export type RegionTimeline = { axisKey: string; totalFrames: number; tracks: { role: string; frames: (FractionRect | null)[] }[] };
export type FineProgram = CaptionProgram & { regions?: RegionTimeline };
export type FineSchedule = { axisKey: string; items: { cueKey: string; useKey: string; lifetime: Bounds; visible: Bounds[] }[] };
