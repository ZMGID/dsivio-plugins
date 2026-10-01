import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import { structured, literal, reference, empty } from "../sound/author.ts";
import { validateComposePlan } from "./validate.ts";
import { composePlanType } from "./types.ts";
export function decodeComposeImage(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "canvas", "background"]);
  const id = literal(attrs, "id", element, ctx);
  const canvas = reference(attrs, "canvas", ["dsivio-video/space@1#Canvas"], element, ctx);
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  const sources: Binding[] = [], frames: Binding[] = [], layers: Json[] = [];
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue;
    if (child.kind !== "element" || child.tag !== `${prefix}Layer`) ctx.fail("RASTER_CHILD", "Image accepts only Layer children from its namespace.", child.span);
    const a = structured(child, ctx, ["source", "frame", "fit", "interpolation", "opacity"]).attrs; empty(child, ctx);
    sources.push(reference(a, "source", ["dsivio-video/media@1#Image"], child, ctx));
    frames.push(reference(a, "frame", ["dsivio-video/space@1#Frame"], child, ctx));
    layers.push({ fit: a.fit ? literal(a, "fit", child, ctx) : "contain", interpolation: a.interpolation ? literal(a, "interpolation", child, ctx) : "lanczos", opacity: a.opacity ? Number(literal(a, "opacity", child, ctx)) : 1 });
  }
  const data = { background: attrs.background ? literal(attrs, "background", element, ctx) : "#00000000", layers };
  try { validateComposePlan(data); }
  catch (error) { if (error instanceof DvError) ctx.fail(error.code, error.message, element.span); throw error; }
  const plan = ctx.record(null, { type: composePlanType, data: data as unknown as Json }, element.span);
  ctx.operation({ producer: "dsivio-video/image-compose@1#compose", inputs: { canvas, plan, sources, frames }, publish: { image: `${id}.image` }, label: id, span: element.span });
}
