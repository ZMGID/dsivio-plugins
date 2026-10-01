import { DvError } from "../../core/errors.ts";
import type { Canvas } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import type { OverlayAuthorPlan, OverlayProgram } from "./types.ts";
import { validateOverlayPlan, validateOverlayProgram } from "./validate.ts";

export function assembleOverlayProgram(trackKey: string, canvas: Canvas, timeline: Timeline, plan: OverlayAuthorPlan, windows: Window[]): OverlayProgram {
  validateOverlayPlan(plan);
  if (windows.length !== plan.effects.length) throw new DvError("OVERLAY_INPUT", "Overlay windows must match the effect declarations.");
  const effects = plan.effects.map(effect => {
    const window = windows[effect.windowIndex];
    if (!window) throw new DvError("OVERLAY_INPUT", "Overlay window index is out of range.");
    const { windowIndex, ...resolved } = effect;
    return { ...resolved, window };
  });
  const program: OverlayProgram = { trackKey, canvas, timeline, effects };
  validateOverlayProgram(program);
  return program;
}
