import { DvError } from "../../core/errors.ts";
import type { SourceSpan } from "../../core/errors.ts";
import type { Binding, ElaborationContext, ModuleDef, ProducerInputs, SurfaceDef } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { assembleTimeline, parseClock } from "../../timeline/timeline.ts";
import { consumeWindow, isTimeLiteral, projectInstant, projectWindow } from "../../timeline/temporal.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { InstantExpression, PlacementPlan, SemanticRef, WindowExpression } from "../../timeline/types.ts";
import { object, text, validateClockData, validateInstant, validateMomentRef, validatePlacementPlan, validateSegmentRef, validateSelectionRef, validateSemanticTake, validateTimeline, validateWindow } from "../../timeline/validate.ts";

export const WINDOW_ATTRIBUTES = ["during", "at", "until", "for", "start", "end", "selection", "segment", "moment", "start-source", "end-source", "window"] as const;
function attributes(element: ElementNode | RawElement, ctx: ElaborationContext, allowed?: readonly string[]): Record<string, Attribute> {
  const result: Record<string, Attribute> = Object.create(null);
  for (const a of element.attributes) { if (Object.hasOwn(result, a.name) || allowed && !allowed.includes(a.name)) ctx.fail("TIME_ATTRIBUTE", `Unknown or duplicate attribute '${a.name}'`, a.span); result[a.name] = a; }
  return result;
}
function literal(attr: Attribute | undefined, name: string, ctx: ElaborationContext, span: SourceSpan): string {
  if (!attr || attr.value.kind !== "literal" || !attr.value.text.trim()) ctx.fail("TIME_ATTRIBUTE", `'${name}' requires a nonempty literal`, attr?.span ?? span); return attr.value.text;
}
function binding(attr: Attribute, types: readonly string[], ctx: ElaborationContext): Binding {
  if (attr.value.kind !== "ref") ctx.fail("TIME_REFERENCE", `'${attr.name}' requires a typed reference`, attr.span); const value = ctx.lookup(attr.value.name, attr.value.span); if (!types.includes(value.type)) ctx.fail("TIME_REFERENCE", `'${attr.name}' requires ${types.join(" or ")}`, attr.span); return value;
}
function semantic(attr: Attribute, ctx: ElaborationContext): SemanticRef {
  const value = binding(attr, [timelineTypes.segment, timelineTypes.selection, timelineTypes.moment], ctx);
  if (value.kind !== "record") ctx.fail("TIME_REFERENCE", "Semantic references must be static author values", attr.span);
  const data = value.value.data; if (value.type === timelineTypes.segment) validateSegmentRef(data); else if (value.type === timelineTypes.selection) validateSelectionRef(data); else validateMomentRef(data); return data;
}
function pointSource(attr: Attribute, ctx: ElaborationContext): InstantExpression["source"] {
  if (attr.value.kind === "literal") { if (!isTimeLiteral(attr.value.text)) ctx.fail("TIME_LITERAL", "Point requires a single explicit-unit time literal", attr.span); return attr.value.text; }
  return semantic(attr, ctx);
}
/** Decodes only temporal attributes; caller owns its non-temporal whitelist. */
export function decodeWindowAttributes(element: ElementNode | RawElement, ctx: ElaborationContext): WindowExpression | Binding {
  const all = attributes(element, ctx); const attrs: Record<string, Attribute> = Object.create(null); for (const key of WINDOW_ATTRIBUTES) if (all[key]) attrs[key] = all[key]!;
  const keys = Object.keys(attrs); const only = (allowed: string[]) => { if (keys.some(k => !allowed.includes(k))) ctx.fail("TIME_FORM", "Window forms and bindings cannot be mixed or left unused", element.span); };
  if (!keys.length) return { kind: "during", source: "program" };
  if (attrs.window) { only(["window"]); return binding(attrs.window, [timelineTypes.window], ctx); }
  if (attrs.during) { only(["during"]); const source = attrs.during.value.kind === "literal" ? literal(attrs.during, "during", ctx, element.span) : semantic(attrs.during, ctx); if (source !== "program" && (typeof source === "string" || source.kind === "moment")) ctx.fail("TIME_FORM", "during requires program, SegmentRef or SelectionRef", attrs.during.span); return { kind: "during", source }; }
  if (attrs.at || attrs.until) {
    const kind = attrs.at ? "at" : "until"; only([kind, "for"]); const source = pointSource(attrs[kind]!, ctx); if (typeof source !== "string" && source?.kind !== "moment") ctx.fail("TIME_FORM", "at/for and until/for accept only literals or MomentRef", element.span);
    const duration = literal(attrs.for, "for", ctx, element.span); if (!isTimeLiteral(duration)) ctx.fail("TIME_LITERAL", "for requires an explicit-unit duration", element.span); return { kind, source: source!, duration };
  }
  only(["start", "end", "selection", "segment", "moment", "start-source", "end-source"]);
  const start = literal(attrs.start, "start", ctx, element.span); const end = literal(attrs.end, "end", ctx, element.span);
  const named = ["selection", "segment", "moment"].filter(k => attrs[k]); if (named.length > 1 || named.length && (attrs["start-source"] || attrs["end-source"])) ctx.fail("TIME_BINDING", "Use one named binding or independent endpoint sources", element.span);
  const common = named.length ? semantic(attrs[named[0]!]!, ctx) : undefined;
  if (common && common.kind !== named[0]) ctx.fail("TIME_BINDING", "Named binding has the wrong semantic type", element.span);
  const startSource = attrs["start-source"] ? semantic(attrs["start-source"], ctx) : common && start.startsWith(`${common.kind}.`) ? common : undefined;
  const endSource = attrs["end-source"] ? semantic(attrs["end-source"], ctx) : common && end.startsWith(`${common.kind}.`) ? common : undefined;
  if (common && !startSource && !endSource) ctx.fail("TIME_BINDING", "Unused semantic binding", element.span);
  return { kind: "edges", start, end, ...(startSource ? { startSource } : {}), ...(endSource ? { endSource } : {}) };
}
export function publishWindow(timeline: Binding, expression: WindowExpression | Binding, consumerKey: string, ctx: ElaborationContext, span: SourceSpan, publicName?: string): Binding {
  const consumer = ctx.record(null, { type: timelineTypes.consumerKey, data: consumerKey }, span);
  const publish: Record<string, string> = publicName === undefined ? {} : { window: publicName };
  if ("type" in expression) return ctx.operation({ producer: "dsivio-video/time@1#consume-window", inputs: { timeline, window: expression, consumer }, publish, label: consumerKey, span }).window!;
  const parameter = ctx.record(null, { type: timelineTypes.windowExpression, data: expression }, span);
  return ctx.operation({ producer: "dsivio-video/time@1#window", inputs: { timeline, expression: parameter, consumer }, publish, label: consumerKey, span }).window!;
}
function input(inputs: ProducerInputs, key: string): Json {
  const value = inputs[key]; if (!value || Array.isArray(value) || !("data" in value)) throw new DvError("TIME_INPUT", `Missing materialized input '${key}'`); return value.data;
}
function validateInstantExpression(data: unknown): asserts data is InstantExpression {
  const d = object(data); if (d.kind === "at") { if (typeof d.source === "string") { if (!isTimeLiteral(d.source)) throw new DvError("TYPE_INVALID", "Invalid time literal"); } else validateMomentRef(d.source); }
  else if (d.kind === "at-boundary") { const source = object(d.source); if (source.kind === "segment") validateSegmentRef(source); else validateSelectionRef(source); if (d.boundary !== "start" && d.boundary !== "end") throw new DvError("TYPE_INVALID", "Invalid boundary"); }
  else if (d.kind === "expression") {
    text(d.expression);
    const point = /^(program\.(?:start|end)|selection\.(?:start|end)|segment\.(?:start|end)|moment\.cue)(?:[+-](\d+(?:\.\d+)?(?:f|ms|s)))?$/.exec(d.expression);
    if (!isTimeLiteral(d.expression) && !point) throw new DvError("TYPE_INVALID", "Invalid point expression");
    if (point?.[2] && !isTimeLiteral(point[2])) throw new DvError("TYPE_INVALID", "Invalid point offset");
    const semanticKind = point && !point[1]!.startsWith("program.") ? point[1]!.split(".")[0] : undefined;
    if (d.source !== undefined) {
      const source = object(d.source);
      if (source.kind === "segment") validateSegmentRef(source); else if (source.kind === "selection") validateSelectionRef(source); else validateMomentRef(source);
      if (source.kind !== semanticKind) throw new DvError("TYPE_INVALID", "Unused or mismatched semantic binding");
    } else if (semanticKind) throw new DvError("TYPE_INVALID", "Missing semantic binding");
  }
  else throw new DvError("TYPE_INVALID", "Invalid InstantExpression");
}
function validateWindowExpression(data: unknown): asserts data is WindowExpression {
  const d = object(data); if (d.kind === "during") { if (d.source !== "program") { const s = object(d.source); if (s.kind === "segment") validateSegmentRef(s); else validateSelectionRef(s); } }
  else if (d.kind === "at" || d.kind === "until") { validateInstantExpression({ kind: "at", source: d.source }); if (!isTimeLiteral(d.duration)) throw new DvError("TYPE_INVALID", "Invalid duration"); }
  else if (d.kind === "edges") { validateInstantExpression({ kind: "expression", expression: d.start, ...(d.startSource !== undefined ? { source: d.startSource } : {}) }); validateInstantExpression({ kind: "expression", expression: d.end, ...(d.endSource !== undefined ? { source: d.endSource } : {}) }); }
  else throw new DvError("TYPE_INVALID", "Invalid WindowExpression");
}
const timelineSurface: SurfaceDef = {
  mode: "structured", doc: { summary: "Places semantic takes without changing their media or word clocks. Gaps, overlap and declaration reordering are explicit; placements require exact integer frame boundaries.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Public timeline name." }, { name: "clock", required: false, accepts: timelineTypes.clock, summary: "Clock; mutually exclusive with frame-rate." }, { name: "frame-rate", required: false, accepts: "integer ratio", summary: "Inline clock." }, { name: "end", required: false, accepts: "time expression", summary: "Absolute time or content.end with one offset." }], children: [{ tag: "Take", summary: "Semantic media placement, at defaults to previous.end (first 0f).", repeat: true }], outputs: [{ name: "", type: timelineTypes.timeline, summary: "Timeline." }] },
  elaborate(element, ctx: ElaborationContext) {
    if (element.kind !== "element") ctx.fail("TIME_CHILD", "Timeline requires structured markup", element.span); const attrs = attributes(element, ctx, ["id", "clock", "frame-rate", "end"]); const id = literal(attrs.id, "id", ctx, element.span);
    if (!!attrs.clock === !!attrs["frame-rate"]) ctx.fail("TIME_CLOCK", "Timeline requires exactly one clock or frame-rate", element.span);
    const clock = attrs.clock ? binding(attrs.clock, [timelineTypes.clock], ctx) : ctx.record(null, { type: timelineTypes.clock, data: parseClock(literal(attrs["frame-rate"], "frame-rate", ctx, element.span)) }, element.span);
    const takes: Binding[] = []; const plan: PlacementPlan = { timelineKey: entityIdentity(ctx.file, id), placements: [] }; const prefix = element.tag.slice(0, element.tag.lastIndexOf(":") + 1);
    for (const child of element.children) {
      if (child.kind === "text" && !child.text.trim()) continue;
      if (child.kind !== "element" || child.tag !== `${prefix}Take` || child.children.some(c => c.kind !== "text" || c.text.trim())) ctx.fail("TIME_CHILD", "Timeline accepts only empty Take declarations", child.span);
      const a = attributes(child, ctx, ["id", "source", "at"]); if (!a.source) ctx.fail("TIME_REFERENCE", "Take requires source", child.span); takes.push(binding(a.source, [timelineTypes.take], ctx));
      const localId = a.id ? literal(a.id, "id", ctx, child.span) : id; plan.placements.push({ placementKey: entityIdentity(ctx.file, `${id}/${localId}`, plan.placements.length), ...(a.at ? { at: literal(a.at, "at", ctx, child.span) } : {}) });
    }
    if (!takes.length && !attrs.end) ctx.fail("TIMELINE_EMPTY", "Timeline requires a Take or explicit end", element.span);
    const placements = ctx.record(null, { type: timelineTypes.placementPlan, data: plan }, element.span); const end = attrs.end ? ctx.record(null, { type: timelineTypes.endExpression, data: literal(attrs.end, "end", ctx, element.span) }, element.span) : undefined;
    ctx.operation({ producer: "dsivio-video/time@1#assemble", inputs: { clock, takes, placements, ...(end ? { end } : {}) }, publish: { timeline: id }, label: id, span: element.span });
  },
};
const windowSurface: SurfaceDef = {
  mode: "structured", doc: { summary: "Projects a semantic or absolute half-open Window onto one Timeline; exact arithmetic, then half-up frame quantization.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Public window name." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Program axis." }, ...WINDOW_ATTRIBUTES.map(name => ({ name, required: false, accepts: "time literal or semantic reference", summary: "during, at+for, until+for, start+end, or a shared window; forms cannot mix." }))], outputs: [{ name: "", type: timelineTypes.window, summary: "Window with per-endpoint author provenance." }] },
  elaborate(element, ctx: ElaborationContext) {
    if (element.kind !== "element" || element.children.some(c => c.kind !== "text" || c.text.trim())) ctx.fail("TIME_CHILD", "Window must be empty", element.span);
    const a = attributes(element, ctx, ["id", "timeline", ...WINDOW_ATTRIBUTES]);
    const id = literal(a.id, "id", ctx, element.span);
    if (!a.timeline) ctx.fail("TIME_REFERENCE", "Window requires timeline", element.span);
    publishWindow(binding(a.timeline, [timelineTypes.timeline], ctx), decodeWindowAttributes(element, ctx), entityIdentity(ctx.file, id), ctx, element.span, id);
  },
};
const instantSurface: SurfaceDef = {
  mode: "structured", doc: { summary: "Projects one point; Segment/Selection at requires an explicit boundary.", attributes: ["id", "timeline", "at", "boundary", "instant", "selection", "segment", "moment"].map(name => ({ name, required: name === "id" || name === "timeline", accepts: name === "timeline" ? timelineTypes.timeline : "literal or semantic reference", summary: "at plus optional boundary, or instant expression and its used binding." })), outputs: [{ name: "", type: timelineTypes.instant, summary: "Instant with provenance." }] },
  elaborate(element, ctx: ElaborationContext) {
    if (element.kind !== "element" || element.children.some(c => c.kind !== "text" || c.text.trim())) ctx.fail("TIME_CHILD", "Instant must be empty", element.span); const a = attributes(element, ctx, ["id", "timeline", "at", "boundary", "instant", "selection", "segment", "moment"]); const id = literal(a.id, "id", ctx, element.span); if (!a.timeline || !!a.at === !!a.instant) ctx.fail("TIME_FORM", "Instant requires timeline and exactly one at or instant", element.span); let expression: InstantExpression;
    const named = ["selection", "segment", "moment"].filter(k => a[k]);
    if (a.at) { if (named.length) ctx.fail("TIME_BINDING", "at cannot have unused semantic bindings", element.span); const source = pointSource(a.at, ctx); if (typeof source === "string" || source?.kind === "moment") { if (a.boundary) ctx.fail("TIME_FORM", "Only ranges require boundary", element.span); expression = { kind: "at", source }; } else { const boundary = literal(a.boundary, "boundary", ctx, element.span); if (boundary !== "start" && boundary !== "end") ctx.fail("TIME_FORM", "boundary requires start or end", element.span); expression = { kind: "at-boundary", source: source!, boundary }; } }
    else { if (a.boundary || named.length > 1) ctx.fail("TIME_BINDING", "Invalid expression bindings", element.span); const source = named.length ? semantic(a[named[0]!]!, ctx) : undefined; const value = literal(a.instant, "instant", ctx, element.span); if (source && (!value.startsWith(`${source.kind}.`) || source.kind !== named[0])) ctx.fail("TIME_BINDING", "Unused or wrong expression binding", element.span); expression = { kind: "expression", expression: value, ...(source ? { source } : {}) }; }
    const parameter = ctx.record(null, { type: timelineTypes.instantExpression, data: expression }, element.span); const consumer = ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, element.span); ctx.operation({ producer: "dsivio-video/time@1#instant", inputs: { timeline: binding(a.timeline, [timelineTypes.timeline], ctx), expression: parameter, consumer }, publish: { instant: id }, label: id, span: element.span });
  },
};
const timeModule: ModuleDef = {
  id: "dsivio-video/time@1", summary: "Semantic take assembly and author-aware time projection.",
  types: {
    Timeline: { summary: "Ordered placements and exact integer program extent.", validate: validateTimeline }, Instant: { summary: "Projected point and editing provenance.", validate: validateInstant }, Window: { summary: "Positive half-open temporal interval.", validate: validateWindow }, ConsumerKey: { summary: "Qualified consumer identity.", validate: text },
    PlacementPlan: { summary: "Authored timeline identity and static declaration metadata paired with typed takes.", validate: validatePlacementPlan },
    EndExpression: { summary: "Authored program end expression.", validate: text }, InstantExpression: { summary: "Typed instant author plan.", validate: validateInstantExpression }, WindowExpression: { summary: "Typed window author plan.", validate: validateWindowExpression },
  },
  surfaces: { Timeline: timelineSurface, Window: windowSurface, Instant: instantSurface, Take: { mode: "structured", doc: { summary: "Timeline-only placement declaration.", attributes: [{ name: "source", required: true, accepts: timelineTypes.take, summary: "SemanticTake." }, { name: "id", required: false, accepts: "text", summary: "Placement identity." }, { name: "at", required: false, accepts: "time expression", summary: "Absolute or previous.end plus one duration." }], outputs: [] }, elaborate(element, ctx) { ctx.fail("TIME_CHILD", "Take is only valid within Timeline", element.span); } } },
  producers: {
    assemble: {
      inputs: { clock: { type: timelineTypes.clock }, takes: { type: timelineTypes.take, list: true }, placements: { type: timelineTypes.placementPlan }, end: { type: timelineTypes.endExpression, optional: true } },
      outputs: { timeline: timelineTypes.timeline },
      run(inputs) {
        const clock = input(inputs, "clock"); validateClockData(clock);
        const plan = input(inputs, "placements"); validatePlacementPlan(plan);
        const takes = inputs.takes; if (!Array.isArray(takes)) throw new DvError("TIME_INPUT", "takes must be a typed list");
        const data = takes.map(v => { if (!("data" in v)) throw new DvError("TIME_INPUT", "Take is pending"); validateSemanticTake(v.data); return v.data; });
        const end = inputs.end ? input(inputs, "end") : undefined; if (end !== undefined) text(end);
        return { outputs: { timeline: { type: timelineTypes.timeline, data: assembleTimeline(clock, data, plan, end) as unknown as Json } } };
      },
    },
    window: { inputs: { timeline: { type: timelineTypes.timeline }, expression: { type: timelineTypes.windowExpression }, consumer: { type: timelineTypes.consumerKey } }, outputs: { window: timelineTypes.window }, run(inputs) { const timeline = input(inputs, "timeline"); validateTimeline(timeline); const expression = input(inputs, "expression"); validateWindowExpression(expression); const consumer = input(inputs, "consumer"); text(consumer); return { outputs: { window: { type: timelineTypes.window, data: projectWindow(timeline, expression, consumer) } } }; } },
    instant: { inputs: { timeline: { type: timelineTypes.timeline }, expression: { type: timelineTypes.instantExpression }, consumer: { type: timelineTypes.consumerKey } }, outputs: { instant: timelineTypes.instant }, run(inputs) { const timeline = input(inputs, "timeline"); validateTimeline(timeline); const expression = input(inputs, "expression"); validateInstantExpression(expression); const consumer = input(inputs, "consumer"); text(consumer); return { outputs: { instant: { type: timelineTypes.instant, data: projectInstant(timeline, expression, consumer) } } }; } },
    "consume-window": { inputs: { timeline: { type: timelineTypes.timeline }, window: { type: timelineTypes.window }, consumer: { type: timelineTypes.consumerKey } }, outputs: { window: timelineTypes.window }, run(inputs) { const timeline = input(inputs, "timeline"); validateTimeline(timeline); const window = input(inputs, "window"); validateWindow(window); const consumer = input(inputs, "consumer"); text(consumer); return { outputs: { window: { type: timelineTypes.window, data: consumeWindow(timeline, window, consumer) } } }; } },
  },
};
export default timeModule;
