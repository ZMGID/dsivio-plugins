import type { ModuleDef, ProducerDef } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { CaptionDocument, Timeline, Window } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { fontTypes } from "../../fonts/types.ts";
import type { FontFace, FontStack } from "../../fonts/types.ts";
import type { Recipe } from "../recipe/index.ts";
import { RECIPE } from "../recipe/index.ts";
import { USE_ATTRIBUTES } from "../sound/index.ts";
import type { CaptionStyle, CaptionUsePlan } from "../../components/caption/types.ts";
import { captionTypes } from "../../components/caption/types.ts";
import type { FineProgram, RegionTimeline } from "../../components/caption-fine/types.ts";
import { fineTypes } from "../../components/caption-fine/types.ts";
import { createFineStyle } from "../../components/caption-fine/style.ts";
import { decodeFineStyle, decodeFineTrack } from "../../components/caption-fine/author.ts";
import { assembleFineProgram, scheduleFine } from "../../components/caption-fine/program.ts";
import { lowerFine } from "../../components/caption-fine/lower.ts";
import { validateFineProgram, validateFineSchedule, validateRegions } from "../../components/caption-fine/validate.ts";
import { renderTypes } from "../../render/ir.ts";
const producers: Record<string, ProducerDef> = {};
for (const [name, type] of [["face", fontTypes.face], ["stack", fontTypes.stack]]) producers[`style-${name}`] = {
 inputs: { recipe: { type: RECIPE }, font: { type: type! }, fallbacks: { type: fontTypes.face, list: true }, key: { type: timelineTypes.consumerKey } }, outputs: { style: captionTypes.style }, run(inputs) {
  const style = createFineStyle((inputs.key as Value).data as string, (inputs.recipe as Value).data as unknown as Recipe, (inputs.font as Value).data as unknown as FontFace | FontStack, (inputs.fallbacks as Value[]).map(v => v.data as unknown as FontFace)); return { outputs: { style: { type: captionTypes.style, data: style as unknown as Json } } };
 },
};
producers.program = { inputs: { key: { type: timelineTypes.consumerKey }, document: { type: timelineTypes.caption }, timeline: { type: timelineTypes.timeline }, plan: { type: captionTypes.plan }, windows: { type: timelineTypes.window, list: true }, styles: { type: captionTypes.style, list: true }, regions: { type: fineTypes.regions, optional: true } }, outputs: { program: fineTypes.program, content: captionTypes.content, schedule: fineTypes.schedule }, run(inputs) {
 const program = assembleFineProgram((inputs.key as Value).data as string, (inputs.document as Value).data as unknown as CaptionDocument, (inputs.timeline as Value).data as unknown as Timeline, (inputs.plan as Value).data as unknown as CaptionUsePlan, (inputs.windows as Value[]).map(v => v.data as unknown as Window), (inputs.styles as Value[]).map(v => v.data as unknown as CaptionStyle), inputs.regions ? (inputs.regions as Value).data as unknown as RegionTimeline : undefined);
 return { outputs: { program: { type: fineTypes.program, data: program as unknown as Json }, content: { type: captionTypes.content, data: program.content as unknown as Json }, schedule: { type: fineTypes.schedule, data: scheduleFine(program) as unknown as Json } } };
} };
producers.lower = { inputs: { program: { type: fineTypes.program } }, outputs: { track: renderTypes.visual }, run(inputs) { return { outputs: { track: { type: renderTypes.visual, data: lowerFine((inputs.program as Value).data as unknown as FineProgram) as unknown as Json } } }; } };
const fine: ModuleDef = {
 id: "dsivio-video/caption-fine@1", summary: "Exact-font complete-Cue flow captions, measured word highlighting, role-aware Uses and deterministic motion.",
 types: { Program: { summary: "Complete timed content and ordered caption presentation rules", validate: validateFineProgram }, Schedule: { summary: "Visibility masks preserving original Cue clocks and envelopes", validate: validateFineSchedule }, RegionTimeline: { summary: "Per-role measured normalized rectangles, indexed by Timeline frame", validate: validateRegions } },
 surfaces: {
  Style: { mode: "structured", doc: { summary: "Complete caption Recipe with exact fonts", attributes: [{ name: "id", required: true, accepts: "text", summary: "Style identity" }, { name: "recipe", required: true, accepts: RECIPE, summary: "Inline caption Recipe" }, { name: "font", required: true, accepts: "Face|Stack", summary: "Exact primary font or stack" }], children: [{ tag: "Fallback", repeat: true, summary: "Appended exact fallback face" }], outputs: [{ name: "", type: captionTypes.style, summary: "Shared caption Style" }] }, elaborate: decodeFineStyle },
  Track: { mode: "structured", doc: { summary: "Timed authored caption Cues; independent Tracks may coexist", attributes: [{ name: "id", required: true, accepts: "text", summary: "Track identity" }, { name: "document", required: true, accepts: timelineTypes.caption, summary: "Script caption document" }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Measured Timeline" }, { name: "regions", required: false, accepts: fineTypes.regions, summary: "Measured role-region evidence" }], children: [{ tag: "Use", repeat: true, summary: "Ordered role/window style rule" }], outputs: [{ name: "content", type: captionTypes.content, summary: "Complete timed content" }, { name: "program", type: fineTypes.program, summary: "Inspectable author program" }, { name: "schedule", type: fineTypes.schedule, summary: "Cue visibility schedule" }, { name: "track", type: renderTypes.visual, summary: "Terminal caption track" }] }, elaborate: decodeFineTrack },
  Use: { mode: "structured", doc: { summary: "Last matching role/window wins without resetting word clocks", attributes: [...USE_ATTRIBUTES.map(attr => attr.name === "style" ? { ...attr, accepts: captionTypes.style } : attr), { name: "role", required: false, accepts: "text", summary: "Only matching Cue role" }], outputs: [] }, elaborate(node, ctx) { ctx.fail("CAPTION_CHILD", "Use is only valid inside caption-fine:Track", node.span); } },
  Fallback: { mode: "structured", doc: { summary: "Append one exact Face after primary fonts", attributes: [{ name: "font", required: true, accepts: fontTypes.face, summary: "Exact fallback face" }], outputs: [] }, elaborate(node, ctx) { ctx.fail("CAPTION_CHILD", "Fallback is only valid inside caption-fine:Style", node.span); } },
 }, producers,
};
export default fine;
