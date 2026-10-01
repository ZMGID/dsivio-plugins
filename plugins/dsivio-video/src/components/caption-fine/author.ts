import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import { attributes, literal, reference, empty } from "../../space/parse.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { fontTypes } from "../../fonts/types.ts";
import { RECIPE } from "../../modules/recipe/index.ts";
import type { Recipe } from "../../modules/recipe/index.ts";
import { WINDOW_ATTRIBUTES, decodeWindowAttributes, publishWindow } from "../../modules/time/index.ts";
import type { CaptionUsePlan } from "../caption/types.ts";
import { captionTypes } from "../caption/types.ts";
import { fineTypes } from "./types.ts";
import { decodeFineRecipe } from "./style.ts";
export function decodeFineStyle(node: ElementNode | RawElement, ctx: ElaborationContext): void {
 const attrs = attributes(node, ["id", "recipe", "font"], ctx), id = literal(attrs.id, "id", ctx, node);
 const recipe = reference(attrs.recipe, [RECIPE], ctx, node); if (recipe.kind !== "record") return ctx.fail("CAPTION_RECIPE", "Caption Recipe must be readable during author compilation", node.span);
 decodeFineRecipe((recipe.value.data as unknown as Recipe).properties);
 const font = reference(attrs.font, [fontTypes.face, fontTypes.stack], ctx, node), fallbacks: Binding[] = [];
 if (node.kind !== "element") return ctx.fail("CAPTION_CHILD", "Style requires structured markup", node.span);
 const prefix = node.tag.slice(0, node.tag.lastIndexOf(":") + 1);
 for (const child of node.children) { if (child.kind === "text" && !child.text.trim()) continue; if (child.kind !== "element" || child.tag !== `${prefix}Fallback`) return ctx.fail("CAPTION_CHILD", "Style only accepts Fallback children from its own namespace", child.span); const a = attributes(child, ["font"], ctx); empty(child, ctx); fallbacks.push(reference(a.font, [fontTypes.face], ctx, child)); }
 ctx.operation({ producer: `dsivio-video/caption-fine@1#style-${font.type === fontTypes.face ? "face" : "stack"}`, inputs: { recipe, font, fallbacks, key: ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, node.span) }, publish: { style: id }, label: id, span: node.span });
}
export function decodeFineTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
 const attrs = attributes(node, ["id", "document", "timeline", "regions"], ctx), id = literal(attrs.id, "id", ctx, node);
 const document = reference(attrs.document, [timelineTypes.caption], ctx, node), timeline = reference(attrs.timeline, [timelineTypes.timeline], ctx, node);
 const plan: CaptionUsePlan = { uses: [] }, windows: Binding[] = [], styles: Binding[] = [], ids = new Set<string>();
 if (node.kind !== "element") return ctx.fail("CAPTION_CHILD", "Track requires structured markup", node.span);
 const prefix = node.tag.slice(0, node.tag.lastIndexOf(":") + 1);
 for (const child of node.children) {
  if (child.kind === "text" && !child.text.trim()) continue; if (child.kind !== "element" || child.tag !== `${prefix}Use`) return ctx.fail("CAPTION_CHILD", "Track only accepts Use children from its own namespace", child.span);
  const a = attributes(child, ["id", "style", "role", ...WINDOW_ATTRIBUTES], ctx); empty(child, ctx);
  const name = a.id ? literal(a.id, "id", ctx, child) : `use-${String(plan.uses.length + 1).padStart(4, "0")}`; if (ids.has(name)) return ctx.fail("CAPTION_DUPLICATE", `Duplicate Use identity '${name}'`, child.span); ids.add(name);
  const useKey = entityIdentity(ctx.file, `${id}/${name}`); windows.push(publishWindow(timeline, decodeWindowAttributes(child, ctx), useKey, ctx, child.span)); styles.push(reference(a.style, [captionTypes.style], ctx, child)); plan.uses.push({ useKey, windowIndex: windows.length - 1, styleIndex: styles.length - 1, ...(a.role ? { role: literal(a.role, "role", ctx, child) } : {}) });
 }
 const result = ctx.operation({ producer: "dsivio-video/caption-fine@1#program", inputs: { document, timeline, plan: ctx.record(null, { type: captionTypes.plan, data: plan as unknown as Json }, node.span), windows, styles, key: ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, node.span), ...(attrs.regions ? { regions: reference(attrs.regions, [fineTypes.regions], ctx, node) } : {}) }, publish: { program: `${id}.program`, content: `${id}.content`, schedule: `${id}.schedule` }, label: id, span: node.span });
 ctx.operation({ producer: "dsivio-video/caption-fine@1#lower", inputs: { program: result.program! }, publish: { track: `${id}.track` }, label: id, span: node.span });
}
