import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import type { SoundStyle, UsePlan } from "../types.ts";
import { trackTypes } from "../types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { decodeWindowAttributes, publishWindow, WINDOW_ATTRIBUTES } from "../../modules/time/index.ts";
import { validateSoundStyle } from "./validate.ts";

export function structured(node: ElementNode | RawElement, ctx: ElaborationContext, allowed: readonly string[]): { element: ElementNode; attrs: Record<string, Attribute> } {
  if (node.kind !== "element") ctx.fail("TRACK_CHILD", "Track surfaces require structured markup.", node.span);
  const attrs: Record<string, Attribute> = Object.create(null);
  for (const attr of node.attributes) {
    if (!allowed.includes(attr.name) || Object.hasOwn(attrs, attr.name)) ctx.fail("TRACK_ATTRIBUTE", `Unexpected or duplicate attribute '${attr.name}'.`, attr.span);
    attrs[attr.name] = attr;
  }
  return { element: node, attrs };
}
export function literal(attrs: Record<string, Attribute>, name: string, element: ElementNode, ctx: ElaborationContext): string {
  const attr = attrs[name];
  if (!attr || attr.value.kind !== "literal" || !attr.value.text.trim()) ctx.fail("TRACK_ATTRIBUTE", `'${name}' requires a nonempty literal.`, attr?.span ?? element.span);
  return attr.value.text.trim();
}
export function reference(attrs: Record<string, Attribute>, name: string, types: readonly string[], element: ElementNode, ctx: ElaborationContext): Binding {
  const attr = attrs[name];
  if (!attr || attr.value.kind !== "ref") ctx.fail("TRACK_REFERENCE", `'${name}' requires a typed reference.`, attr?.span ?? element.span);
  const binding = ctx.lookup(attr.value.name, attr.span);
  if (!types.includes(binding.type)) ctx.fail("TRACK_REFERENCE", `'${name}' requires ${types.join(" or ")}.`, attr.span);
  return binding;
}
export function empty(element: ElementNode, ctx: ElaborationContext): void {
  if (element.children.some(child => child.kind !== "text" || child.text.trim())) ctx.fail("TRACK_CHILD", `${element.tag} must be empty.`, element.span);
}
export function decodeSoundStyle(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "gain", "end-gain"]);
  empty(element, ctx);
  const id = literal(attrs, "id", element, ctx);
  const gain = attrs.gain ? Number(literal(attrs, "gain", element, ctx)) : 1;
  const style: SoundStyle = { styleKey: entityIdentity(ctx.file, id), gain, endGain: attrs["end-gain"] ? Number(literal(attrs, "end-gain", element, ctx)) : gain };
  try { validateSoundStyle(style); } catch (error) { if (error instanceof DvError) ctx.fail(error.code, error.message, element.span); throw error; }
  ctx.record(id, { type: trackTypes.soundStyle, data: style }, element.span);
}
export function decodeTrackUses(element: ElementNode, ctx: ElaborationContext, id: string, timeline: Binding, styleType: string): { plan: UsePlan; windows: Binding[]; styles: Binding[] } {
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  const plan: UsePlan = { trackKey: entityIdentity(ctx.file, id), uses: [] };
  const windows: Binding[] = [];
  const styles: Binding[] = [];
  const ids = new Set<string>();
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue;
    if (child.kind !== "element" || child.tag !== `${prefix}Use`) ctx.fail("TRACK_CHILD", "Track accepts only Use children from its own namespace.", child.span);
    const { attrs } = structured(child, ctx, ["id", "style", ...WINDOW_ATTRIBUTES]);
    empty(child, ctx);
    const useId = attrs.id ? literal(attrs, "id", child, ctx) : `use-${String(plan.uses.length + 1).padStart(4, "0")}`;
    if (ids.has(useId)) ctx.fail("TRACK_DUPLICATE", `Duplicate Use identity '${useId}'.`, child.span);
    ids.add(useId);
    const useKey = entityIdentity(ctx.file, `${id}/${useId}`);
    const expression = decodeWindowAttributes(child, ctx);
    windows.push(publishWindow(timeline, expression, useKey, ctx, child.span));
    styles.push(reference(attrs, "style", [styleType], child, ctx));
    plan.uses.push({ useKey, windowIndex: windows.length - 1, styleIndex: styles.length - 1 });
  }
  return { plan, windows, styles };
}
export function decodeSoundTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "timeline"]);
  const id = literal(attrs, "id", element, ctx);
  const timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx);
  const uses = decodeTrackUses(element, ctx, id, timeline, trackTypes.soundStyle);
  const plan = ctx.record(null, { type: trackTypes.soundPlan, data: uses.plan }, element.span);
  const outputs = ctx.operation({ producer: "dsivio-video/sound@1#program", inputs: { timeline, plan, windows: uses.windows, styles: uses.styles }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/sound@1#lower", inputs: { program: outputs.program! }, publish: { audio: `${id}.audio` }, label: id, span: element.span });
}
