import { DvError } from "../core/errors.ts";
import { MASTER_SAMPLE_RATE } from "./types.ts";
import type { Clock, FrameToSampleBoundary } from "./types.ts";

export function validateClock(clock: Clock): void {
  if (!Number.isSafeInteger(clock.fps.numerator) || clock.fps.numerator <= 0 || !Number.isSafeInteger(clock.fps.denominator) || clock.fps.denominator <= 0) {
    throw new DvError("CLOCK_INVALID", "FPS numerator and denominator must be positive safe integers");
  }
}

export const frameToSample48k: FrameToSampleBoundary = (frameBoundary, clock) => {
  validateClock(clock);
  if (!Number.isSafeInteger(frameBoundary) || frameBoundary < 0) throw new DvError("FRAME_INVALID", "Frame boundary must be a nonnegative safe integer");
  const numerator = BigInt(frameBoundary) * BigInt(MASTER_SAMPLE_RATE) * BigInt(clock.fps.denominator);
  const denominator = BigInt(clock.fps.numerator);
  const samples = (2n * numerator + denominator) / (2n * denominator);
  if (samples > BigInt(Number.MAX_SAFE_INTEGER)) throw new DvError("SAMPLE_OVERFLOW", "Sample boundary exceeds the safe integer domain");
  return Number(samples);
};
