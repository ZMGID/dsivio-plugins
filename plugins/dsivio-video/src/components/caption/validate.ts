import { DvError } from "../../core/errors.ts";
import type { CaptionContent, CaptionStyle, CaptionUsePlan, CaptionUses } from "./types.ts";
import { object, text, integer, array, unique, validateBounds, validateWindow } from "../../timeline/validate.ts";
import { exact } from "../../space/validate.ts";
import { validateFineStyle } from "../caption-fine/validate.ts";
export function validateCaptionStyle(value: unknown): asserts value is CaptionStyle {
 const d = object(value); text(d.styleKey); if (d.kind === "fine") validateFineStyle(value); else { exact(d, ["kind", "styleKey"]); if (d.kind !== "hidden") throw new DvError("TYPE_INVALID", "Unknown caption Style kind"); }
}
export function validateCaptionUsePlan(value: unknown): asserts value is CaptionUsePlan {
 const d = object(value); exact(d, ["uses"]); array(d.uses); const keys: string[] = [];
 for (const value of d.uses) { const use = object(value); exact(use, ["useKey", "role", "windowIndex", "styleIndex"]); text(use.useKey); keys.push(use.useKey); if (use.role !== undefined) text(use.role); integer(use.windowIndex); integer(use.styleIndex); } unique(keys, "caption Uses");
}
export function validateCaptionContent(value: unknown): asserts value is CaptionContent {
 const d = object(value); exact(d, ["axisKey", "storyKey", "cues"]); text(d.axisKey); text(d.storyKey); array(d.cues); const cues: string[] = [], units: string[] = [];
 for (const value of d.cues) {
  const cue = object(value); exact(cue, ["cueKey", "segmentKey", "turnKey", "role", "frames", "units"]); for (const key of ["cueKey", "segmentKey", "turnKey"]) text(cue[key]); if (cue.role !== undefined) text(cue.role); cues.push(String(cue.cueKey)); validateBounds(cue.frames); array(cue.units); if (!cue.units.length) throw new DvError("TYPE_INVALID", "Caption Cue needs display units");
  for (const value of cue.units) { const unit = object(value); exact(unit, ["unitKey", "text", "separator", "tokenBounds", "attributes", "frames"]); text(unit.unitKey); units.push(unit.unitKey); if (typeof unit.text !== "string" || typeof unit.separator !== "string") throw new DvError("TYPE_INVALID", "Caption text and separator must be strings"); validateBounds(unit.tokenBounds, Number.MAX_SAFE_INTEGER, true); validateBounds(unit.frames); if (unit.frames.start < cue.frames.start || unit.frames.end > cue.frames.end) throw new DvError("TYPE_INVALID", "Caption unit clock must remain inside its Cue"); const attrs = object(unit.attributes); for (const value of Object.values(attrs)) if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)) throw new DvError("TYPE_INVALID", "Caption attributes must be scalar values"); }
 } unique(cues, "caption Cues"); unique(units, "caption units");
}
export function validateCaptionUses(value: unknown): asserts value is CaptionUses {
 const d = object(value); exact(d, ["axisKey", "uses"]); text(d.axisKey); array(d.uses); const keys: string[] = [];
 for (const value of d.uses) { const use = object(value); exact(use, ["useKey", "role", "window", "style"]); text(use.useKey); keys.push(use.useKey); if (use.role !== undefined) text(use.role); validateWindow(use.window); validateCaptionStyle(use.style); if (use.window.axisKey !== d.axisKey || use.window.consumerKey !== use.useKey) throw new DvError("CAPTION_AXIS", "Caption Use Window identity mismatch"); } unique(keys, "caption Uses");
}
