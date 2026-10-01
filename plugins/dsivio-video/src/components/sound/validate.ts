import { DvError } from "../../core/errors.ts";
import type { SoundProgram, SoundStyle, UsePlan } from "../types.ts";
import type { Bounds } from "../../timeline/types.ts";
import { validateTimeline, validateWindow } from "../../timeline/validate.ts";

export function object(data: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new DvError("TYPE_INVALID", "Expected an object.");
  const record = data as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !required.includes(key) && !optional.includes(key))) throw new DvError("TYPE_INVALID", "Unexpected or missing object fields.");
  return record;
}
export function identity(data: unknown): asserts data is string {
  if (typeof data !== "string" || data.trim() === "") throw new DvError("TYPE_INVALID", "Identity must be nonempty text.");
}
export function finite(data: unknown, min = -Infinity, max = Infinity): asserts data is number {
  if (typeof data !== "number" || !Number.isFinite(data) || data < min || data > max) throw new DvError("TYPE_INVALID", `Number must be finite and between ${min} and ${max}.`);
}
export function integer(data: unknown, min = 0): asserts data is number {
  finite(data, min);
  if (!Number.isSafeInteger(data)) throw new DvError("TYPE_INVALID", "Expected a safe integer.");
}
export function validateUsePlan(data: unknown): asserts data is UsePlan {
  const plan = object(data, ["trackKey", "uses"]);
  identity(plan.trackKey);
  if (!Array.isArray(plan.uses)) throw new DvError("TYPE_INVALID", "Use plan requires an ordered list.");
  const keys = new Set<string>();
  for (const item of plan.uses) {
    const use = object(item, ["useKey", "windowIndex", "styleIndex"]);
    identity(use.useKey); integer(use.windowIndex); integer(use.styleIndex);
    if (keys.has(use.useKey)) throw new DvError("TYPE_INVALID", "Use identities must be unique.");
    keys.add(use.useKey);
  }
}
export function validateSoundStyle(data: unknown): asserts data is SoundStyle {
  const style = object(data, ["styleKey", "gain", "endGain"]);
  identity(style.styleKey); finite(style.gain, 0, 64); finite(style.endGain, 0, 64);
}
export function validateSoundProgram(data: unknown): asserts data is SoundProgram {
  const program = object(data, ["trackKey", "timeline", "uses"]);
  identity(program.trackKey); validateTimeline(program.timeline);
  if (!Array.isArray(program.uses)) throw new DvError("TYPE_INVALID", "Sound program requires an ordered Use list.");
  const keys = new Set<string>();
  for (const entry of program.uses) {
    const use = object(entry, ["useKey", "window", "style"]);
    identity(use.useKey); validateWindow(use.window); validateSoundStyle(use.style);
    if (keys.has(use.useKey) || use.window.consumerKey !== use.useKey || use.window.axisKey !== program.timeline.axisKey || use.window.frames.end > program.timeline.totalFrames) throw new DvError("TYPE_INVALID", "Use window has mismatched identity or program bounds.");
    keys.add(use.useKey);
  }
}
/** Remove cover windows without modifying a source clock or an envelope origin. */
export function subtractWindows(window: Bounds, covers: readonly Bounds[]): Bounds[] {
  let pieces = [window];
  for (const cover of covers) {
    const next: Bounds[] = [];
    for (const piece of pieces) {
      if (cover.end <= piece.start || cover.start >= piece.end) next.push(piece);
      else {
        if (piece.start < cover.start) next.push({ start: piece.start, end: cover.start });
        if (cover.end < piece.end) next.push({ start: cover.end, end: piece.end });
      }
    }
    pieces = next;
  }
  return pieces;
}
