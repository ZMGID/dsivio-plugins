import { DvError } from "../../core/errors.ts";
import type { CaptionDocument, Timeline, Window } from "../../timeline/types.ts";
import { validateCaptionDocument, validateTimeline } from "../../timeline/validate.ts";
import { consumeWindow } from "../../timeline/temporal.ts";
import type { CaptionContent, CaptionStyle, CaptionUsePlan, CaptionUses, TimedUnit } from "./types.ts";
import { validateCaptionUsePlan, validateCaptionStyle } from "./validate.ts";
/** Display identity is authored; only measured Take token windows supply the clock. */
export function projectCaptionContent(document: CaptionDocument, timeline: Timeline): CaptionContent {
 validateCaptionDocument(document); validateTimeline(timeline);
 if (timeline.storyKey !== undefined && document.storyKey !== timeline.storyKey) throw new DvError("CAPTION_STORY", "Caption document and Timeline must belong to the same story");
 const units = new Map(document.units.map(unit => [unit.unitKey, unit]));
 const cues: CaptionContent["cues"] = [];
 for (const cue of document.cues) {
  const placement = timeline.placements.find(item => item.take.segment.segmentKey === cue.segmentKey);
  if (!placement) continue;
  const bounds = placement.take.segment.tokenBounds;
  const timed: TimedUnit[] = cue.unitKeys.map(unitKey => {
   const unit = units.get(unitKey)!;
   if (unit.tokenBounds.start < bounds.start || unit.tokenBounds.end > bounds.end) throw new DvError("CAPTION_ALIGNMENT", "Caption display unit crosses its placed segment");
   const tokens = placement.take.tokens.slice(unit.tokenBounds.start - bounds.start, unit.tokenBounds.end - bounds.start);
   if (!tokens.length) throw new DvError("CAPTION_ALIGNMENT", "Caption display unit has no aligned token evidence");
   return { ...unit, frames: { start: placement.offsetFrames + Math.min(...tokens.map(token => token.frames.start)), end: placement.offsetFrames + Math.max(...tokens.map(token => token.frames.end)) } };
  });
  if (!timed.length) continue;
  const frames = { start: Math.min(...timed.map(unit => unit.frames.start)), end: Math.max(...timed.map(unit => unit.frames.end)) };
  cues.push({ cueKey: cue.cueKey, segmentKey: cue.segmentKey, turnKey: cue.turnKey, ...(cue.role === undefined ? {} : { role: cue.role }), frames, units: timed });
 }
 return { axisKey: timeline.axisKey, storyKey: document.storyKey, cues };
}
export function resolveCaptionUses(timeline: Timeline, plan: CaptionUsePlan, windows: Window[], styles: CaptionStyle[]): CaptionUses {
 validateTimeline(timeline); validateCaptionUsePlan(plan); styles.forEach(validateCaptionStyle);
 const uses = plan.uses.map(use => {
  const window = windows[use.windowIndex], style = styles[use.styleIndex];
  if (!window || !style) throw new DvError("CAPTION_PLAN", "Caption Use index exceeds its typed input list");
  return { useKey: use.useKey, ...(use.role === undefined ? {} : { role: use.role }), window: consumeWindow(timeline, window, use.useKey), style };
 });
 return { axisKey: timeline.axisKey, uses };
}
