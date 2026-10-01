import type { Json, TypeRef } from "../../core/value.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import type { Bounds, Instant, Timeline } from "../../timeline/types.ts";
import type { Easing, TextFlow } from "../../render/ir.ts";
import type { MediaAppearance, MediaMotion, MediaSource } from "../media-track/types.ts";

export const deckTypes = {
  label: "dsivio-video/deck-track@1#Label", source: "dsivio-video/deck-track@1#Source",
  plan: "dsivio-video/deck-track@1#Plan", program: "dsivio-video/deck-track@1#Program",
} as const satisfies Record<string, TypeRef>;
export type DeckLabel = { labelKey: string; flow: TextFlow };
export type DeckPose = { x: number; y: number; rotation: number; scale: number; opacity: number; stacking: number; brightness: number; contrast: number; saturation: number };
export type DeckStep = DeckPose & { rotationMode: "linear" | "alternate" };
export type DeckStyle = { visiblePrevious: number; visibleNext: number; wrap: boolean; current: DeckPose; previous: DeckStep; next: DeckStep; reflowFrames: number; reflowEasing: Easing; playbackFuture: "hold-head" | "continue"; playbackPast: "hold-tail" | "continue" | "hide" };
export type DeckPlan = { trackKey: string; appearance: Record<string, Json>; cards: { cardKey: string; appearance?: Record<string, Json>; labelIndex?: number }[] };
export type DeckCard = { cardKey: string; activation: Instant; source: MediaSource; appearance: MediaAppearance; depth: DeckStyle; motion: MediaMotion; label?: DeckLabel };
export type DeckProgram = { trackKey: string; timeline: Timeline; canvas: Canvas; frame: Frame; terminal: Instant; style: DeckStyle; cards: DeckCard[] };
export type DeckStage = { frames: Bounds; activeIndex: number; poses: Map<number, DeckPose> };
