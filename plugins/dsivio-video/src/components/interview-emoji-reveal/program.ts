import { DvError } from "../../core/errors.ts";
import type { ResourceRef } from "../../core/value.ts";
import type { Canvas } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import { projectInstant } from "../../timeline/temporal.ts";
import type { EmojiPlan, EmojiProgram, EmojiStyle } from "./types.ts";
import { validateEmojiPlan, validateEmojiProgram } from "./validate.ts";
export function assembleEmojiProgram(timeline: Timeline, canvas: Canvas, style: EmojiStyle, outer: Window, placeholder: ResourceRef, plan: EmojiPlan, icons: ResourceRef[]): EmojiProgram {
  validateEmojiPlan(plan); if (plan.items.length !== icons.length) throw new DvError("EMOJI_INPUT", "Each Item requires one icon.");
  const items = plan.items.map((item, index) => ({ itemKey: item.itemKey, icon: icons[index]!, ...(item.at ? { activationFrame: projectInstant(timeline, item.at, item.itemKey).frame } : {}) }));
  const program = { trackKey: plan.trackKey, timeline, canvas, style, outer, placeholder, items }; validateEmojiProgram(program); return program;
}
