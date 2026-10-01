import type { Timeline, Window, SynchronizedMedia } from "../../timeline/types.ts";
export const audioTrackTypes = { plan: "dsivio-video/audio-track@1#Plan", program: "dsivio-video/audio-track@1#Program" } as const;
export type AudioPlayback = "once" | "once-start" | "once-end" | "loop" | "loop-start" | "loop-end" | "stretch";
export type AudioItemPlan = { itemKey: string; sourceIndex: number; windowIndex: number; playback: AudioPlayback; gain: number; trimStart: string; trimEnd?: string; fadeIn: string; fadeOut: string; minRate?: number; maxRate?: number };
export type AudioPlan = { trackKey: string; items: AudioItemPlan[] };
export type AudioProgram = { trackKey: string; timeline: Timeline; items: { plan: AudioItemPlan; source: SynchronizedMedia; window: Window }[] };
