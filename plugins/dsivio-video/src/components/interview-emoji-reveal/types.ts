import type { Json, ResourceRef } from "../../core/value.ts";
import type { Canvas } from "../../space/types.ts";
import type { InstantExpression, Timeline, Window } from "../../timeline/types.ts";
export const emojiTypes = { style: "dsivio-video/interview-emoji-reveal@1#Style", plan: "dsivio-video/interview-emoji-reveal@1#Plan", program: "dsivio-video/interview-emoji-reveal@1#Program" } as const;
export type EmojiStyle = { styleKey: string; properties: Record<string, Json> };
export type EmojiPlan = { trackKey: string; items: { itemKey: string; preset: boolean; at?: InstantExpression }[] };
export type EmojiProgram = { trackKey: string; timeline: Timeline; canvas: Canvas; style: EmojiStyle; outer: Window; placeholder: ResourceRef; items: { itemKey: string; icon: ResourceRef; activationFrame?: number }[] };
