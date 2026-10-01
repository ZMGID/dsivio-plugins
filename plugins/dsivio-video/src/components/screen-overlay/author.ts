import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import { spaceTypes } from "../../space/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { decodeWindowAttributes, publishWindow, WINDOW_ATTRIBUTES } from "../../modules/time/index.ts";
import { empty, literal, reference, structured } from "../sound/author.ts";
import type { OverlayAuthorPlan } from "./types.ts";
import { overlayTypes } from "./types.ts";
import { isOverlayKind, OVERLAY_FIELDS, parseOverlayOptions, validateOverlayPlan } from "./validate.ts";

export function decodeOverlayTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "canvas", "timeline"]);
  const id = literal(attrs, "id", element, ctx);
  const canvas = reference(attrs, "canvas", [spaceTypes.canvas], element, ctx);
  const timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx);
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  const plan: OverlayAuthorPlan = { effects: [] };
  const windows: Binding[] = [];
  const ids = new Set<string>();
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue;
    if (child.kind !== "element" || !child.tag.startsWith(prefix)) ctx.fail("OVERLAY_CHILD", "Overlay Track accepts only its own empty effect elements.", child.span);
    const kind = child.tag.slice(prefix.length);
    if (!isOverlayKind(kind)) ctx.fail("OVERLAY_CHILD", `Unknown overlay '${child.tag}'.`, child.span);
    const fields = Object.keys(OVERLAY_FIELDS[kind]);
    const decoded = structured(child, ctx, ["id", "z", ...WINDOW_ATTRIBUTES, ...fields]);
    empty(child, ctx);
    if (!WINDOW_ATTRIBUTES.some(name => decoded.attrs[name])) ctx.fail("OVERLAY_WINDOW", `${kind} requires an explicit window.`, child.span);
    const localId = decoded.attrs.id ? literal(decoded.attrs, "id", child, ctx) : `${kind}-${String(plan.effects.length + 1).padStart(4, "0")}`;
    if (ids.has(localId)) ctx.fail("OVERLAY_DUPLICATE", `Duplicate effect id '${localId}'.`, child.span);
    ids.add(localId);
    const effectKey = entityIdentity(ctx.file, `${id}/${localId}`);
    const literals: Record<string, string> = {};
    for (const field of fields) literals[field] = literal(decoded.attrs, field, child, ctx);
    const z = Number(literal(decoded.attrs, "z", child, ctx));
    try {
      const options = parseOverlayOptions(kind, literals);
      plan.effects.push({ kind, effectKey, z, options, windowIndex: windows.length } as OverlayAuthorPlan["effects"][number]);
      validateOverlayPlan(plan);
    } catch (error) {
      if (error instanceof DvError) ctx.fail(error.code, `${kind}: ${error.message}`, child.span);
      throw error;
    }
    windows.push(publishWindow(timeline, decodeWindowAttributes(child, ctx), effectKey, ctx, child.span));
  }
  if (!plan.effects.length) ctx.fail("OVERLAY_EMPTY", "Overlay Track requires at least one effect.", element.span);
  const key = ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, element.span);
  const authored = ctx.record(null, { type: overlayTypes.plan, data: plan as unknown as Json }, element.span);
  const outputs = ctx.operation({ producer: "dsivio-video/screen-overlay@1#program", inputs: { key, canvas, timeline, plan: authored, windows }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/screen-overlay@1#lower", inputs: { program: outputs.program! }, publish: { track: `${id}.track` }, label: id, span: element.span });
}
