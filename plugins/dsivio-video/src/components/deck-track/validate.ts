import { DvError } from "../../core/errors.ts";
import { validateTimeline, validateInstant } from "../../timeline/validate.ts";
import { validateCanvas, validateFrame } from "../../space/validate.ts";
import { validateTextFlow } from "../../render/text-runtime.ts";
import { validatePerformanceStyle } from "../performance/validate.ts";
import { finite, identity, integer, object } from "../sound/validate.ts";
import { validateSource } from "../media-track/source.ts";
import { validateMotion } from "../media-track/validate.ts";
import type { MediaSource } from "../media-track/types.ts";
import type { DeckLabel, DeckPlan, DeckPose, DeckProgram, DeckStyle } from "./types.ts";

export function validateDeckSource(value: unknown): asserts value is MediaSource {
  const source = object(value, ["kind"], ["resource", "extent", "media", "surface"]);
  if (source.kind === "image") object(value, ["kind", "resource", "extent"]);
  else if (source.kind === "media") object(value, ["kind", "media"]);
  else if (source.kind === "surface") object(value, ["kind", "surface"]);
  else throw new DvError("DECK_SOURCE", "Unknown source kind.");
  validateSource(source as MediaSource);
}
export function validateDeckLabel(value: unknown): asserts value is DeckLabel {
  const label = object(value, ["labelKey", "flow"]); identity(label.labelKey); validateTextFlow(label.flow);
  if (label.flow.paragraphs.length !== 1 || label.flow.paragraphs[0]!.runs.length !== 1 || label.flow.paragraphs[0]!.runs[0]!.kind !== "run" || !label.flow.paragraphs[0]!.runs[0]!.text.trim()) throw new DvError("DECK_LABEL", "Label needs one nonempty pure text run.");
}
export function validateDeckPlan(value: unknown): asserts value is DeckPlan {
  const plan = object(value, ["trackKey", "appearance", "cards"]); identity(plan.trackKey);
  if (!plan.appearance || typeof plan.appearance !== "object" || Array.isArray(plan.appearance)) throw new DvError("DECK_RECIPE", "Appearance requires properties.");
  if (!Array.isArray(plan.cards) || !plan.cards.length) throw new DvError("DECK_PLAN", "Stack needs Cards.");
  const ids = new Set<string>();
  for (const value of plan.cards) {
    const card = object(value, ["cardKey"], ["appearance", "labelIndex"]); identity(card.cardKey);
    if (ids.has(card.cardKey)) throw new DvError("DECK_DUPLICATE", "Duplicate Card identity."); ids.add(card.cardKey);
    if (card.appearance !== undefined && (!card.appearance || typeof card.appearance !== "object" || Array.isArray(card.appearance))) throw new DvError("DECK_RECIPE", "Card appearance requires properties.");
    if (card.labelIndex !== undefined) integer(card.labelIndex);
  }
}
function validatePose(value: unknown, step: boolean): asserts value is DeckPose {
  const pose = object(value, ["x", "y", "rotation", "scale", "opacity", "stacking", "brightness", "contrast", "saturation", ...(step ? ["rotationMode"] : [])]);
  for (const key of ["x", "y", "rotation"]) finite(pose[key]);
  finite(pose.scale, Number.MIN_VALUE); finite(pose.opacity, 0, 1); integer(pose.stacking, -Infinity);
  for (const key of ["brightness", "contrast", "saturation"]) finite(pose[key], 0);
  if (step && pose.rotationMode !== "linear" && pose.rotationMode !== "alternate") throw new DvError("DECK_RECIPE", "Invalid rotation mode.");
}
export function validateDeckStyle(value: unknown): asserts value is DeckStyle {
  const style = object(value, ["current", "previous", "next", "visiblePrevious", "visibleNext", "wrap", "reflowFrames", "reflowEasing", "playbackFuture", "playbackPast"]);
  validatePose(style.current, false); validatePose(style.previous, true); validatePose(style.next, true);
  for (const key of ["visiblePrevious", "visibleNext"]) { integer(style[key]); finite(style[key], 0, 1000); }
  integer(style.reflowFrames);
  if (typeof style.wrap !== "boolean" || !["linear", "ease-in", "ease-out", "ease-in-out"].includes(String(style.reflowEasing)) || !["hold-head", "continue"].includes(String(style.playbackFuture)) || !["hold-tail", "continue", "hide"].includes(String(style.playbackPast))) throw new DvError("DECK_RECIPE", "Invalid stack controls.");
}
export function validateDeckProgram(value: unknown): asserts value is DeckProgram {
  const program = object(value, ["trackKey", "timeline", "canvas", "frame", "terminal", "style", "cards"]); identity(program.trackKey);
  validateTimeline(program.timeline); validateCanvas(program.canvas); validateFrame(program.frame); validateInstant(program.terminal); validateDeckStyle(program.style);
  if (program.frame.canvasKey !== program.canvas.canvasKey || program.terminal.axisKey !== program.timeline.axisKey || program.terminal.consumerKey !== program.trackKey || program.terminal.frame > program.timeline.totalFrames) throw new DvError("DECK_AXIS", "Stack canvas or terminal belongs to a different domain.");
  if (!Array.isArray(program.cards) || !program.cards.length) throw new DvError("DECK_PLAN", "Stack needs Cards.");
  let previous = -1; const ids = new Set<string>();
  for (const value of program.cards) {
    const card = object(value, ["cardKey", "activation", "source", "appearance", "depth", "motion"], ["label"]); identity(card.cardKey); validateInstant(card.activation); validateDeckStyle(card.depth);
    if (ids.has(card.cardKey)) throw new DvError("DECK_DUPLICATE", "Duplicate Card identity."); ids.add(card.cardKey);
    if (card.activation.axisKey !== program.timeline.axisKey || card.activation.consumerKey !== card.cardKey || card.activation.frame <= previous || card.activation.frame >= program.terminal.frame) throw new DvError("DECK_TIME", "Card activations must strictly increase before until on the same Timeline.");
    previous = card.activation.frame;
    validateDeckSource(card.source); validateSource(card.source, program.timeline);
    const appearance = object(card.appearance, ["styleKey", "frame", "fit", "layer", "outerStyle", "contentInsetPx", "clip", "radiusPx", "playback"], ["framePaint", "trim"]);
    const { playback, trim, ...performance } = appearance; validatePerformanceStyle(performance);
    if (performance.frame.canvasKey !== program.canvas.canvasKey) throw new DvError("DECK_AXIS", "Card frame belongs to a different Canvas.");
    if (!["once-start", "once-end", "hold-start", "hold-end", "loop-start", "loop-end", "stretch"].includes(String(playback))) throw new DvError("DECK_PLAYBACK", "Invalid active playback.");
    const source = card.source;
    const total = source.kind === "media" ? source.media.totalFrames : source.kind === "surface" && source.surface.timing.kind === "frames" ? source.surface.timing.totalFrames : undefined;
    if (trim !== undefined) { const bounds = object(trim, ["start", "end"]); integer(bounds.start); integer(bounds.end, 1); if (total === undefined || bounds.start >= bounds.end || bounds.end > total) throw new DvError("DECK_TRIM", "Trim must be a positive in-range source frame window."); }
    if (total === undefined && (trim !== undefined || playback !== "once-start")) throw new DvError("DECK_PLAYBACK", "Static sources prohibit playback and trim.");
    if (total !== undefined && (card.depth.playbackFuture === "continue" || card.depth.playbackPast === "continue") && playback !== "loop-start") throw new DvError("DECK_PLAYBACK", "continue requires loop-start active playback.");
    validateMotion(card.motion);
    if (card.label !== undefined) validateDeckLabel(card.label);
  }
}
