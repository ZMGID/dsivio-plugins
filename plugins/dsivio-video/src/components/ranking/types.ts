import type { Json, ResourceRef } from "../../core/value.ts";
import type { TextFormat } from "../../render/ir.ts";
import type { Bounds, Instant, Timeline, Window } from "../../timeline/types.ts";
import type { Canvas, Frame, Rect } from "../../space/types.ts";
import type { SynchronizedMedia } from "../../timeline/types.ts";
export const RANKING_MODULE = "dsivio-video/ranking@1";
export const rankingTypes = {
  tierStyle: `${RANKING_MODULE}#TierBoardStyle`, columnStyle: `${RANKING_MODULE}#ColumnStyle`, topStyle: `${RANKING_MODULE}#TopThreeStyle`,
  sound: `${RANKING_MODULE}#SoundStyle`, plan: `${RANKING_MODULE}#AuthorPlan`, schedule: `${RANKING_MODULE}#Schedule`, program: `${RANKING_MODULE}#Program`, events: `${RANKING_MODULE}#Events`,
} as const;
export type RankingKind = "TierBoard" | "Column" | "TopThree";
export type SoundStyle = { appearGain: number; moveGain: number; fadeFrames: number };
export type RankingStyle = { kind: RankingKind; styleKey: string; properties: Record<string, Json>; format: TextFormat; sound: SoundStyle };
export type RankingAuthorItem = { itemKey: string; preset: boolean; tier?: string; rank?: number; label?: string; textIndex?: number; iconIndex?: number; windowIndex?: number; instantIndex?: number; entry?: "direct" | "drop"; stack?: number };
export type RankingAuthorPlan = { kind: RankingKind; trackKey: string; items: RankingAuthorItem[] };
export type RankingItem = { itemKey: string; preset: boolean; label?: string; tier?: string; rank?: number; icon?: ResourceRef; entry?: "direct" | "drop"; stack: number; target: Rect; reveal?: Window; activation?: Instant; active: Bounds; settled: Bounds | null; appearFrames: number; moveFrames: number; moveFrame?: number; slot: number };
export type RankingSchedule = { kind: RankingKind; trackKey: string; axisKey: string; outer: Window; items: RankingItem[] };
export type RankingProgram = { timeline: Timeline; frame: Frame; canvas?: Canvas; style: RankingStyle; schedule: RankingSchedule };
export type RankingEvents = { axisKey: string; trackKey: string; events: { eventKey: string; itemKey: string; kind: "appear" | "move"; frame: number }[] };
export type RankingSounds = { appear?: SynchronizedMedia; move?: SynchronizedMedia };
