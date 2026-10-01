import { DvError } from "../../core/errors.ts";
import type { ResourceRef, Json } from "../../core/value.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import type { Timeline, Window, Instant } from "../../timeline/types.ts";
import { consumeWindow, validateSiblingWindows, scheduleStages } from "../../timeline/temporal.ts";
import { validateFrame, validateCanvas, object } from "../../space/validate.ts";
import { validateTimeline, validateInstant } from "../../timeline/validate.ts";
import { validateMedia } from "../../modules/media/index.ts";
import { validateRankingPlan, validateRankingStyle, validateRankingProgram } from "./validate.ts";
import type { RankingAuthorPlan, RankingStyle, RankingProgram, RankingItem, RankingEvents } from "./types.ts";
/** Compress a short reveal proportionally, preserving both transitions whenever possible. */
export function transitionFrames(length: number, appear: number, move: number): { appear: number; move: number } {
  if (length === 1) return { appear: 0, move: 0 };
  if (!move) return { appear: Math.min(length, appear), move: 0 };
  if (length >= appear + move) return { appear, move };
  const actualAppear = Math.max(1, Math.min(length - 1, Math.round(length * appear / (appear + move))));
  return { appear: actualAppear, move: length - actualAppear };
}
export function assembleRanking(timeline: Timeline, plan: RankingAuthorPlan, style: RankingStyle, frame: Frame, outerWindow: Window, windows: Window[], instants: Instant[], icons: ResourceRef[], texts: string[], canvas?: Canvas, terminal?: Instant): RankingProgram {
  validateTimeline(timeline); validateRankingPlan(plan); validateRankingStyle(style); validateFrame(frame);
  if (style.kind !== plan.kind) throw new DvError("RANKING_STYLE", "Container and style kinds must agree");
  if (plan.kind !== "TopThree" && !canvas) throw new DvError("RANKING_CANVAS", "TierBoard and Column require a Canvas");
  if (canvas) { validateCanvas(canvas); if (canvas.canvasKey !== frame.canvasKey) throw new DvError("RANKING_CANVAS", "Frame and Canvas belong to different coordinate spaces"); }
  const outer = consumeWindow(timeline, outerWindow, plan.trackKey);
  const p = style.properties, r = frame.rect, number = (name: string) => Number(p[name]);
  const at = <T>(list: T[], index: number, name: string): T => { const result = list[index]; if (result === undefined) throw new DvError("RANKING_PLAN", `Missing ${name} at index ${index}`); return result; };
  const items: RankingItem[] = plan.items.map(item => {
    const reveal = item.windowIndex === undefined ? undefined : consumeWindow(timeline, at(windows, item.windowIndex, "window"), item.itemKey);
    if (reveal && (reveal.frames.start < outer.frames.start || reveal.frames.end > outer.frames.end)) throw new DvError("RANKING_WINDOW", "Reveal window must be contained in the board window");
    const activation = item.instantIndex === undefined ? undefined : at(instants, item.instantIndex, "instant");
    if (activation) { validateInstant(activation); if (activation.axisKey !== timeline.axisKey || activation.consumerKey !== item.itemKey) throw new DvError("RANKING_AXIS", "Activation belongs to another consumer or Timeline"); }
    const icon = item.iconIndex === undefined ? undefined : at(icons, item.iconIndex, "icon"); if (icon) validateMedia(icon as unknown as Json, "image");
    const label = item.textIndex === undefined ? item.label : at(texts, item.textIndex, "text"); if (label !== undefined && !label.trim()) throw new DvError("RANKING_LABEL", "Ranking labels must be nonempty");
    const active = reveal?.frames ?? { start: activation?.frame ?? outer.frames.start, end: outer.frames.end };
    const timing = item.preset ? { appear: 0, move: 0 } : plan.kind === "TopThree" ? { appear: number("appear-frames"), move: 0 } : transitionFrames(active.end - active.start, number("appear-frames"), item.entry === "direct" ? 0 : number("move-frames"));
    if (plan.kind === "TierBoard" && !item.preset && active.end - active.start < 2) throw new DvError("RANKING_WINDOW", "TierBoard reveals require at least two frames");
    return { itemKey: item.itemKey, preset: item.preset, ...(label !== undefined ? { label } : {}), ...(item.tier ? { tier: item.tier } : {}), ...(item.rank ? { rank: item.rank } : {}), ...(item.entry ? { entry: item.entry } : {}), ...(icon ? { icon } : {}), ...(reveal ? { reveal } : {}), ...(activation ? { activation } : {}), stack: item.stack ?? number("item-stack"), target: { xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 }, active, settled: item.preset ? outer.frames : active.end < outer.frames.end ? { start: active.end, end: outer.frames.end } : null, appearFrames: timing.appear, moveFrames: timing.move, ...(timing.move ? { moveFrame: active.end - timing.move } : {}), slot: 0 };
  });
  validateSiblingWindows(items.flatMap(i => i.reveal ? [i.reveal] : []), "disjoint");
  if (plan.kind === "TierBoard") {
    const rows = (p.rows as unknown[]).map(object); const border = number("board-border-width");
    const rowHeight = (r.heightPx - 2 * border) / rows.length;
    const labelWidth = p["label-width"] === undefined ? rowHeight : number("label-width") * r.widthPx;
    const size = rowHeight; const capacity = Math.floor((r.widthPx - 2 * border - labelWidth) / size);
    if (size <= 0 || capacity < 1) throw new DvError("RANKING_CAPACITY", "Tier row cannot contain an icon");
    const occupancy = rows.map(() => 0);
    const ordered = [...items.filter(i => i.preset), ...items.filter(i => !i.preset).sort((a, b) => a.active.start - b.active.start || a.active.end - b.active.end)];
    for (const item of ordered) {
      const row = rows.findIndex(row => row.id === item.tier);
      if (row < 0) throw new DvError("RANKING_TIER", `Unknown tier '${item.tier}'`);
      const cell = occupancy[row]!; if (cell >= capacity) throw new DvError("RANKING_CAPACITY", `Tier '${item.tier}' has no room for another icon`);
      occupancy[row] = cell + 1; item.slot = cell;
      item.target = { xPx: r.xPx + border + labelWidth + cell * size, yPx: r.yPx + border + row * rowHeight, widthPx: size, heightPx: size };
    }
  } else if (plan.kind === "Column") {
    const sorted = [...items].sort((a, b) => a.rank! - b.rank!); const ranks = new Set<number>();
    const padding = number("padding"), size = number("icon-size");
    for (const [index, item] of sorted.entries()) {
      if (ranks.has(item.rank!)) throw new DvError("RANKING_RANK", "Column ranks must be unique"); ranks.add(item.rank!); item.slot = index;
      const y = r.yPx + padding + index * (number("row-height") + number("row-gap"));
      item.target = item.icon ? { xPx: r.xPx + padding + number("row-height"), yPx: y + (number("row-height") - size) / 2, widthPx: size, heightPx: size } : { xPx: r.xPx + padding + number("row-height"), yPx: y, widthPx: Math.max(1, r.widthPx - 2 * padding - number("row-height")), heightPx: number("row-height") };
    }
  } else {
    if (!terminal) throw new DvError("RANKING_TERMINAL", "TopThree requires a terminal Instant"); validateInstant(terminal);
    if (terminal.axisKey !== timeline.axisKey || terminal.origin.kind !== "absolute" && !(terminal.origin.kind === "semantic" && terminal.origin.reference.kind === "moment")) throw new DvError("RANKING_TERMINAL", "Terminal requires absolute time or a Moment on this Timeline");
    const sorted = [...items].sort((a, b) => a.activation!.frame - b.activation!.frame);
    const stages = scheduleStages(outer.frames, sorted.map(i => ({ id: i.itemKey, frame: i.activation!.frame })), terminal.frame);
    const size = number("icon-size"), gap = number("slot-gap"); const center = r.xPx + r.widthPx * number("center-x"), y = r.yPx + r.heightPx * number("baseline-y") - size / 2;
    for (const [index, item] of sorted.entries()) {
      item.slot = index; item.active = stages[index]!.frames; const stageLength = item.active.end - item.active.start;
      item.appearFrames = stageLength === 1 ? 0 : Math.min(item.appearFrames, stageLength - 1);
      item.settled = item.active.end < outer.frames.end ? { start: item.active.end, end: outer.frames.end } : null;
      item.target = { xPx: center - (3 * size + 2 * gap) / 2 + index * (size + gap), yPx: y, widthPx: size, heightPx: size };
    }
  }
  const program: RankingProgram = { timeline, style, frame, ...(canvas ? { canvas } : {}), schedule: { kind: plan.kind, trackKey: plan.trackKey, axisKey: timeline.axisKey, outer, items } };
  validateRankingProgram(program); return program;
}
export function rankingEvents(program: RankingProgram): RankingEvents {
  const events: RankingEvents["events"] = [];
  for (const item of program.schedule.items) if (!item.preset) {
    events.push({ eventKey: `${item.itemKey}/appear`, itemKey: item.itemKey, kind: "appear", frame: item.active.start });
    if (item.moveFrame !== undefined) events.push({ eventKey: `${item.itemKey}/move`, itemKey: item.itemKey, kind: "move", frame: item.moveFrame });
  }
  events.sort((a, b) => a.frame - b.frame || a.eventKey.localeCompare(b.eventKey));
  return { axisKey: program.timeline.axisKey, trackKey: program.schedule.trackKey, events };
}
