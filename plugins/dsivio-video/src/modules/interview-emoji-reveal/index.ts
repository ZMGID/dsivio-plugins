import type { ModuleDef } from "../../core/module.ts";
import type { Json, ResourceRef, Value } from "../../core/value.ts";
import type { Canvas } from "../../space/types.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { RECIPE } from "../recipe/index.ts";
import { imageType } from "../media/index.ts";
import { WINDOW_ATTRIBUTES } from "../time/index.ts";
import { authorStyle as decodeEmojiStyle, authorTrack as decodeEmojiTrack, interviewEmojiCompanions } from "./studio.ts";
import { emojiRules, validateEmojiStyle, validateEmojiPlan, validateEmojiProgram } from "../../components/interview-emoji-reveal/validate.ts";
import { emojiTypes } from "../../components/interview-emoji-reveal/types.ts";
import type { EmojiPlan, EmojiStyle } from "../../components/interview-emoji-reveal/types.ts";
import { assembleEmojiProgram } from "../../components/interview-emoji-reveal/program.ts";
import { lowerEmojiReveal } from "../../components/interview-emoji-reveal/lower.ts";
const emojiReveal: ModuleDef = {
  id: "dsivio-video/interview-emoji-reveal@1", summary: "Canvas-anchored answer strip with ordered semantic reveals, preset icons and frame-deterministic bounce.",
  studio: interviewEmojiCompanions,
  types: { Style: { summary: "Resolved strip appearance.", validate: validateEmojiStyle }, Plan: { summary: "Ordered preset and absolute/Moment reveal declarations.", validate: validateEmojiPlan }, Program: { summary: "Resolved geometry and reveal frames on a Timeline.", validate: validateEmojiProgram } },
  surfaces: {
    Style: { mode: "structured", doc: { summary: "Static Recipe; icon-size cannot exceed slot-size. One-frame reveals preserve the activation scale and coalesce coincident later stages.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Style identity." }, { name: "recipe", required: true, accepts: RECIPE, summary: `Keys and defaults: ${Object.entries(emojiRules).map(([key, rule]) => `${key}=${JSON.stringify(rule.value)}`).join(", ")}.` }], outputs: [{ name: "", type: emojiTypes.style, summary: "Strip Style." }] }, elaborate: decodeEmojiStyle },
    Track: { mode: "structured", doc: { summary: "At least one Item; explicit outer W, entire strip and checked shadow inside Canvas, no automatic audio. All images inherit the half-open outer visibility; border decoration never shifts slot positions.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Track identity." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Program axis." }, { name: "canvas", required: true, accepts: spaceTypes.canvas, summary: "Canvas geometry." }, { name: "style", required: true, accepts: emojiTypes.style, summary: "Strip Style." }, { name: "placeholder", required: true, accepts: imageType, summary: "Nonempty placeholder image." }, ...WINDOW_ATTRIBUTES.map(name => ({ name, required: false, accepts: "text" as const, summary: "Complete W temporal attribute." }))], children: [{ tag: "Item", repeat: true, summary: "Preset prefix then strictly increasing reveals." }], outputs: [{ name: "program", type: emojiTypes.program, summary: "Inspectable reveal Program." }, { name: "track", type: renderTypes.visual, summary: "Terminal Visual Track." }] }, elaborate: decodeEmojiTrack },
    Item: { mode: "structured", doc: { summary: "Track-only empty element; preset and at are mutually exclusive; non-preset requires at.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Unique Item identity." }, { name: "icon", required: true, accepts: imageType, summary: "Nonempty answer image." }, { name: "preset", required: false, accepts: "boolean", summary: "Default false; presets precede every reveal." }, { name: "at", required: false, accepts: "text", summary: "Absolute time or Moment reference, strictly increasing inside outer." }], outputs: [] }, elaborate(node, ctx) { ctx.fail("TRACK_CHILD", "Item is only valid inside interview-emoji-reveal:Track.", node.span); } },
  },
  producers: {
    program: { inputs: { timeline: { type: timelineTypes.timeline }, canvas: { type: spaceTypes.canvas }, style: { type: emojiTypes.style }, outer: { type: timelineTypes.window }, placeholder: { type: imageType }, plan: { type: emojiTypes.plan }, icons: { type: imageType, list: true } }, outputs: { program: emojiTypes.program }, run(inputs) {
      const program = assembleEmojiProgram((inputs.timeline as Value).data as unknown as Timeline, (inputs.canvas as Value).data as Canvas, (inputs.style as Value).data as EmojiStyle, (inputs.outer as Value).data as Window, (inputs.placeholder as Value).data as unknown as ResourceRef, (inputs.plan as Value).data as unknown as EmojiPlan, (inputs.icons as Value[]).map(v => v.data as unknown as ResourceRef));
      return { outputs: { program: { type: emojiTypes.program, data: program as unknown as Json } } };
    } },
    lower: { inputs: { program: { type: emojiTypes.program } }, outputs: { track: renderTypes.visual }, run(inputs) {
      const program = (inputs.program as Value).data; validateEmojiProgram(program); return { outputs: { track: { type: renderTypes.visual, data: lowerEmojiReveal(program) as unknown as Json } } };
    } },
  },
};
export default emojiReveal;
