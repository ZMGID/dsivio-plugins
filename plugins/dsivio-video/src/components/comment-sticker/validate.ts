import { DvError } from "../../core/errors.ts";
import { validateFontStack } from "../../fonts/validate.ts";
import { validateCanvas, validateFrame } from "../../space/validate.ts";
import { validateTimeline, validateWindow } from "../../timeline/validate.ts";
import { identity, object } from "../sound/validate.ts";
import { checkedProperties, image } from "./shared.ts";
import type { Rule } from "./shared.ts";
import type { StickerItem, StickerProgram, StickerStyle } from "./types.ts";
export const stickerRules: Record<string, Rule> = {
  "stack-order": { value: 62, integer: true }, background: { value: "#ffffff", color: true }, "border-color": { value: "#0000000e", color: true },
  "border-width": { value: 1, min: 0 }, radius: { value: 28, min: 0 }, "padding-x": { value: 28, min: 0 }, "padding-y": { value: 24, min: 0 }, gap: { value: 18, min: 0 }, rotation: { value: -2.5 },
  "shadow-color": { value: "#0000004d", color: true }, "shadow-x": { value: 0 }, "shadow-y": { value: 18 }, "shadow-blur": { value: 46, min: 0 }, "shadow-spread": { value: 0 },
  tail: { value: true }, "tail-width": { value: 42, min: 0 }, "tail-height": { value: 28, min: 0 }, "tail-offset-x": { value: 58 },
  "avatar-fallback": { value: "none", choices: ["none", "initial"] }, "avatar-size": { value: 58, min: Number.MIN_VALUE }, "avatar-border-width": { value: 3, min: 0 }, "avatar-border-color": { value: "#ffffff", color: true }, "avatar-background": { value: "#34313a", background: true }, "avatar-text-color": { value: "#ffffff", color: true },
  "header-size": { value: 24, min: Number.MIN_VALUE }, "header-weight": { value: 680, integer: true, min: 1, max: 1000 }, "header-line-height": { value: 1.15, min: Number.MIN_VALUE }, "header-color": { value: "#8f8f8f", color: true },
  "body-size": { value: 42, min: Number.MIN_VALUE }, "body-weight": { value: 850, integer: true, min: 1, max: 1000 }, "body-line-height": { value: 1.16, min: Number.MIN_VALUE }, "body-color": { value: "#111111", color: true }, "body-max-lines": { value: 3, min: 1, integer: true },
  "meta-size": { value: 21, min: Number.MIN_VALUE }, "meta-weight": { value: 650, integer: true, min: 1, max: 1000 }, "meta-line-height": { value: 1.15, min: Number.MIN_VALUE }, "meta-color": { value: "#8f8f8f", color: true },
  enter: { value: "pop", choices: ["none", "fade", "pop", "slide-pop"] }, "enter-frames": { value: 17, min: 0, integer: true }, "enter-offset-y": { value: -180 }, "enter-start-scale": { value: 0.78, min: Number.MIN_VALUE }, "enter-rotation-delta": { value: -4.5 }, "enter-easing": { value: "ease-out", choices: ["linear", "ease-in", "ease-out", "ease-in-out", "out-back"] },
  exit: { value: "fade-up", choices: ["none", "fade", "fade-up"] }, "exit-frames": { value: 20, min: 0, integer: true }, "exit-offset-y": { value: -28 }, "exit-easing": { value: "ease-in", choices: ["linear", "ease-in", "ease-out", "ease-in-out"] },
  hold: { value: "float", choices: ["none", "float"] }, "hold-amplitude-y": { value: 4, min: 0 }, "hold-rotation-amplitude": { value: 0.35 }, "hold-period-frames": { value: 84, min: 1, integer: true },
};
export function validateStickerStyle(data: unknown): asserts data is StickerStyle {
  const style = object(data, ["styleKey", "properties", "fonts"]); identity(style.styleKey); checkedProperties(style.properties, stickerRules); validateFontStack(style.fonts);
}
export function validateStickerItem(data: unknown): asserts data is StickerItem {
  const item = object(data, ["itemKey", "comment"], ["author", "header", "meta", "avatar"]); identity(item.itemKey); identity(item.comment);
  for (const key of ["author", "header", "meta"]) if (item[key] !== undefined) identity(item[key]);
  if (item.avatar !== undefined) image(item.avatar);
}
export function validateStickerProgram(data: unknown): asserts data is StickerProgram {
  const program = object(data, ["trackKey", "timeline", "canvas", "stickers"]); identity(program.trackKey); validateTimeline(program.timeline); validateCanvas(program.canvas);
  if (!Array.isArray(program.stickers) || !program.stickers.length) throw new DvError("STICKER_ITEMS", "A Track requires at least one Sticker.");
  const ids = new Set<string>();
  for (const entry of program.stickers) {
    const item = object(entry, ["itemKey", "comment", "frame", "window", "style"], ["author", "header", "meta", "avatar"]);
    const { frame, window, style, ...content } = item; validateStickerItem(content); validateFrame(frame); validateWindow(window); validateStickerStyle(style);
    if (ids.has(content.itemKey) || frame.canvasKey !== program.canvas.canvasKey || window.axisKey !== program.timeline.axisKey || window.consumerKey !== content.itemKey || window.frames.end > program.timeline.totalFrames) throw new DvError("STICKER_DOMAIN", "Sticker identities, frames and windows must match the Track domain.");
    ids.add(content.itemKey);
  }
}
