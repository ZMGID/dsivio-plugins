import { DvError } from "../core/errors.ts";
import type { Clock, Instant, InstantExpression, InstantOrigin, SemanticRef, TimeLiteral, Timeline, Window, WindowExpression, Bounds } from "./types.ts";
import { validateTimeline, validateWindow, validateSegmentRef, validateSelectionRef, validateMomentRef, validateClockData, text } from "./validate.ts";

export type ExactFrames = { numerator: bigint; denominator: bigint };
export function durationFrames(source: string, clock: Clock): ExactFrames {
  validateClockData(clock);
  const match = /^(\d+)(?:\.(\d+))?(f|ms|s)$/.exec(source);
  if (!match || match[2] !== undefined && match[3] !== "s") throw new DvError("TIME_LITERAL", `Invalid time literal '${source}'`);
  const fraction = match[2] ?? ""; let numerator = BigInt(match[1]! + fraction); let denominator = 10n ** BigInt(fraction.length);
  if (match[3] !== "f") { numerator *= BigInt(clock.fps.numerator); denominator *= BigInt(clock.fps.denominator) * (match[3] === "ms" ? 1000n : 1n); }
  return { numerator, denominator };
}
export function exactFrame(value: ExactFrames): number {
  if (value.numerator < 0n || value.numerator % value.denominator !== 0n) throw new DvError("TIME_FRAME_BOUNDARY", "Time must be a nonnegative exact integer frame boundary");
  const result = value.numerator / value.denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new DvError("TIME_OVERFLOW", "Time exceeds the safe integer frame domain");
  return Number(result);
}
export function offsetFrames(base: number, literal: string, sign: string, clock: Clock): ExactFrames {
  const value = durationFrames(literal, clock); return { numerator: BigInt(base) * value.denominator + (sign === "-" ? -value.numerator : value.numerator), denominator: value.denominator };
}
function anchorFrame(timeline: Timeline, ref: SemanticRef, edge: "start" | "end" | "cue"): number {
  if (ref.kind === "segment") {
    validateSegmentRef(ref);
    const placed = timeline.placements.find(p => p.take.segment.segmentKey === ref.segmentKey)?.take.segment;
    if (!placed || placed.storyKey !== ref.storyKey || placed.tokenBounds.start !== ref.tokenBounds.start || placed.tokenBounds.end !== ref.tokenBounds.end || placed.anchors.start !== ref.anchors.start || placed.anchors.end !== ref.anchors.end) throw new DvError("TIME_SEGMENT", "Segment reference does not match a complete placed segment");
  } else if (ref.kind === "selection") validateSelectionRef(ref);
  else validateMomentRef(ref);
  if (ref.storyKey !== timeline.storyKey) throw new DvError("TIME_STORY", "Semantic reference belongs to a different Narrative");
  const key = ref.kind === "moment" ? ref.anchorKey : ref.anchors[edge === "end" ? "end" : "start"];
  if (timeline.storyAnchors?.start === key) return 0;
  if (timeline.storyAnchors?.end === key) return timeline.totalFrames;
  for (const p of timeline.placements) { const frame = p.take.anchorFrames[key]; if (frame !== undefined) return p.offsetFrames + frame; }
  throw new DvError("TIME_ANCHOR", `Timeline does not contain anchor '${key}'`);
}
function resolvePoint(timeline: Timeline, expression: string, source?: SemanticRef): { value: ExactFrames; origin: InstantOrigin } {
  if (/^\d/.test(expression)) { if (source) throw new DvError("TIME_BINDING", "Absolute time cannot have an unused semantic binding"); return { value: durationFrames(expression, timeline.clock), origin: { kind: "absolute" } }; }
  const match = /^(program\.(?:start|end)|selection\.(?:start|end)|segment\.(?:start|end)|moment\.cue)(?:([+-])(\d+(?:\.\d+)?(?:f|ms|s)))?$/.exec(expression);
  if (!match) throw new DvError("TIME_EXPRESSION", `Invalid point expression '${expression}'`);
  const [kind, edge] = match[1]!.split("."); let frame: number; let origin: InstantOrigin;
  if (kind === "program") {
    if (source) throw new DvError("TIME_BINDING", "Program boundary cannot have an unused semantic binding"); frame = edge === "start" ? 0 : timeline.totalFrames; origin = { kind: "program", edge: edge as "start" | "end" };
  } else {
    if (!source || source.kind !== kind) throw new DvError("TIME_BINDING", `Expression requires a ${kind} reference`);
    if (source.kind === "moment") { frame = anchorFrame(timeline, source, "cue"); origin = { kind: "semantic", reference: source, edge: "cue" }; }
    else { const boundary = edge as "start" | "end"; frame = anchorFrame(timeline, source, boundary); origin = { kind: "semantic", reference: source, edge: boundary }; }
  }
  return { value: match[2] ? offsetFrames(frame, match[3]!, match[2], timeline.clock) : { numerator: BigInt(frame), denominator: 1n }, origin };
}
function instant(timeline: Timeline, consumerKey: string, expression: string, value: ExactFrames, origin: InstantOrigin, editAuthority: Instant["editAuthority"]): Instant {
  if (value.numerator < 0n || value.numerator > BigInt(timeline.totalFrames) * value.denominator) throw new DvError("TIME_OUTSIDE", `Point '${expression}' is outside the Timeline`);
  const frame = Number((2n * value.numerator + value.denominator) / (2n * value.denominator));
  return { axisKey: timeline.axisKey, consumerKey, origin, expression, editAuthority, frame };
}
export function projectInstant(timeline: Timeline, expression: InstantExpression, consumerKey: string): Instant {
  validateTimeline(timeline); text(consumerKey);
  if (expression.kind === "expression") { const point = resolvePoint(timeline, expression.expression, expression.source); return instant(timeline, consumerKey, expression.expression, point.value, point.origin, "local-offset"); }
  if (expression.kind === "at-boundary") {
    const ref = expression.source; const frame = anchorFrame(timeline, ref, expression.boundary); return instant(timeline, consumerKey, `${ref.kind}.${expression.boundary}`, { numerator: BigInt(frame), denominator: 1n }, { kind: "semantic", reference: ref, edge: expression.boundary }, ref.kind === "selection" ? "semantic-anchor" : "none");
  }
  if (typeof expression.source === "string") return instant(timeline, consumerKey, expression.source, durationFrames(expression.source, timeline.clock), { kind: "absolute" }, "local-offset");
  const frame = anchorFrame(timeline, expression.source, "cue"); return instant(timeline, consumerKey, "moment.cue", { numerator: BigInt(frame), denominator: 1n }, { kind: "semantic", reference: expression.source, edge: "cue" }, "semantic-anchor");
}
export function projectWindow(timeline: Timeline, expression: WindowExpression, consumerKey: string): Window {
  validateTimeline(timeline); text(consumerKey); let leading: Instant; let trailing: Instant;
  if (expression.kind === "during") {
    if (expression.source === "program") {
      leading = instant(timeline, consumerKey, "program.start", { numerator: 0n, denominator: 1n }, { kind: "program", edge: "start" }, "none"); trailing = instant(timeline, consumerKey, "program.end", { numerator: BigInt(timeline.totalFrames), denominator: 1n }, { kind: "program", edge: "end" }, "none");
    } else { leading = projectInstant(timeline, { kind: "at-boundary", source: expression.source, boundary: "start" }, consumerKey); trailing = projectInstant(timeline, { kind: "at-boundary", source: expression.source, boundary: "end" }, consumerKey); }
  } else if (expression.kind === "edges") {
    leading = projectInstant(timeline, { kind: "expression", expression: expression.start, ...(expression.startSource ? { source: expression.startSource } : {}) }, consumerKey);
    trailing = projectInstant(timeline, { kind: "expression", expression: expression.end, ...(expression.endSource ? { source: expression.endSource } : {}) }, consumerKey);
  } else {
    const source = expression.source;
    let authored: string;
    if (expression.expression !== undefined) {
      if (expression.boundary !== undefined || typeof source === "string" && source !== "program") throw new DvError("TIME_BINDING", "Expression windows require a matching semantic or program source");
      authored = expression.expression;
      if (source === "program" && !authored.startsWith("program.")) throw new DvError("TIME_BINDING", "Program source requires a program expression");
    } else if (typeof source === "string") {
      if (source === "program" || expression.boundary !== undefined) throw new DvError("TIME_BINDING", "Direct absolute windows require a time literal without boundary");
      authored = source;
    } else if (source.kind === "moment") {
      if (expression.boundary !== undefined) throw new DvError("TIME_BINDING", "Moment windows do not accept boundary");
      authored = "moment.cue";
    } else {
      if (expression.boundary !== "start" && expression.boundary !== "end") throw new DvError("TIME_BINDING", "Direct range windows require an explicit boundary");
      authored = `${source.kind}.${expression.boundary}`;
    }
    const point = resolvePoint(timeline, authored, typeof source === "string" ? undefined : source);
    const duration = durationFrames(expression.duration, timeline.clock);
    const shifted: ExactFrames = { numerator: point.value.numerator * duration.denominator + (expression.kind === "at" ? 1n : -1n) * duration.numerator * point.value.denominator, denominator: point.value.denominator * duration.denominator };
    const editAuthority = expression.expression !== undefined || typeof source === "string" ? "local-offset" : source.kind === "segment" ? "none" : "semantic-anchor";
    const fixed = instant(timeline, consumerKey, authored, point.value, point.origin, editAuthority);
    const moving = instant(timeline, consumerKey, `${authored}${expression.kind === "at" ? "+" : "-"}${expression.duration}`, shifted, point.origin, "duration");
    leading = expression.kind === "at" ? fixed : moving; trailing = expression.kind === "at" ? moving : fixed;
  }
  const result = { axisKey: timeline.axisKey, consumerKey, leading, trailing, frames: { start: leading.frame, end: trailing.frame } }; validateWindow(result); return result;
}
export function consumeWindow(timeline: Timeline, window: Window, consumerKey: string): Window {
  validateWindow(window); text(consumerKey); if (window.axisKey !== timeline.axisKey || window.frames.end > timeline.totalFrames) throw new DvError("TIME_AXIS", "Shared Window belongs to another Timeline");
  return { ...window, consumerKey, leading: { ...window.leading, consumerKey }, trailing: { ...window.trailing, consumerKey } };
}
export function validateSiblingWindows(windows: Window[], mode: "independent" | "disjoint"): void {
  for (const w of windows) validateWindow(w);
  if (windows.some(w => w.axisKey !== windows[0]?.axisKey)) throw new DvError("TIME_AXIS", "Sibling windows belong to different axes");
  if (mode === "disjoint") { const sorted = [...windows].sort((a, b) => a.frames.start - b.frames.start); for (let i = 1; i < sorted.length; i++) if (sorted[i]!.frames.start < sorted[i - 1]!.frames.end) throw new DvError("TIME_OVERLAP", "Sibling windows overlap"); }
}
export function scheduleStages(outer: Bounds, triggers: { id: string; frame: number }[], terminal = outer.end, mode: "cumulative" | "exclusive" = "exclusive"): { id: string; frames: Bounds }[] {
  if (!Number.isSafeInteger(outer.start) || !Number.isSafeInteger(outer.end) || outer.start < 0 || outer.end <= outer.start || !Number.isSafeInteger(terminal) || terminal > outer.end || terminal <= outer.start) throw new DvError("TIME_STAGE", "Invalid stage extent or terminal");
  const ids = new Set<string>(); let previous = outer.start - 1;
  for (const trigger of triggers) { if (!trigger.id || ids.has(trigger.id) || !Number.isSafeInteger(trigger.frame) || trigger.frame <= previous || trigger.frame < outer.start || trigger.frame >= terminal) throw new DvError("TIME_STAGE", "Triggers require unique IDs and strictly increasing in-range frames"); ids.add(trigger.id); previous = trigger.frame; }
  return triggers.map((trigger, index) => ({ id: trigger.id, frames: { start: trigger.frame, end: mode === "cumulative" ? outer.end : triggers[index + 1]?.frame ?? terminal } }));
}
export function isTimeLiteral(data: unknown): data is TimeLiteral { return typeof data === "string" && /^\d+(?:f|ms|(?:\.\d+)?s)$/.test(data); }
