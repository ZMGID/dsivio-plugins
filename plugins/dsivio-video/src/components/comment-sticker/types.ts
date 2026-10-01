import type { Json, ResourceRef } from "../../core/value.ts";
import type { FontStack } from "../../fonts/types.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
export const stickerTypes = { style: "dsivio-video/comment-sticker@1#Style", item: "dsivio-video/comment-sticker@1#Item", program: "dsivio-video/comment-sticker@1#Program" } as const;
export type StickerStyle = { styleKey: string; properties: Record<string, Json>; fonts: FontStack };
export type StickerItem = { itemKey: string; comment: string; author?: string; header?: string; meta?: string; avatar?: ResourceRef };
export type StickerProgram = { trackKey: string; timeline: Timeline; canvas: Canvas; stickers: (StickerItem & { frame: Frame; window: Window; style: StickerStyle })[] };
