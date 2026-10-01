import type { CaptionDocument, Timeline, Window, Bounds } from "../../timeline/types.ts";
import type { CaptionStyle, CaptionUsePlan, TimedCue } from "../caption/types.ts";
import { projectCaptionContent, resolveCaptionUses } from "../caption/program.ts";
import type { FineProgram, FineSchedule, FineStyle, RegionTimeline } from "./types.ts";
import { validateFineProgram } from "./validate.ts";
export function assembleFineProgram(trackKey: string, document: CaptionDocument, timeline: Timeline, plan: CaptionUsePlan, windows: Window[], styles: CaptionStyle[], regions?: RegionTimeline): FineProgram {
 const program: FineProgram = { trackKey, timeline, content: projectCaptionContent(document, timeline), uses: resolveCaptionUses(timeline, plan, windows, styles).uses, ...(regions === undefined ? {} : { regions }) }; validateFineProgram(program); return program;
}
/** Remove only optional envelopes, never measured speech, including overlapping real speech. */
export function cueEnvelope(cue: TimedCue, cues: TimedCue[], style: FineStyle, totalFrames: number): Bounds {
 const p = style.recipe; let start = Math.max(0, cue.frames.start - Number(p["lead-frames"])), end = Math.min(totalFrames, cue.frames.end + Number(p["tail-frames"]));
 if (p.handoff === "cut") {
  const peers = cues.filter(peer => peer.role === cue.role).sort((a, b) => a.frames.start - b.frames.start || a.frames.end - b.frames.end);
  const index = peers.findIndex(peer => peer.cueKey === cue.cueKey), previous = peers[index - 1], next = peers[index + 1];
  if (previous) start = Math.min(cue.frames.start, Math.max(start, previous.frames.end <= cue.frames.start ? Math.floor((previous.frames.end + cue.frames.start) / 2) : cue.frames.start));
  if (next) end = Math.max(cue.frames.end, Math.min(end, cue.frames.end <= next.frames.start ? Math.floor((cue.frames.end + next.frames.start) / 2) : cue.frames.end));
 }
 return { start, end };
}
export function scheduleFine(program: FineProgram): FineSchedule {
 validateFineProgram(program); const items: FineSchedule["items"] = [];
 for (const cue of program.content.cues) {
  const applicable = program.uses.filter(use => use.role === undefined || use.role === cue.role);
  for (let index = 0; index < applicable.length; index++) {
   const use = applicable[index]!; if (use.style.kind === "hidden") continue;
   const lifetime = cueEnvelope(cue, program.content.cues, use.style, program.timeline.totalFrames);
  if (cue.units.every(unit => !unit.text)) continue;
   let visible: Bounds[] = [{ start: Math.max(lifetime.start, use.window.frames.start), end: Math.min(lifetime.end, use.window.frames.end) }].filter(w => w.start < w.end);
   for (const later of applicable.slice(index + 1)) visible = visible.flatMap(w => {
    const overlap = later.window.frames; if (overlap.start >= w.end || overlap.end <= w.start) return [w];
    return [{ start: w.start, end: Math.min(w.end, overlap.start) }, { start: Math.max(w.start, overlap.end), end: w.end }].filter(w => w.start < w.end);
   });
   if (visible.length) items.push({ cueKey: cue.cueKey, useKey: use.useKey, lifetime, visible });
  }
 }
 return { axisKey: program.timeline.axisKey, items };
}
