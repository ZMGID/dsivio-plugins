import { DvError } from "../../core/errors.ts";
import { object, exact, key, finite, validateFrame, validateCanvas } from "../../space/validate.ts";
import { validateWindow, validateInstant, validateTimeline } from "../../timeline/validate.ts";
import { validateSiblingWindows, scheduleStages } from "../../timeline/temporal.ts";
import type { Window, Bounds } from "../../timeline/types.ts";
import { validateTextFormat } from "../../render/text-runtime.ts";
import { validateMedia } from "../../modules/media/index.ts";
import type { Json } from "../../core/value.ts";
import { validateProperties } from "./author.ts";
import type { RankingKind, RankingStyle, RankingAuthorPlan, RankingSchedule, RankingProgram, RankingEvents, SoundStyle } from "./types.ts";
const kind = (value: unknown): RankingKind => { if (value !== "TierBoard" && value !== "Column" && value !== "TopThree") throw new DvError("TYPE_INVALID", "Invalid ranking kind"); return value; };
function integer(value: unknown, name: string, min = -Infinity): number { const n = finite(value, name, min); if (!Number.isSafeInteger(n)) throw new DvError("TYPE_INVALID", `${name} must be a safe integer`); return n; }
function bounds(value: unknown): { start: number; end: number } { const b = object(value); exact(b, ["start", "end"]); const start = integer(b.start, "start", 0), end = integer(b.end, "end", 0); if (end <= start) throw new DvError("TYPE_INVALID", "Bounds must be positive"); return { start, end }; }
export function validateSoundStyle(value: unknown): asserts value is SoundStyle {
  const s = object(value); exact(s, ["appearGain", "moveGain", "fadeFrames"]);
  for (const name of ["appearGain", "moveGain"]) if (finite(s[name], name, 0) > 64) throw new DvError("TYPE_INVALID", "Sound gains must be in 0..64"); integer(s.fadeFrames, "fadeFrames", 0);
}
export function validateRankingStyle(value: unknown): asserts value is RankingStyle {
  const s = object(value); exact(s, ["kind", "styleKey", "properties", "format", "sound"]); const k = kind(s.kind); key(s.styleKey); validateProperties(k, s.properties); validateTextFormat(s.format); validateSoundStyle(s.sound);
  if (s.sound.appearGain !== s.properties["appear-gain"] || s.sound.moveGain !== s.properties["move-gain"] || s.sound.fadeFrames !== s.properties["sound-fade-frames"]) throw new DvError("TYPE_INVALID", "Ranking sound output conflicts with its recipe");
}
export function validateRankingPlan(value: unknown): asserts value is RankingAuthorPlan {
  const p = object(value); exact(p, ["kind", "trackKey", "items"]); const k = kind(p.kind); key(p.trackKey);
  if (!Array.isArray(p.items) || !p.items.length || k === "TopThree" && p.items.length > 3) throw new DvError("RANKING_ITEMS", "Ranking requires items; TopThree has at most three");
  const ids = new Set<string>();
  for (const value of p.items) {
    const i = object(value); exact(i, ["itemKey", "preset", "tier", "rank", "label", "textIndex", "iconIndex", "windowIndex", "instantIndex", "entry", "stack"]); key(i.itemKey);
    if (ids.has(i.itemKey)) throw new DvError("RANKING_ITEMS", "Item IDs must be unique"); ids.add(i.itemKey);
    if (typeof i.preset !== "boolean") throw new DvError("TYPE_INVALID", "preset must be boolean");
    for (const n of ["textIndex", "iconIndex", "windowIndex", "instantIndex"]) if (i[n] !== undefined) integer(i[n], n, 0);
    if (i.stack !== undefined) integer(i.stack, "stack");
    if (k === "TierBoard") { key(i.tier); if (i.iconIndex === undefined || i.rank !== undefined || i.label !== undefined || i.textIndex !== undefined || i.instantIndex !== undefined) throw new DvError("RANKING_ITEMS", "Invalid TierItem fields"); if (i.preset ? i.windowIndex !== undefined || i.entry !== undefined : i.windowIndex === undefined || !["direct", "drop"].includes(String(i.entry))) throw new DvError("RANKING_ITEMS", "TierItem requires preset or during and entry"); }
    else {
      if ((i.label === undefined) === (i.textIndex === undefined)) throw new DvError("RANKING_LABEL", "Item requires exactly one literal or referenced label"); if (i.label !== undefined) key(i.label);
      if (i.tier !== undefined || i.entry !== undefined) throw new DvError("RANKING_ITEMS", "Invalid ranking item fields");
      if (k === "Column") { integer(i.rank, "rank", 1); if (i.instantIndex !== undefined || i.preset === (i.windowIndex !== undefined)) throw new DvError("RANKING_ITEMS", "ColumnItem requires preset or during"); }
      else if (i.preset || i.rank !== undefined || i.windowIndex !== undefined || i.instantIndex === undefined) throw new DvError("RANKING_ITEMS", "TopThreeItem requires an activation and forbids preset/rank/during");
    }
  }
}
export function validateRankingSchedule(value: unknown): asserts value is RankingSchedule {
  const s = object(value); exact(s, ["kind", "trackKey", "axisKey", "outer", "items"]); const k = kind(s.kind); key(s.trackKey); key(s.axisKey); validateWindow(s.outer);
  if (s.outer.axisKey !== s.axisKey || s.outer.consumerKey !== s.trackKey || !Array.isArray(s.items) || !s.items.length || k === "TopThree" && s.items.length > 3) throw new DvError("TYPE_INVALID", "Invalid ranking schedule extent");
  const ids = new Set<string>(), ranks = new Set<number>();
  for (const value of s.items) {
    const i = object(value); exact(i, ["itemKey", "preset", "label", "tier", "rank", "icon", "entry", "stack", "target", "reveal", "activation", "active", "settled", "appearFrames", "moveFrames", "moveFrame", "slot"]); key(i.itemKey);
    if (ids.has(i.itemKey)) throw new DvError("TYPE_INVALID", "Duplicate scheduled item"); ids.add(i.itemKey);
    if (typeof i.preset !== "boolean") throw new DvError("TYPE_INVALID", "Invalid preset"); integer(i.stack, "stack"); integer(i.slot, "slot", 0); const appear = integer(i.appearFrames, "appearFrames", 0), move = integer(i.moveFrames, "moveFrames", 0);
    validateFrame({ canvasKey: "target", rect: i.target }); const active = bounds(i.active); const end = s.outer.frames.end;
    if (active.start < s.outer.frames.start || active.end > end || appear + move > active.end - active.start || i.preset && (appear || move)) throw new DvError("TYPE_INVALID", "Invalid active stage or transition lengths");
    if (i.settled !== null) { const settled = bounds(i.settled); if (settled.start !== (i.preset ? s.outer.frames.start : active.end) || settled.end !== end) throw new DvError("TYPE_INVALID", "Invalid settled extent"); }
    else if (active.end !== end) throw new DvError("TYPE_INVALID", "Settled interval is missing");
    if (i.moveFrame !== undefined) { if (!move || integer(i.moveFrame, "moveFrame", 0) !== active.end - move) throw new DvError("TYPE_INVALID", "Invalid movement start"); } else if (move) throw new DvError("TYPE_INVALID", "Movement start is missing");
    if (i.icon !== undefined) validateMedia(i.icon as Json, "image"); if (i.label !== undefined) key(i.label);
    if (i.reveal !== undefined) { validateWindow(i.reveal); if (i.reveal.axisKey !== s.axisKey || i.reveal.consumerKey !== i.itemKey || i.reveal.frames.start !== active.start || i.reveal.frames.end !== active.end) throw new DvError("TYPE_INVALID", "Reveal window does not match stage"); }
    if (i.activation !== undefined) { validateInstant(i.activation); if (i.activation.axisKey !== s.axisKey || i.activation.consumerKey !== i.itemKey || i.activation.frame !== active.start) throw new DvError("TYPE_INVALID", "Activation does not match stage"); }
    if (k === "TierBoard") { key(i.tier); if (!i.icon || i.rank !== undefined || i.label !== undefined || i.activation !== undefined || (i.preset ? i.entry !== undefined || i.reveal !== undefined : !["direct", "drop"].includes(String(i.entry)) || i.reveal === undefined || active.end - active.start < 2)) throw new DvError("TYPE_INVALID", "Invalid scheduled TierItem"); }
    else if (k === "Column") { key(i.label); const rank = integer(i.rank, "rank", 1); if (ranks.has(rank)) throw new DvError("TYPE_INVALID", "Duplicate Column rank"); ranks.add(rank); if (i.tier !== undefined || i.entry !== undefined || i.activation !== undefined || i.preset === (i.reveal !== undefined)) throw new DvError("TYPE_INVALID", "Invalid scheduled ColumnItem"); }
    else { key(i.label); if (!i.activation || i.preset || i.reveal !== undefined || i.rank !== undefined || i.tier !== undefined || i.entry !== undefined || move) throw new DvError("TYPE_INVALID", "Invalid scheduled TopThreeItem"); }
  }
  const items = s.items.map(object);
  validateSiblingWindows(items.flatMap(i => i.reveal === undefined ? [] : [i.reveal as Window]), "disjoint");
  if (k === "TopThree") {
    const sorted = [...items].sort((a, b) => bounds(a.active).start - bounds(b.active).start);
    const stages = scheduleStages(s.outer.frames, sorted.map(i => ({ id: String(i.itemKey), frame: bounds(i.active).start })), bounds(sorted.at(-1)!.active).end);
    for (const [index, item] of sorted.entries()) if (item.slot !== index || (item.active as Bounds).end !== stages[index]!.frames.end) throw new DvError("TYPE_INVALID", "TopThree slots and stages must follow activation order");
  }
}
export function validateRankingProgram(value: unknown): asserts value is RankingProgram {
  const p = object(value); exact(p, ["timeline", "frame", "canvas", "style", "schedule"]); validateTimeline(p.timeline); validateFrame(p.frame); validateRankingStyle(p.style); validateRankingSchedule(p.schedule);
  if (p.schedule.axisKey !== p.timeline.axisKey || p.schedule.outer.frames.end > p.timeline.totalFrames || p.schedule.kind !== p.style.kind) throw new DvError("TYPE_INVALID", "Ranking program axis or style mismatch");
  if (p.canvas !== undefined) { validateCanvas(p.canvas); if (p.canvas.canvasKey !== p.frame.canvasKey) throw new DvError("TYPE_INVALID", "Ranking space mismatch"); }
  if (p.schedule.kind !== "TopThree" && p.canvas === undefined) throw new DvError("TYPE_INVALID", "Ranking canvas is missing");
}
export function validateRankingEvents(value: unknown): asserts value is RankingEvents {
  const e = object(value); exact(e, ["axisKey", "trackKey", "events"]); key(e.axisKey); key(e.trackKey); if (!Array.isArray(e.events)) throw new DvError("TYPE_INVALID", "Events must be a list");
  const keys = new Set<string>(); let previous = -1;
  for (const value of e.events) { const event = object(value); exact(event, ["eventKey", "itemKey", "kind", "frame"]); key(event.eventKey); key(event.itemKey); const frame = integer(event.frame, "frame", 0); if (event.kind !== "appear" && event.kind !== "move" || keys.has(event.eventKey) || frame < previous) throw new DvError("TYPE_INVALID", "Invalid sound events"); keys.add(event.eventKey); previous = frame; }
}
