import { DvError } from "../core/errors.ts";
import type { InspectedStream, Inspection, StreamPolicy, StreamSelection } from "./types.ts";
import { validateInspection, validatePolicy, validateSelection } from "./validate.ts";

export function selectStreams(inspection: Inspection, policy: StreamPolicy): StreamSelection {
  validateInspection(inspection); validatePolicy(policy);
  const choose = (kind: "video" | "audio", rule: string): number | undefined => {
    if (rule === "none") return undefined;
    const valid = (s: InspectedStream): boolean => s.kind === kind && Boolean(s.timing) && (kind !== "video" || Boolean(s.picture?.moving && !s.attachedPicture));
    if (rule.startsWith("stream:")) {
      const index = Number(rule.slice(7));
      const stream = inspection.streams.find(s => s.streamIndex === index);
      if (!stream || !valid(stream)) throw new DvError("STREAM_SELECTION_INVALID", `Stream ${index} is not a valid timed ${kind} stream`);
      return index;
    }
    const candidates = inspection.streams.filter(valid);
    const defaults = candidates.filter(s => s.default);
    const choices = defaults.length ? defaults : candidates;
    if (choices.length !== 1) throw new DvError("STREAM_SELECTION_AMBIGUOUS", `${kind} requires one default or one candidate; candidates=[${candidates.map(s => s.streamIndex)}], defaults=[${defaults.map(s => s.streamIndex)}]`);
    return choices[0]!.streamIndex;
  };
  const videoIndex = choose("video", policy.video);
  const audioIndex = choose("audio", policy.audio);
  const result: StreamSelection = { inspection, spanAuthority: policy.spanAuthority, ...(videoIndex === undefined ? {} : { videoIndex }), ...(audioIndex === undefined ? {} : { audioIndex }) };
  validateSelection(result);
  return result;
}
