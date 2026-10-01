import { DvError } from "../../core/errors.ts";
import { object, identity, finite, integer } from "../sound/validate.ts";
import { isTimeLiteral } from "../../timeline/temporal.ts";
import { validateTimeline, validateWindow, validateSynchronizedMedia } from "../../timeline/validate.ts";
import type { AudioPlan, AudioProgram, AudioItemPlan } from "./types.ts";
export function validateAudioItem(data: unknown): asserts data is AudioItemPlan {
  const p = object(data, ["itemKey", "sourceIndex", "windowIndex", "playback", "gain", "trimStart", "fadeIn", "fadeOut"], ["trimEnd", "minRate", "maxRate"]);
  identity(p.itemKey); integer(p.sourceIndex); integer(p.windowIndex); finite(p.gain, 0, 64);
  if (!["once", "once-start", "once-end", "loop", "loop-start", "loop-end", "stretch"].includes(String(p.playback))) throw new DvError("AUDIO_PLAYBACK", "Unsupported audio playback mode.");
  for (const key of ["trimStart", "trimEnd", "fadeIn", "fadeOut"]) if ((key !== "trimEnd" || p[key] !== undefined) && !isTimeLiteral(p[key])) throw new DvError("AUDIO_DURATION", `Invalid ${key} duration.`);
  if (p.playback === "stretch") { finite(p.minRate, Number.MIN_VALUE, 100); finite(p.maxRate, Number.MIN_VALUE, 100); if (p.minRate > p.maxRate) throw new DvError("AUDIO_RATE", "Stretch bounds are reversed."); }
  else if (p.minRate !== undefined || p.maxRate !== undefined) throw new DvError("AUDIO_RATE", "Rate bounds are only valid for stretch.");
}
export function validateAudioPlan(data: unknown): asserts data is AudioPlan {
  const p = object(data, ["trackKey", "items"]); identity(p.trackKey);
  if (!Array.isArray(p.items) || !p.items.length) throw new DvError("AUDIO_ITEMS", "Audio Track requires at least one Item.");
  const keys = new Set<string>(); for (const item of p.items) { validateAudioItem(item); if (keys.has(item.itemKey)) throw new DvError("AUDIO_DUPLICATE", "Duplicate Item identity."); keys.add(item.itemKey); }
}
export function validateAudioProgram(data: unknown): asserts data is AudioProgram {
  const p = object(data, ["trackKey", "timeline", "items"]); identity(p.trackKey); validateTimeline(p.timeline);
  if (!Array.isArray(p.items) || !p.items.length) throw new DvError("AUDIO_ITEMS", "Audio Track requires Items.");
  const keys = new Set<string>(); for (const entry of p.items) { const item = object(entry, ["plan", "source", "window"]); validateAudioItem(item.plan); validateSynchronizedMedia(item.source); validateWindow(item.window); if (!item.source.sound || item.source.sound.resource.mime !== "audio/wav") throw new DvError("AUDIO_SOURCE", "Audio source must contain explicit normalized WAV sound."); if (keys.has(item.plan.itemKey) || item.window.axisKey !== p.timeline.axisKey || item.window.consumerKey !== item.plan.itemKey || item.window.frames.end > p.timeline.totalFrames) throw new DvError("AUDIO_WINDOW", "Item window identity or Timeline mismatch."); keys.add(item.plan.itemKey); }
}
