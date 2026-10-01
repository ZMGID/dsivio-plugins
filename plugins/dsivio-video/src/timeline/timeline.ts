import { DvError } from "../core/errors.ts";
import { stableIdentity } from "./identity.ts";
import { durationFrames, exactFrame, offsetFrames } from "./temporal.ts";
import { validateClockData, validatePlacementPlan, validateSemanticTake, validateTimeline } from "./validate.ts";
import type { Clock, PlacementPlan, SemanticTake, Timeline } from "./types.ts";

export function parseClock(source: string): Clock {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(source);
  if (!match) throw new DvError("CLOCK_INVALID", "Frame rate requires an integer or integer ratio");
  const clock = { fps: { numerator: Number(match[1]), denominator: Number(match[2] ?? "1") } }; validateClockData(clock); return clock;
}
export function assembleTimeline(clock: Clock, takes: SemanticTake[], plan: PlacementPlan, end?: string): Timeline {
  validateClockData(clock);
  validatePlacementPlan(plan);
  if (plan.placements.length !== takes.length) throw new DvError("TIMELINE_PLAN", "Placement plan and takes must have equal lengths");
  let previousEnd = 0; let contentEnd = 0;
  const placements = takes.map((take, index) => {
    validateSemanticTake(take); const declaration = plan.placements[index]!; const expression = declaration.at ?? (index ? "previous.end" : "0f");
    const relative = /^previous\.end(?:([+-])(\d+(?:\.\d+)?(?:f|ms|s)))?$/.exec(expression);
    if (relative && index === 0) throw new DvError("TIMELINE_PREVIOUS", "First placement cannot reference previous.end");
    const offset = exactFrame(relative ? relative[1] ? offsetFrames(previousEnd, relative[2]!, relative[1], clock) : { numerator: BigInt(previousEnd), denominator: 1n } : durationFrames(expression, clock));
    previousEnd = offset + take.media.totalFrames;
    if (!Number.isSafeInteger(previousEnd)) throw new DvError("TIME_OVERFLOW", "Placement end exceeds safe integer frames");
    contentEnd = Math.max(contentEnd, previousEnd); return { placementKey: declaration.placementKey, take, offsetFrames: offset };
  });
  if (!takes.length && !end) throw new DvError("TIMELINE_EMPTY", "A take-less Timeline requires an explicit positive end");
  const expression = end ?? "content.end"; const relative = /^content\.end(?:([+-])(\d+(?:\.\d+)?(?:f|ms|s)))?$/.exec(expression);
  const totalFrames = exactFrame(relative ? relative[1] ? offsetFrames(contentEnd, relative[2]!, relative[1], clock) : { numerator: BigInt(contentEnd), denominator: 1n } : durationFrames(expression, clock));
  if (totalFrames <= 0 || totalFrames < contentEnd) throw new DvError("TIMELINE_END", "Timeline end must be positive and contain every placement");
  const result: Timeline = { axisKey: stableIdentity("axis", { timelineKey: plan.timelineKey, clock, totalFrames, placements: placements.map(p => ({ placementKey: p.placementKey, storyKey: p.take.storyKey, segmentKey: p.take.segment.segmentKey, offsetFrames: p.offsetFrames, totalFrames: p.take.media.totalFrames })) }), clock, totalFrames, placements, ...(takes.length ? { storyKey: takes[0]!.storyKey, storyAnchors: takes[0]!.storyAnchors } : {}) };
  validateTimeline(result); return result;
}
