import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import type { InstantExpression, SemanticRef } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { spaceTypes } from "../../space/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { RECIPE, validateRecipe } from "../../modules/recipe/index.ts";
import { decodeWindowAttributes, publishWindow, WINDOW_ATTRIBUTES } from "../../modules/time/index.ts";
import { isTimeLiteral } from "../../timeline/temporal.ts";
import { structured, literal, reference, empty } from "../sound/author.ts";
import { finite, integer } from "../sound/validate.ts";
import { parseMotion } from "./motion.ts";
import { FIT_KEYS, SAMPLING_KEYS } from "./appearance.ts";
import type { MediaPlan, GroupPlan, UnitPlan, LayerPlan, Sampling, Direction, HandoffPlan } from "./types.ts";
import { mediaTrackTypes } from "./types.ts";
import { validateMediaPlan } from "./validate.ts";
const SOURCE_ATTRIBUTES = ["image", "media", "surface", "extent"];
const INSTANT_ATTRIBUTES = ["at", "instant", "boundary", "selection", "segment", "moment"];
export const MEDIA_ATTRIBUTES: Record<string, string[]> = {
  Track: ["id", "timeline", "canvas"], Item: ["id", "frame", "appearance", "motion", "clip", ...SOURCE_ATTRIBUTES, "source-audio", "audio-gain", ...WINDOW_ATTRIBUTES.filter(k => k !== "window")],
  Sequence: ["id", "frame", "appearance", "motion", "clip", "until", "until-boundary"], Member: ["id", ...SOURCE_ATTRIBUTES, "appearance", "source-audio", "audio-gain", ...INSTANT_ATTRIBUTES],
  Layer: ["id", ...SOURCE_ATTRIBUTES, "appearance"], Paint: ["id", "appearance"], Sampling: ["at", "zoom", "x", "y", "rotate", "easing"], Handoff: ["id", "from", "transition"], Sound: ["id", "source", "at", "handoff", "gain"],
};
export function decodeInstant(a: Record<string, Attribute>, element: ElementNode, ctx: ElaborationContext, terminal = false): InstantExpression {
  const point = a[terminal ? "until" : "at"], boundary = a[terminal ? "until-boundary" : "boundary"];
  if (point && a.instant) ctx.fail("MEDIA_INSTANT", "at and instant are exclusive.", element.span);
  if (point) {
    if (!terminal && ["selection", "segment", "moment"].some(k => a[k])) ctx.fail("MEDIA_INSTANT", "at forbids unused semantic bindings.", element.span);
    if (point.value.kind === "literal") { if (!isTimeLiteral(point.value.text) || boundary) ctx.fail("MEDIA_INSTANT", "Absolute point requires a time literal and no boundary.", point.span); return { kind: "at", source: point.value.text }; }
    const b = ctx.lookup(point.value.name, point.span);
    if (b.kind !== "record" || ![timelineTypes.moment, timelineTypes.selection, timelineTypes.segment].includes(b.type as typeof timelineTypes.moment)) ctx.fail("MEDIA_INSTANT", "Point requires static semantic reference.", point.span);
    const source = b.value.data as unknown as SemanticRef;
    if (source.kind === "moment") { if (boundary) ctx.fail("MEDIA_INSTANT", "Moment forbids boundary.", boundary.span); return { kind: "at", source }; }
    const edge = boundary ? literal(a, terminal ? "until-boundary" : "boundary", element, ctx) : terminal ? "end" : undefined;
    if (edge !== "start" && edge !== "end") ctx.fail("MEDIA_INSTANT", "Selection/Segment activation requires explicit boundary.", point.span);
    return { kind: "at-boundary", source, boundary: edge };
  }
  if (terminal || !a.instant || boundary) ctx.fail("MEDIA_INSTANT", "An activation point is required.", element.span);
  const expression = literal(a, "instant", element, ctx), kind = /^(selection|segment|moment)\./.exec(expression)?.[1];
  const present = ["selection", "segment", "moment"].filter(k => a[k]);
  if (present.length !== (kind ? 1 : 0) || kind && !a[kind]) ctx.fail("MEDIA_INSTANT", "Expression semantic bindings must match exactly.", element.span);
  if (!kind) return { kind: "expression", expression };
  const binding = reference(a, kind, [timelineTypes[kind as "selection" | "segment" | "moment"]], element, ctx);
  if (binding.kind !== "record") ctx.fail("MEDIA_INSTANT", "Semantic binding must be static.", element.span);
  return { kind: "expression", expression, source: binding.value.data as unknown as SemanticRef };
}
export function decodeMediaTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, MEDIA_ATTRIBUTES.Track!);
  const id = literal(attrs, "id", element, ctx), timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx), canvas = reference(attrs, "canvas", [spaceTypes.canvas], element, ctx);
  const plan: MediaPlan = { trackKey: entityIdentity(ctx.file, id), groups: [], hasAudio: false };
  const inputs: Record<string, Binding[]> = { frames: [], images: [], media: [], surfaces: [], extents: [], clips: [], windows: [] };
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  const ids = new Set<string>();
  function children(e: ElementNode): ElementNode[] { const list: ElementNode[] = []; for (const c of e.children) { if (c.kind === "text" && !c.text.trim()) continue; if (c.kind !== "element" || !c.tag.startsWith(prefix)) ctx.fail("MEDIA_CHILD", "Only component children and whitespace are allowed.", c.span); list.push(c); } return list; }
  function tag(e: ElementNode): string { return e.tag.slice(prefix.length); }
  function identity(a: Record<string, Attribute>, e: ElementNode, parent: string, sequence: number): string { const value = a.id ? literal(a, "id", e, ctx) : `${tag(e).toLowerCase()}-${String(sequence + 1).padStart(4, "0")}`; const key = `${parent}/${value}`; if (ids.has(key)) ctx.fail("MEDIA_DUPLICATE", `Duplicate identity '${value}'.`, e.span); ids.add(key); return value; }
  function recipe(a: Record<string, Attribute>, e: ElementNode, name: string): Record<string, Json> { const b = reference(a, name, [RECIPE], e, ctx); if (b.kind !== "record") ctx.fail("MEDIA_RECIPE", "Recipe must be available at author compilation.", e.span); validateRecipe(b.value.data); return { ...b.value.data.properties }; }
  function add(a: Record<string, Attribute>, e: ElementNode, name: string, port: string, type: string): number { inputs[port]!.push(reference(a, name, [type], e, ctx)); return inputs[port]!.length - 1; }
  function sampling(e: ElementNode): Sampling[] {
    const keys = children(e).map(c => { if (tag(c) !== "Sampling") ctx.fail("MEDIA_CHILD", "Source accepts only Sampling.", c.span); const { attrs: a } = structured(c, ctx, MEDIA_ATTRIBUTES.Sampling!); empty(c, ctx); const at = literal(a, "at", c, ctx); const value = at === "start" ? 0 : at === "end" ? 1 : /^\d+(?:\.\d+)?%$/.test(at) ? Number(at.slice(0, -1)) / 100 : NaN; finite(value, 0, 1); const s: Sampling = { at: value, zoom: a.zoom ? Number(literal(a, "zoom", c, ctx)) : 1, x: a.x ? Number(literal(a, "x", c, ctx)) : 0, y: a.y ? Number(literal(a, "y", c, ctx)) : 0, rotate: a.rotate ? Number(literal(a, "rotate", c, ctx)) : 0 }; finite(s.zoom, Number.MIN_VALUE); finite(s.x); finite(s.y); finite(s.rotate); if (a.easing) { const easing = literal(a, "easing", c, ctx); if (!["linear", "ease-in", "ease-out", "ease-in-out"].includes(easing)) ctx.fail("MEDIA_SAMPLING", "Invalid sampling easing.", c.span); s.easing = easing as Sampling["easing"]; } return s; });
    if (keys.length && (keys[0]!.at !== 0 || keys.at(-1)!.at !== 1 || keys.some((k, i) => i > 0 && k.at <= keys[i - 1]!.at))) ctx.fail("MEDIA_SAMPLING", "Sampling keys must increase and cover start through end.", e.span); return keys;
  }
  function source(e: ElementNode, a: Record<string, Attribute>, layerId: string, properties: Record<string, Json>): LayerPlan {
    const kinds = ["image", "media", "surface"].filter(k => a[k]); if (kinds.length !== 1) ctx.fail("MEDIA_SOURCE", "A source must choose exactly one image/media/surface.", e.span);
    const kind = kinds[0]! as "image" | "media" | "surface", port = kind === "image" ? "images" : kind === "surface" ? "surfaces" : "media";
    const p: LayerPlan = { id: layerId, kind, sourceIndex: add(a, e, kind, port, kind === "image" ? "dsivio-video/media@1#Image" : kind === "surface" ? renderTypes.surface : timelineTypes.media), properties, sampling: sampling(e) };
    if (kind === "image") p.extentIndex = add(a, e, "extent", "extents", spaceTypes.extent); else if (a.extent) ctx.fail("MEDIA_EXTENT", "Only image sources accept extent.", e.span); return p;
  }
  function unit(e: ElementNode, a: Record<string, Attribute>, parent: string, unitId: string, inherited: Record<string, Json>, directProperties: Record<string, Json>): UnitPlan {
    const p: UnitPlan = { id: unitId, layers: [], properties: directProperties, audioGain: a["audio-gain"] ? Number(literal(a, "audio-gain", e, ctx)) : 1 }; finite(p.audioGain, 0, 64);
    if (a["source-audio"]) { p.sourceAudio = literal(a, "source-audio", e, ctx); plan.hasAudio = true; } else if (a["audio-gain"]) ctx.fail("MEDIA_AUDIO", "audio-gain requires source-audio.", e.span);
    const direct = ["image", "media", "surface"].some(k => a[k]);
    if (tag(e) === "Member" && children(e).some(c => tag(c) === "Sound")) ctx.fail("MEDIA_CHILD", "Member cannot contain Sound.", e.span);
    const contentChildren = children(e).filter(c => tag(c) !== "Sound");
    if (direct) { if (contentChildren.some(c => tag(c) !== "Sampling")) ctx.fail("MEDIA_SOURCE", "Direct source and Paint/Layer cannot mix.", e.span); const fake: ElementNode = { ...e, children: contentChildren }; p.layers.push(source(fake, a, "content", directProperties)); }
    else { if (a.extent) ctx.fail("MEDIA_EXTENT", "extent needs an image source.", e.span); for (const [i, child] of contentChildren.entries()) { const t = tag(child); if (t !== "Layer" && t !== "Paint") ctx.fail("MEDIA_CHILD", "Layer form accepts Paint/Layer only.", child.span); const { attrs: ca } = structured(child, ctx, MEDIA_ATTRIBUTES[t]!); const layerId = identity(ca, child, `${parent}/${unitId}`, i); const properties = ca.appearance ? recipe(ca, child, "appearance") : inherited; if (t === "Paint") { empty(child, ctx); if (!ca.appearance) ctx.fail("MEDIA_PAINT", "Paint requires appearance.", child.span); p.layers.push({ id: layerId, kind: "paint", sourceIndex: 0, properties, sampling: [] }); } else p.layers.push(source(child, ca, layerId, properties)); } if (!p.layers.length) ctx.fail("MEDIA_SOURCE", "Unit requires a source or at least one Paint/Layer.", e.span); }
    if (p.sourceAudio && !p.layers.some(l => l.id === p.sourceAudio && l.kind === "media")) ctx.fail("MEDIA_AUDIO", "source-audio must select an existing normalized media layer (content for direct source).", e.span);
    return p;
  }
  for (const [index, e] of children(element).entries()) {
    const t = tag(e); if (t !== "Item" && t !== "Sequence") ctx.fail("MEDIA_CHILD", "Track accepts Item/Sequence only.", e.span);
    const { attrs: a } = structured(e, ctx, MEDIA_ATTRIBUTES[t]!); const groupId = identity(a, e, id, index), groupKey = entityIdentity(ctx.file, `${id}/${groupId}`);
    const properties = recipe(a, e, "appearance"), inherited = Object.fromEntries(Object.entries(properties).filter(([k]) => [...FIT_KEYS, ...SAMPLING_KEYS].includes(k)));
    const g: GroupPlan = { id: groupKey, frameIndex: add(a, e, "frame", "frames", spaceTypes.frame), properties, motion: a.motion ? parseMotion(recipe(a, e, "motion")) : parseMotion({}), units: [], handoffs: [], sounds: [] };
    if (a.clip) { if (properties.clip !== undefined) ctx.fail("MEDIA_CLIP", "Path clip and appearance clip cannot both be declared.", e.span); properties.clip = "none"; g.clipIndex = add(a, e, "clip", "clips", spaceTypes.path); }
    const sounds = children(e).filter(c => tag(c) === "Sound");
    if (t === "Item") { if (!["during", "at", "until", "start"].some(k => a[k])) ctx.fail("MEDIA_WINDOW", "Item requires a complete W window.", e.span); const expression = decodeWindowAttributes(e, ctx); inputs.windows!.push(publishWindow(timeline, expression, groupKey, ctx, e.span)); g.windowIndex = inputs.windows!.length - 1; g.units.push(unit(e, a, groupId, "content", inherited, properties)); }
    else {
      g.until = decodeInstant(a, e, ctx, true);
      for (const [i, c] of children(e).filter(c => tag(c) !== "Sound").entries()) {
        const ct = tag(c); if (ct !== "Member" && ct !== "Handoff") ctx.fail("MEDIA_CHILD", "Sequence accepts Member/Handoff/Sound only.", c.span); const { attrs: ca } = structured(c, ctx, MEDIA_ATTRIBUTES[ct]!); const childId = identity(ca, c, groupId, i);
        if (ct === "Member") {
          const props = ca.appearance ? recipe(ca, c, "appearance") : properties;
          if (g.clipIndex !== undefined && ca.appearance) { if (props.clip !== undefined) ctx.fail("MEDIA_CLIP", "Path clip and Member appearance clip cannot both be declared.", c.span); props.clip = "none"; }
          const layerProps = Object.fromEntries(Object.entries(props).filter(([k]) => [...FIT_KEYS, ...SAMPLING_KEYS].includes(k)));
          const u = unit(c, ca, groupId, childId, layerProps, props); u.instant = decodeInstant(ca, c, ctx); g.units.push(u);
        }
        else { empty(c, ctx); const transition = recipe(ca, c, "transition"); if (Object.keys(transition).some(k => !["operator", "duration-frames", "boundary-ratio", "direction", "audio"].includes(k))) ctx.fail("MEDIA_TRANSITION", "Unknown transition property.", c.span); const h: HandoffPlan = { id: childId, from: literal(ca, "from", c, ctx), operator: transition.operator as HandoffPlan["operator"], duration: transition["duration-frames"] as number, ratio: (transition["boundary-ratio"] ?? .5) as number, audio: (transition.audio ?? "cut") as HandoffPlan["audio"] }; if (transition.direction !== undefined) h.direction = transition.direction as Direction; g.handoffs.push(h); }
      }
    }
    for (const [i, c] of sounds.entries()) { const { attrs: ca } = structured(c, ctx, MEDIA_ATTRIBUTES.Sound!); empty(c, ctx); const soundId = identity(ca, c, groupId, i); if (Boolean(ca.at) === Boolean(ca.handoff) || t === "Item" && ca.handoff) ctx.fail("MEDIA_SOUND", "Sound needs exactly one valid at/handoff trigger.", c.span); const s: GroupPlan["sounds"][number] = { id: soundId, sourceIndex: add(ca, c, "source", "media", timelineTypes.media), gain: ca.gain ? Number(literal(ca, "gain", c, ctx)) : 1 }; finite(s.gain, 0, 64); if (ca.at) { const at = literal(ca, "at", c, ctx); if (at !== "enter" && at !== "exit") ctx.fail("MEDIA_SOUND", "Sound at is enter or exit.", c.span); s.at = at; } else s.handoff = literal(ca, "handoff", c, ctx); g.sounds.push(s); plan.hasAudio = true; }
    plan.groups.push(g);
  }
  validateMediaPlan(plan);
  const p = ctx.record(null, { type: mediaTrackTypes.plan, data: plan as unknown as Json }, element.span), key = ctx.record(null, { type: timelineTypes.consumerKey, data: plan.trackKey }, element.span);
  const output = ctx.operation({ producer: "dsivio-video/media-track@1#program", inputs: { key, timeline, canvas, plan: p, ...inputs }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/media-track@1#visual", inputs: { program: output.program! }, publish: { visual: `${id}.visual` }, label: id, span: element.span });
  if (plan.hasAudio) ctx.operation({ producer: "dsivio-video/media-track@1#audio", inputs: { program: output.program! }, publish: { audio: `${id}.audio` }, label: id, span: element.span });
}
