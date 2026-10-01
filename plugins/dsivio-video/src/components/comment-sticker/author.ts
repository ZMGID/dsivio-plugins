import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement, Attribute } from "../../markup/ast.ts";
import { fontTypes } from "../../fonts/types.ts";
import { spaceTypes } from "../../space/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { RECIPE, validateRecipe } from "../../modules/recipe/index.ts";
import { imageType } from "../../modules/media/index.ts";
import { WINDOW_ATTRIBUTES } from "../../modules/time/index.ts";
import { empty, literal, reference, structured } from "../sound/author.ts";
import { requiredWindow, resolveProperties } from "./shared.ts";
import { stickerRules } from "./validate.ts";
import { stickerTypes } from "./types.ts";
const TEXT = "dsivio-video/text@1#Text";
export function textBinding(attrs: Record<string, Attribute>, name: string, element: ElementNode, ctx: ElaborationContext): Binding {
  if (attrs[name]?.value.kind === "ref") return reference(attrs, name, [TEXT], element, ctx);
  return ctx.record(null, { type: TEXT, data: literal(attrs, name, element, ctx) }, element.span);
}
export function decodeStickerStyle(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "recipe", "font"]); empty(element, ctx);
  const id = literal(attrs, "id", element, ctx); const recipe = reference(attrs, "recipe", [RECIPE], element, ctx);
  if (recipe.kind !== "record") ctx.fail("STICKER_RECIPE", "Style requires a static Recipe.", element.span);
  validateRecipe(recipe.value.data); resolveProperties(recipe.value.data.properties, stickerRules);
  const font = reference(attrs, "font", [fontTypes.stack], element, ctx);
  const key = ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, element.span);
  ctx.operation({ producer: "dsivio-video/comment-sticker@1#style", inputs: { recipe, font, key }, publish: { style: id }, label: id, span: element.span });
}
export function decodeStickerTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "canvas", "timeline"]); const id = literal(attrs, "id", element, ctx);
  const timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx); const canvas = reference(attrs, "canvas", [spaceTypes.canvas], element, ctx);
  const items: Binding[] = [], frames: Binding[] = [], windows: Binding[] = [], styles: Binding[] = []; const ids = new Set<string>();
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue;
    if (child.kind !== "element" || child.tag !== `${prefix}Sticker`) ctx.fail("TRACK_CHILD", "Track accepts only Sticker children.", child.span);
    const { attrs: a } = structured(child, ctx, ["id", "frame", "style", "comment", "avatar", "author", "header", "meta", ...WINDOW_ATTRIBUTES]);
    const itemId = literal(a, "id", child, ctx); if (ids.has(itemId)) ctx.fail("TRACK_DUPLICATE", `Duplicate Sticker '${itemId}'.`, child.span); ids.add(itemId);
    if (child.children.some(part => part.kind !== "text")) ctx.fail("TRACK_CHILD", "Sticker body must be plain comment text.", child.span);
    const lines = child.children.map(part => part.kind === "text" ? part.text : "").join("").replace(/^\n|\n\s*$/g, "").split("\n");
    const indentation = Math.min(...lines.filter(line => line.trim()).map(line => /^\s*/.exec(line)![0].length));
    const body = lines.map(line => line.slice(Number.isFinite(indentation) ? indentation : 0)).join("\n").trim();
    if (a.comment && body) ctx.fail("STICKER_COMMENT", "comment and a nonempty body are mutually exclusive.", child.span);
    const comment = a.comment ? textBinding(a, "comment", child, ctx) : ctx.record(null, { type: TEXT, data: body }, child.span);
    if (!a.comment && !body) ctx.fail("STICKER_COMMENT", "A nonempty comment is required.", child.span);
    const itemKey = entityIdentity(ctx.file, `${id}/${itemId}`); const key = ctx.record(null, { type: timelineTypes.consumerKey, data: itemKey }, child.span);
    const inputs: Record<string, Binding> = { key, comment };
    for (const name of ["author", "header", "meta"]) if (a[name]) inputs[name] = textBinding(a, name, child, ctx);
    if (a.avatar) inputs.avatar = reference(a, "avatar", [imageType], child, ctx);
    items.push(ctx.operation({ producer: "dsivio-video/comment-sticker@1#item", inputs, publish: {}, label: itemId, span: child.span }).item!);
    frames.push(reference(a, "frame", [spaceTypes.frame], child, ctx)); styles.push(reference(a, "style", [stickerTypes.style], child, ctx)); windows.push(requiredWindow(child, timeline, itemKey, ctx));
  }
  if (!items.length) ctx.fail("STICKER_ITEMS", "Track requires at least one Sticker.", element.span);
  const key = ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, element.span);
  const outputs = ctx.operation({ producer: "dsivio-video/comment-sticker@1#program", inputs: { key, timeline, canvas, items, frames, windows, styles }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/comment-sticker@1#lower", inputs: { program: outputs.program! }, publish: { track: `${id}.track` }, label: id, span: element.span });
}
