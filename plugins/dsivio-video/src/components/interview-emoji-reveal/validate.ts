import { DvError } from "../../core/errors.ts";
import { validateCanvas } from "../../space/validate.ts";
import type { Canvas, Rect } from "../../space/types.ts";
import type { Json } from "../../core/value.ts";
import { fitContent } from "../../space/math.ts";
import { validateMomentRef, validateTimeline, validateWindow } from "../../timeline/validate.ts";
import { isTimeLiteral } from "../../timeline/temporal.ts";
import { finite, identity, integer, object } from "../sound/validate.ts";
import { checkedProperties, image } from "../comment-sticker/shared.ts";
import type { Rule } from "../comment-sticker/shared.ts";
import type { EmojiPlan, EmojiProgram, EmojiStyle } from "./types.ts";
export const emojiRules: Record<string, Rule> = {
  "center-x": { value: 0.5, min: 0, max: 1 }, "top-y": { value: 0.07, min: 0, max: 1 }, "slot-size": { value: 72, min: Number.MIN_VALUE }, "slot-gap": { value: 10, min: 0 }, "padding-x": { value: 18, min: 0 }, "padding-y": { value: 14, min: 0 },
  background: { value: "#FFFDF7", color: true }, "border-color": { value: "#161616", color: true }, "border-width": { value: 4, min: 0 }, radius: { value: 22, min: 0 }, "shadow-color": { value: "#000000B8", color: true }, "shadow-x": { value: 9 }, "shadow-y": { value: 10 }, "shadow-blur": { value: 0, min: 0 }, "shadow-spread": { value: 0 }, "icon-size": { value: 48, min: Number.MIN_VALUE }, "reveal-frames": { value: 6, min: 1, integer: true }, "stack-order": { value: 66, integer: true },
};
export function emojiStripRect(canvas: Canvas, properties: Record<string, Json>, count: number): Rect {
  const widthPx = 2 * Number(properties["padding-x"]) + count * Number(properties["slot-size"]) + (count - 1) * Number(properties["slot-gap"]);
  const heightPx = 2 * Number(properties["padding-y"]) + Number(properties["slot-size"]);
  return fitContent({ xPx: 0, yPx: 0, ...canvas.extent }, { widthPx, heightPx }, { mode: "native", frameAnchor: { x: Number(properties["center-x"]), y: Number(properties["top-y"]) }, contentAnchor: { x: 0.5, y: 0 }, limit: "free" });
}
export function validateEmojiStyle(data: unknown): asserts data is EmojiStyle {
  const style = object(data, ["styleKey", "properties"]); identity(style.styleKey); const p = checkedProperties(style.properties, emojiRules);
  if (Number(p["icon-size"]) > Number(p["slot-size"])) throw new DvError("EMOJI_SIZE", "icon-size must not exceed slot-size.");
}
export function validateEmojiPlan(data: unknown): asserts data is EmojiPlan {
  const plan = object(data, ["trackKey", "items"]); identity(plan.trackKey);
  if (!Array.isArray(plan.items) || !plan.items.length) throw new DvError("EMOJI_ITEMS", "Track requires at least one Item.");
  const ids = new Set<string>(); let revealed = false;
  for (const entry of plan.items) {
    const item = object(entry, ["itemKey", "preset"], ["at"]); identity(item.itemKey);
    if (typeof item.preset !== "boolean" || ids.has(item.itemKey)) throw new DvError("EMOJI_ITEM", "Items require unique identities and boolean preset."); ids.add(item.itemKey);
    if (item.preset) { if (revealed || item.at !== undefined) throw new DvError("EMOJI_PRESET", "Preset Items must precede reveals and cannot have at."); }
    else { revealed = true; const at = object(item.at, ["kind", "source"]); if (at.kind !== "at") throw new DvError("EMOJI_AT", "Item at accepts only absolute time or Moment."); if (typeof at.source === "string") { if (!isTimeLiteral(at.source)) throw new DvError("EMOJI_AT", "Item at requires explicit absolute time."); } else validateMomentRef(at.source); }
  }
}
export function validateEmojiProgram(data: unknown): asserts data is EmojiProgram {
  const program = object(data, ["trackKey", "timeline", "canvas", "style", "outer", "placeholder", "items"]); identity(program.trackKey); validateTimeline(program.timeline); validateCanvas(program.canvas); validateEmojiStyle(program.style); validateWindow(program.outer); image(program.placeholder);
  if (program.outer.axisKey !== program.timeline.axisKey || program.outer.consumerKey !== program.trackKey || program.outer.frames.end > program.timeline.totalFrames) throw new DvError("EMOJI_DOMAIN", "Outer window must belong to the Track.");
  if (!Array.isArray(program.items) || !program.items.length) throw new DvError("EMOJI_ITEMS", "Track requires at least one Item.");
  const ids = new Set<string>(); let previous = -1; let revealed = false;
  for (const entry of program.items) {
    const item = object(entry, ["itemKey", "icon"], ["activationFrame"]); identity(item.itemKey); image(item.icon);
    if (ids.has(item.itemKey)) throw new DvError("EMOJI_ITEM", "Item identities must be unique."); ids.add(item.itemKey);
    if (item.activationFrame === undefined) { if (revealed) throw new DvError("EMOJI_PRESET", "Preset Items must precede reveals."); }
    else { integer(item.activationFrame); revealed = true; if (item.activationFrame < program.outer.frames.start || item.activationFrame >= program.outer.frames.end || item.activationFrame <= previous) throw new DvError("EMOJI_ORDER", "Reveal times must be inside outer and strictly increasing in author order."); previous = item.activationFrame; }
  }
  const p = program.style.properties;
  const { widthPx: width, heightPx: height, xPx: left, yPx: top } = emojiStripRect(program.canvas, p, program.items.length);
  const sx = Number(p["shadow-x"]), sy = Number(p["shadow-y"]), spread = Math.max(0, Number(p["shadow-spread"])) + Number(p["shadow-blur"]);
  finite(width); finite(height);
  if (left + Math.min(0, sx - spread) < 0 || top + Math.min(0, sy - spread) < 0 || left + width + Math.max(0, sx + spread) > program.canvas.extent.widthPx || top + height + Math.max(0, sy + spread) > program.canvas.extent.heightPx) throw new DvError("EMOJI_LAYOUT", "Answer strip including its shadow must fit inside Canvas.");
}
