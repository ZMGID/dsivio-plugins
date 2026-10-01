import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { decodeWindowAttributes, publishWindow, WINDOW_ATTRIBUTES } from "../../modules/time/index.ts";
import { structured, literal, reference, empty } from "../sound/author.ts";
import type { AudioPlan, AudioItemPlan, AudioPlayback } from "./types.ts";
import { audioTrackTypes } from "./types.ts";
import { validateAudioPlan } from "./validate.ts";
export const AUDIO_ITEM_ATTRIBUTES = ["id", "source", ...WINDOW_ATTRIBUTES.filter(key => key !== "window"), "trim-start", "trim-end", "playback", "min-rate", "max-rate", "gain", "fade-in", "fade-out"];
export function decodeAudioTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "timeline"]);
  const id = literal(attrs, "id", element, ctx), timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx);
  const plan: AudioPlan = { trackKey: entityIdentity(ctx.file, id), items: [] }, sources: Binding[] = [], windows: Binding[] = [];
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue;
    if (child.kind !== "element" || child.tag !== `${prefix}Item`) ctx.fail("AUDIO_CHILD", "Audio Track accepts only empty Item children.", child.span);
    const { attrs: a } = structured(child, ctx, AUDIO_ITEM_ATTRIBUTES); empty(child, ctx);
    const itemId = a.id ? literal(a, "id", child, ctx) : `${id}-${String(plan.items.length + 1).padStart(4, "0")}`;
    const itemKey = entityIdentity(ctx.file, `${id}/${itemId}`);
    sources.push(reference(a, "source", [timelineTypes.media], child, ctx));
    const expression = decodeWindowAttributes(child, ctx);
    if (expression.kind === "during" && !a.during) ctx.fail("AUDIO_WINDOW", "Audio Item requires a complete window.", child.span);
    windows.push(publishWindow(timeline, expression, itemKey, ctx, child.span));
    const item: AudioItemPlan = { itemKey, sourceIndex: sources.length - 1, windowIndex: windows.length - 1, playback: (a.playback ? literal(a, "playback", child, ctx) : "once") as AudioPlayback, gain: a.gain ? Number(literal(a, "gain", child, ctx)) : 1, trimStart: a["trim-start"] ? literal(a, "trim-start", child, ctx) : "0f", fadeIn: a["fade-in"] ? literal(a, "fade-in", child, ctx) : "0f", fadeOut: a["fade-out"] ? literal(a, "fade-out", child, ctx) : "0f" };
    if (a["trim-end"]) item.trimEnd = literal(a, "trim-end", child, ctx);
    if (a["min-rate"]) item.minRate = Number(literal(a, "min-rate", child, ctx));
    if (a["max-rate"]) item.maxRate = Number(literal(a, "max-rate", child, ctx));
    plan.items.push(item);
  }
  validateAudioPlan(plan);
  const p = ctx.record(null, { type: audioTrackTypes.plan, data: plan as unknown as Json }, element.span);
  const output = ctx.operation({ producer: "dsivio-video/audio-track@1#program", inputs: { key: ctx.record(null, { type: timelineTypes.consumerKey, data: plan.trackKey }, element.span), timeline, plan: p, sources, windows }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/audio-track@1#lower", inputs: { program: output.program! }, publish: { audio: `${id}.audio` }, label: id, span: element.span });
}
