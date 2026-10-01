import { DvError } from "../../core/errors.ts";
import type { SoundProgram, SoundStyle, UsePlan } from "../types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import { validateSoundProgram, validateUsePlan } from "./validate.ts";

export function assembleSoundProgram(timeline: Timeline, plan: UsePlan, windows: Window[], styles: SoundStyle[]): SoundProgram {
  validateUsePlan(plan);
  const program: SoundProgram = { trackKey: plan.trackKey, timeline, uses: plan.uses.map(use => {
    const window = windows[use.windowIndex];
    const style = styles[use.styleIndex];
    if (!window || !style) throw new DvError("SOUND_PLAN_INDEX", "Use plan indexes must address existing typed inputs.");
    return { useKey: use.useKey, window, style };
  }) };
  validateSoundProgram(program);
  return program;
}
