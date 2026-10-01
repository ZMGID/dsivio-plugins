import { DvError } from "../../core/errors.ts";
import { object, text, integer, array, unique, validateTimeline, validateBounds } from "../../timeline/validate.ts";
import { exact } from "../../space/validate.ts";
import { validateTextFormat } from "../../render/text-runtime.ts";
import { decodeFineRecipe } from "./style.ts";
import { validateCaptionContent, validateCaptionUses } from "../caption/validate.ts";
import type { FineStyle, FineProgram, FineSchedule, RegionTimeline } from "./types.ts";
export function validateFineStyle(value: unknown): asserts value is FineStyle {
 const d = object(value); exact(d, ["kind", "styleKey", "recipe", "base", "active"]); if (d.kind !== "fine") throw new DvError("TYPE_INVALID", "Expected fine caption Style"); text(d.styleKey); const recipe = object(d.recipe); decodeFineRecipe(recipe as FineStyle["recipe"]); validateTextFormat(d.base); validateTextFormat(d.active);
}
export function validateRegions(value: unknown): asserts value is RegionTimeline {
 const d = object(value); exact(d, ["axisKey", "totalFrames", "tracks"]); text(d.axisKey); integer(d.totalFrames, 1); array(d.tracks); const roles: string[] = [];
 for (const value of d.tracks) {
  const track = object(value); exact(track, ["role", "frames"]); text(track.role); roles.push(track.role); array(track.frames);
  if (track.frames.length !== d.totalFrames) throw new DvError("CAPTION_REGIONS", "Region track must provide one measured entry for every Timeline frame");
  for (const value of track.frames) if (value !== null) {
   const r = object(value); exact(r, ["x", "y", "width", "height"]);
   for (const name of ["x", "y", "width", "height"]) if (typeof r[name] !== "number" || !Number.isFinite(r[name]) || r[name] < 0 || r[name] > 1 || (name === "width" || name === "height") && r[name] === 0) throw new DvError("CAPTION_REGIONS", "Region coordinates must be fractions in 0..1 with positive width and height");
  }
 } unique(roles, "region roles");
}
export function validateFineProgram(value: unknown): asserts value is FineProgram {
 const d = object(value); exact(d, ["trackKey", "timeline", "content", "uses", "regions"]); text(d.trackKey); validateTimeline(d.timeline); validateCaptionContent(d.content); validateCaptionUses({ axisKey: d.timeline.axisKey, uses: d.uses }); if (d.content.axisKey !== d.timeline.axisKey || d.timeline.storyKey !== undefined && d.content.storyKey !== d.timeline.storyKey) throw new DvError("CAPTION_AXIS", "Caption content belongs to another Timeline");
 if (d.regions !== undefined) { validateRegions(d.regions); if (d.regions.axisKey !== d.timeline.axisKey || d.regions.totalFrames !== d.timeline.totalFrames) throw new DvError("CAPTION_REGIONS", "Region evidence belongs to another Timeline"); if (d.content.cues.some(cue => cue.role === undefined)) throw new DvError("CAPTION_REGIONS", "Every Caption Cue requires a role when regions are supplied"); }
 for (const cue of d.content.cues) if (cue.frames.end > d.timeline.totalFrames) throw new DvError("CAPTION_AXIS", "Caption Cue exceeds its Timeline");
}
export function validateFineSchedule(value: unknown): asserts value is FineSchedule {
 const d = object(value); exact(d, ["axisKey", "items"]); text(d.axisKey); array(d.items);
 for (const value of d.items) { const item = object(value); exact(item, ["cueKey", "useKey", "lifetime", "visible"]); text(item.cueKey); text(item.useKey); validateBounds(item.lifetime, Number.MAX_SAFE_INTEGER, true); array(item.visible); let end = item.lifetime.start; for (const value of item.visible) { validateBounds(value, item.lifetime.end, true); if (value.start < end) throw new DvError("TYPE_INVALID", "Visible caption windows must be ordered and disjoint"); end = value.end; } }
}
