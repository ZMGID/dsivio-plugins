import { DvError } from "../../core/errors.ts";
import type { Bounds, Clock, Timeline } from "../../timeline/types.ts";
import type { VideoSamplingMap } from "../../render/ir.ts";
import type { Json } from "../../core/value.ts";
import { validateSynchronizedMedia } from "../../timeline/validate.ts";
import { validateSurface } from "../../render/validate.ts";
import { validateMedia } from "../../modules/media/index.ts";
import { validateExtent } from "../../space/validate.ts";
import type { MediaPlayback, MediaSource, SourceTiming } from "./types.ts";
import { object } from "../sound/validate.ts";
export function validateSource(data: unknown, timeline?: Timeline): asserts data is MediaSource {
  const source = object(data, ["kind"], ["resource", "extent", "media", "surface"]);
  let timing: SourceTiming | undefined;
  if (source.kind === "image") { object(data, ["kind", "resource", "extent"]); validateMedia(source.resource as Json, "image"); validateExtent(source.extent); return; }
  if (source.kind === "media") { object(data, ["kind", "media"]); validateSynchronizedMedia(source.media); if (!source.media.picture) throw new DvError("MEDIA_PICTURE", "Visual media requires a normalized picture member."); timing = source.media; }
  else if (source.kind === "surface") { object(data, ["kind", "surface"]); validateSurface(source.surface); if (source.surface.timing.kind === "frames") timing = source.surface.timing; }
  else throw new DvError("MEDIA_SOURCE", "Unknown source kind.");
  if (timeline && timing && (timeline.clock.fps.numerator !== timing.clock.fps.numerator || timeline.clock.fps.denominator !== timing.clock.fps.denominator)) throw new DvError("MEDIA_CLOCK", "Source clock must match Timeline clock.");
}
/** Sampling uses one fixed origin; expanded lifetimes never restart source phase internally. */
export function visualSampling(sourceClock: Clock, sourceTotalFrames: number, trim: Bounds, playback: MediaPlayback, lifetime: Bounds, logical: Bounds): VideoSamplingMap {
  if (!Number.isSafeInteger(trim.start) || !Number.isSafeInteger(trim.end) || trim.start < 0 || trim.end > sourceTotalFrames || trim.end <= trim.start) throw new DvError("MEDIA_TRIM", "Source frame trim is out of range.");
  const count = trim.end - trim.start, length = logical.end - logical.start;
  const result: VideoSamplingMap = { sourceClock, sourceTotalFrames, pieces: [] };
  if (playback.startsWith("loop")) {
    const offset = lifetime.start - logical.start + (playback === "loop-end" ? count - length % count : 0), phase = ((offset % count) + count) % count;
    result.pieces.push({ target: { start: 0, end: lifetime.end - lifetime.start }, sourceStart: { numerator: trim.start + phase, denominator: 1 }, sourceStep: { numerator: 1, denominator: 1 }, loop: { sourceFrames: trim, phase: { numerator: phase, denominator: 1 } } });
    return result;
  }
  if (playback === "stretch") {
    if (lifetime.start !== logical.start || lifetime.end !== logical.end) throw new DvError("MEDIA_STRETCH", "Stretch lifetime must match the source sampling window.");
    result.pieces.push({ target: { start: 0, end: length }, sourceStart: { numerator: trim.start, denominator: 1 }, sourceStep: { numerator: count, denominator: length } });
    return result;
  }
  const sourceZero = logical.start - (playback.endsWith("end") ? count - length : 0);
  const start = Math.min(lifetime.end, Math.max(lifetime.start, sourceZero)), end = Math.max(lifetime.start, Math.min(lifetime.end, sourceZero + count));
  if (playback.startsWith("hold") && lifetime.start < start) result.pieces.push({ target: { start: 0, end: start - lifetime.start }, sourceStart: { numerator: trim.start, denominator: 1 }, sourceStep: { numerator: 0, denominator: 1 } });
  if (end > start) result.pieces.push({ target: { start: start - lifetime.start, end: end - lifetime.start }, sourceStart: { numerator: trim.start + start - sourceZero, denominator: 1 }, sourceStep: { numerator: 1, denominator: 1 } });
  if (playback.startsWith("hold") && end < lifetime.end) result.pieces.push({ target: { start: Math.max(0, end - lifetime.start), end: lifetime.end - lifetime.start }, sourceStart: { numerator: trim.end - 1, denominator: 1 }, sourceStep: { numerator: 0, denominator: 1 } });
  return result;
}
