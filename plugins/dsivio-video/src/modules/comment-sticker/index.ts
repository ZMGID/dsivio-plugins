import type { ModuleDef } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { FontStack } from "../../fonts/types.ts";
import { fontTypes } from "../../fonts/types.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { RECIPE, validateRecipe } from "../recipe/index.ts";
import { imageType } from "../media/index.ts";
import { WINDOW_ATTRIBUTES } from "../time/index.ts";
import { decodeStickerStyle, decodeStickerTrack } from "../../components/comment-sticker/author.ts";
import { resolveProperties } from "../../components/comment-sticker/shared.ts";
import { stickerRules, validateStickerStyle, validateStickerItem, validateStickerProgram } from "../../components/comment-sticker/validate.ts";
import { stickerTypes } from "../../components/comment-sticker/types.ts";
import type { StickerStyle } from "../../components/comment-sticker/types.ts";
import { assembleStickerProgram } from "../../components/comment-sticker/program.ts";
import { lowerStickers } from "../../components/comment-sticker/lower.ts";
const TEXT = "dsivio-video/text@1#Text";
const commentSticker: ModuleDef = {
  id: "dsivio-video/comment-sticker@1", summary: "Windowed comment cards with exact fonts, optional circular avatars, tail and deterministic pop/float motion.",
  types: { Style: { summary: "Resolved comment appearance and exact font Stack.", validate: validateStickerStyle }, Item: { summary: "Resolved comment, metadata and optional avatar.", validate: validateStickerItem }, Program: { summary: "Ordered stickers on a Timeline and Canvas.", validate: validateStickerProgram } },
  surfaces: {
    Style: { mode: "structured", doc: { summary: "Static Recipe, required exact FontStack. Weight intent rounds half up to 100 steps (680/850/650 become 700/900/700), then selects the nearest supplied exact face within the primary family; fallback families retain author order. No synthesis or system fallback.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Style identity." }, { name: "recipe", required: true, accepts: RECIPE, summary: `Keys and defaults: ${Object.entries(stickerRules).map(([key, rule]) => `${key}=${JSON.stringify(rule.value)}`).join(", ")}. Short animation phases clamp to the card lifetime; hold only runs between entry and exit.` }, { name: "font", required: true, accepts: fontTypes.stack, summary: "Exact font Stack; all supplied faces retain their real weights." }], outputs: [{ name: "", type: stickerTypes.style, summary: "Comment Style." }] }, elaborate: decodeStickerStyle },
    Track: { mode: "structured", doc: { summary: "At least one Sticker; .program and terminal .track, no audio.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Track identity." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Program axis." }, { name: "canvas", required: true, accepts: spaceTypes.canvas, summary: "Canvas geometry." }], children: [{ tag: "Sticker", repeat: true, summary: "Independent comment card." }], outputs: [{ name: "program", type: stickerTypes.program, summary: "Inspectable Program." }, { name: "track", type: renderTypes.visual, summary: "Visual Track." }] }, elaborate: decodeStickerTrack },
    Sticker: { mode: "structured", doc: { summary: "Track-only comment card; explicit W required. Plain dedented body or comment attribute, never both.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Unique card id." }, { name: "frame", required: true, accepts: spaceTypes.frame, summary: "Frame including tail." }, { name: "style", required: true, accepts: stickerTypes.style, summary: "Comment Style." }, ...["comment", "author", "header", "meta"].map(name => ({ name, required: false, accepts: "text" as const, summary: "Nonempty literal or Text reference." })), { name: "avatar", required: false, accepts: imageType, summary: "Optional image source." }, ...WINDOW_ATTRIBUTES.map(name => ({ name, required: false, accepts: "text" as const, summary: "Complete W temporal attribute." }))], outputs: [] }, elaborate(node, ctx) { ctx.fail("TRACK_CHILD", "Sticker is only valid inside comment-sticker:Track.", node.span); } },
  },
  producers: {
    style: { inputs: { recipe: { type: RECIPE }, font: { type: fontTypes.stack }, key: { type: timelineTypes.consumerKey } }, outputs: { style: stickerTypes.style }, run(inputs) {
      const recipe = (inputs.recipe as Value).data; validateRecipe(recipe);
      const style = { styleKey: (inputs.key as Value).data as string, properties: resolveProperties(recipe.properties, stickerRules), fonts: (inputs.font as Value).data as unknown as FontStack }; validateStickerStyle(style);
      return { outputs: { style: { type: stickerTypes.style, data: style as unknown as Json } } };
    } },
    item: { inputs: { key: { type: timelineTypes.consumerKey }, comment: { type: TEXT }, author: { type: TEXT, optional: true }, header: { type: TEXT, optional: true }, meta: { type: TEXT, optional: true }, avatar: { type: imageType, optional: true } }, outputs: { item: stickerTypes.item }, run(inputs) {
      const item: Record<string, Json> = { itemKey: (inputs.key as Value).data, comment: (inputs.comment as Value).data };
      for (const name of ["author", "header", "meta", "avatar"]) if (inputs[name]) item[name] = (inputs[name] as Value).data;
      validateStickerItem(item); return { outputs: { item: { type: stickerTypes.item, data: item } } };
    } },
    program: { inputs: { key: { type: timelineTypes.consumerKey }, timeline: { type: timelineTypes.timeline }, canvas: { type: spaceTypes.canvas }, items: { type: stickerTypes.item, list: true }, frames: { type: spaceTypes.frame, list: true }, windows: { type: timelineTypes.window, list: true }, styles: { type: stickerTypes.style, list: true } }, outputs: { program: stickerTypes.program }, run(inputs) {
      const items = (inputs.items as Value[]).map(value => { const data = value.data; validateStickerItem(data); return data; });
      const program = assembleStickerProgram((inputs.key as Value).data as string, (inputs.timeline as Value).data as unknown as Timeline, (inputs.canvas as Value).data as Canvas, items, (inputs.frames as Value[]).map(v => v.data as Frame), (inputs.windows as Value[]).map(v => v.data as Window), (inputs.styles as Value[]).map(v => v.data as unknown as StickerStyle));
      return { outputs: { program: { type: stickerTypes.program, data: program as unknown as Json } } };
    } },
    lower: { inputs: { program: { type: stickerTypes.program } }, outputs: { track: renderTypes.visual }, run(inputs) {
      const program = (inputs.program as Value).data; validateStickerProgram(program); return { outputs: { track: { type: renderTypes.visual, data: lowerStickers(program) as unknown as Json } } };
    } },
  },
};
export default commentSticker;
