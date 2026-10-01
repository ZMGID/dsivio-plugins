import { DvError } from "../../core/errors.ts";
import type { AudioClip, AudioTrack } from "../../render/ir.ts";
import type { Clock } from "../../timeline/types.ts";
import { durationFrames } from "../../timeline/temporal.ts";
import { frameToSample48k } from "../../timeline/math.ts";
import type { AudioProgram } from "./types.ts";
import { validateAudioProgram } from "./validate.ts";
export function durationSamples(literal: string, clock: Clock): number {
  const frames = durationFrames(literal, clock);
  const n = frames.numerator * 48000n * BigInt(clock.fps.denominator), d = frames.denominator * BigInt(clock.fps.numerator);
  const sample = (2n * n + d) / (2n * d);
  if (sample > BigInt(Number.MAX_SAFE_INTEGER)) throw new DvError("AUDIO_DURATION", "Duration exceeds safe sample range.");
  return Number(sample);
}
export function lowerAudio(program: AudioProgram): AudioTrack {
  validateAudioProgram(program);
  const clips: AudioClip[] = [];
  for (const { plan, source, window } of program.items) {
    const sound = source.sound!;
    const start = durationSamples(plan.trimStart, source.clock), end = plan.trimEnd === undefined ? sound.totalSamples : durationSamples(plan.trimEnd, source.clock);
    if (start >= sound.totalSamples || end > sound.totalSamples || end <= start) throw new DvError("AUDIO_TRIM", "Trim must be a nonempty interval within source sound.");
    const sourceLength = end - start;
    const target = { start: frameToSample48k(window.frames.start, program.timeline.clock), end: frameToSample48k(window.frames.end, program.timeline.clock) };
    const targetLength = target.end - target.start;
    let sourceStart = start, sourceEnd = end;
    const speed = { numerator: 1, denominator: 1 };
    const clip: AudioClip = { clipKey: plan.itemKey, source: sound.resource, sourceTotalSamples: sound.totalSamples, sourceSamples: { start, end }, targetSamples: target, speed, preservePitch: true, gain: plan.gain, fadeInSamples: durationSamples(plan.fadeIn, program.timeline.clock), fadeOutSamples: durationSamples(plan.fadeOut, program.timeline.clock), gainCurve: [] };
    if (plan.playback === "stretch") {
      const rate = sourceLength / targetLength;
      if (rate < plan.minRate! || rate > plan.maxRate!) throw new DvError("AUDIO_RATE", "Stretch rate is outside the declared bounds.");
      clip.speed = { numerator: sourceLength, denominator: targetLength };
    } else if (plan.playback.startsWith("loop")) {
      clip.loop = { phaseSamples: plan.playback === "loop-end" ? (sourceLength - targetLength % sourceLength) % sourceLength : 0 };
    } else if (plan.playback === "once-end") {
      if (sourceLength < targetLength) target.start = target.end - sourceLength;
      else sourceStart = sourceEnd - targetLength;
    } else {
      if (sourceLength < targetLength) target.end = target.start + sourceLength;
      else sourceEnd = sourceStart + targetLength;
    }
    clip.sourceSamples = { start: sourceStart, end: sourceEnd };
    if (clip.fadeInSamples > target.end - target.start || clip.fadeOutSamples > target.end - target.start) throw new DvError("AUDIO_FADE", "Each fade must fit the actual audible interval.");
    clips.push(clip);
  }
  return { kind: "audio", trackKey: program.trackKey, axisKey: program.timeline.axisKey, clips };
}
