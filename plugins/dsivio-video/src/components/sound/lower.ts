import type { AudioClip, AudioTrack } from "../../render/ir.ts";
import type { SoundProgram } from "../types.ts";
import { frameToSample48k } from "../../timeline/math.ts";
import { stableIdentity } from "../../timeline/identity.ts";
import { subtractWindows, validateSoundProgram } from "./validate.ts";

export function lowerSound(program: SoundProgram): AudioTrack {
  validateSoundProgram(program);
  const { timeline } = program;
  const boundary = (frame: number): number => frameToSample48k(frame, timeline.clock);
  const clips: AudioClip[] = [];
  for (const [useIndex, use] of program.uses.entries()) {
    if (use.style.gain === 0 && use.style.endGain === 0) continue;
    const laterUses = program.uses.slice(useIndex + 1).map(item => item.window.frames);
    for (const [placementIndex, placement] of timeline.placements.entries()) {
      const media = placement.take.media;
      if (!media.sound) continue;
      const target = { start: Math.max(use.window.frames.start, placement.offsetFrames), end: Math.min(use.window.frames.end, placement.offsetFrames + media.totalFrames) };
      if (target.end <= target.start) continue;
      const laterSources = timeline.placements.slice(placementIndex + 1).filter(item => item.take.media.sound).map(item => ({ start: item.offsetFrames, end: item.offsetFrames + item.take.media.totalFrames }));
      const audible = subtractWindows(target, [...laterSources, ...laterUses]).map(piece => ({ start: boundary(piece.start), end: boundary(piece.end) })).filter(piece => piece.end > piece.start);
      const targetSamples = { start: boundary(target.start), end: boundary(target.end) };
      if (!audible.length || targetSamples.end <= targetSamples.start) continue;
      // A placement has one sample origin. Re-rounding Use-local frames would shift
      // source phase at fractional FPS; only the final padded tail can exceed the source.
      const sourceOrigin = boundary(placement.offsetFrames);
      clips.push({
        clipKey: stableIdentity("sound-clip", { trackKey: program.trackKey, useKey: use.useKey, placementKey: placement.placementKey }),
        source: media.sound.resource, sourceTotalSamples: media.sound.totalSamples,
        sourceSamples: { start: targetSamples.start - sourceOrigin, end: Math.min(media.sound.totalSamples, targetSamples.end - sourceOrigin) },
        targetSamples, speed: { numerator: 1, denominator: 1 }, preservePitch: true, gain: 1, fadeInSamples: 0, fadeOutSamples: 0,
        gainCurve: [{ sample: boundary(use.window.frames.start), gain: use.style.gain }, { sample: boundary(use.window.frames.end), gain: use.style.endGain }],
        audible,
      });
    }
  }
  return { kind: "audio", trackKey: program.trackKey, axisKey: timeline.axisKey, clips };
}
