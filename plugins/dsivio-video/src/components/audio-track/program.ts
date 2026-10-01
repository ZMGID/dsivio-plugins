import { DvError } from "../../core/errors.ts";
import type { Timeline, Window, SynchronizedMedia } from "../../timeline/types.ts";
import type { AudioPlan, AudioProgram } from "./types.ts";
import { validateAudioPlan, validateAudioProgram } from "./validate.ts";
export function assembleAudioProgram(timeline: Timeline, plan: AudioPlan, sources: SynchronizedMedia[], windows: Window[]): AudioProgram {
  validateAudioPlan(plan);
  const program: AudioProgram = { trackKey: plan.trackKey, timeline, items: plan.items.map(item => {
    const source = sources[item.sourceIndex], window = windows[item.windowIndex];
    if (!source || !window) throw new DvError("AUDIO_INPUT", "Missing source or window.");
    return { plan: item, source, window };
  }) };
  validateAudioProgram(program); return program;
}
