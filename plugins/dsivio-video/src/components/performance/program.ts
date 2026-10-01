import { DvError } from "../../core/errors.ts";
import type { Canvas } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import type { PerformanceProgram, PerformanceStyle, UsePlan } from "../types.ts";
import { validateUsePlan } from "../sound/validate.ts";
import { validatePerformanceProgram } from "./validate.ts";

export function assemblePerformanceProgram(timeline: Timeline, canvas: Canvas, plan: UsePlan, windows: Window[], styles: PerformanceStyle[]): PerformanceProgram {
  validateUsePlan(plan);
  const program: PerformanceProgram = { trackKey: plan.trackKey, timeline, canvas, uses: plan.uses.map(use => {
    const window = windows[use.windowIndex];
    const style = styles[use.styleIndex];
    if (!window || !style) throw new DvError("PERFORMANCE_PLAN_INDEX", "Use indexes must address existing typed inputs.");
    return { useKey: use.useKey, window, style };
  }) };
  validatePerformanceProgram(program);
  return program;
}
