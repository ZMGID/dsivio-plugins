import { DvError } from "../../core/errors.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import type { StickerItem, StickerProgram, StickerStyle } from "./types.ts";
import { validateStickerProgram } from "./validate.ts";
export function assembleStickerProgram(trackKey: string, timeline: Timeline, canvas: Canvas, items: StickerItem[], frames: Frame[], windows: Window[], styles: StickerStyle[]): StickerProgram {
  if ([frames.length, windows.length, styles.length].some(length => length !== items.length)) throw new DvError("STICKER_INPUT", "Sticker inputs must have matching lengths.");
  const program = { trackKey, timeline, canvas, stickers: items.map((item, index) => ({ ...item, frame: frames[index]!, window: windows[index]!, style: styles[index]! })) };
  validateStickerProgram(program); return program;
}
