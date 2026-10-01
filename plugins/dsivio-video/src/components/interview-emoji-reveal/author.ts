import type { ElaborationContext, Binding } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import { spaceTypes } from "../../space/types.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { isTimeLiteral } from "../../timeline/temporal.ts";
import { WINDOW_ATTRIBUTES } from "../../modules/time/index.ts";
import { RECIPE, validateRecipe } from "../../modules/recipe/index.ts";
import { imageType } from "../../modules/media/index.ts";
import { empty, literal, reference, structured } from "../sound/author.ts";
import { requiredWindow, resolveProperties } from "../comment-sticker/shared.ts";
import { emojiTypes } from "./types.ts";
import type { EmojiPlan } from "./types.ts";
import { emojiRules, validateEmojiPlan, validateEmojiStyle } from "./validate.ts";
export function decodeEmojiStyle(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "recipe"]); empty(element, ctx); const id = literal(attrs, "id", element, ctx);
  const recipe = reference(attrs, "recipe", [RECIPE], element, ctx); if (recipe.kind !== "record") ctx.fail("EMOJI_RECIPE", "Style requires a static Recipe.", element.span); validateRecipe(recipe.value.data);
  const style = { styleKey: entityIdentity(ctx.file, id), properties: resolveProperties(recipe.value.data.properties, emojiRules) }; validateEmojiStyle(style);
  ctx.record(id, { type: emojiTypes.style, data: style }, element.span);
}
export function decodeEmojiTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "timeline", "canvas", "style", "placeholder", ...WINDOW_ATTRIBUTES]); const id = literal(attrs, "id", element, ctx);
  const timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx), canvas = reference(attrs, "canvas", [spaceTypes.canvas], element, ctx), style = reference(attrs, "style", [emojiTypes.style], element, ctx), placeholder = reference(attrs, "placeholder", [imageType], element, ctx);
  const trackKey = entityIdentity(ctx.file, id); const outer = requiredWindow(element, timeline, trackKey, ctx); const plan: EmojiPlan = { trackKey, items: [] }; const icons: Binding[] = [];
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue; if (child.kind !== "element" || child.tag !== `${prefix}Item`) ctx.fail("TRACK_CHILD", "Track accepts only Item children.", child.span);
    const { attrs: a } = structured(child, ctx, ["id", "icon", "preset", "at"]); empty(child, ctx); const itemId = literal(a, "id", child, ctx);
    const preset = a.preset ? literal(a, "preset", child, ctx) : "false"; if (!["true", "false"].includes(preset)) ctx.fail("EMOJI_PRESET", "preset requires true or false.", child.span);
    const item: EmojiPlan["items"][number] = { itemKey: entityIdentity(ctx.file, `${id}/${itemId}`), preset: preset === "true" };
    if (a.at) {
      if (a.at.value.kind === "ref") { const source = reference(a, "at", [timelineTypes.moment], child, ctx); if (source.kind !== "record") ctx.fail("EMOJI_AT", "Moment must be a static author reference.", child.span); item.at = { kind: "at", source: source.value.data as unknown as Extract<NonNullable<typeof item.at>, { kind: "at" }>["source"] }; }
      else { const at = literal(a, "at", child, ctx); if (!isTimeLiteral(at)) ctx.fail("EMOJI_AT", "at accepts an absolute time or Moment reference.", child.span); item.at = { kind: "at", source: at }; }
    }
    plan.items.push(item); icons.push(reference(a, "icon", [imageType], child, ctx));
  }
  validateEmojiPlan(plan); const planBinding = ctx.record(null, { type: emojiTypes.plan, data: plan as unknown as Json }, element.span);
  const output = ctx.operation({ producer: "dsivio-video/interview-emoji-reveal@1#program", inputs: { timeline, canvas, style, placeholder, outer, plan: planBinding, icons }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/interview-emoji-reveal@1#lower", inputs: { program: output.program! }, publish: { track: `${id}.track` }, label: id, span: element.span });
}
