import { DvError, spanAt } from "../../core/errors.ts";
import type { Narrative } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { parseScript, rewriteScriptAnchor } from "../../timeline/script.ts";
import { projectInstant, projectWindow } from "../../timeline/temporal.ts";
import type { CompanionInput, ScriptObservation, StudioCompanion, StudioEntity, TemporalAuthority } from "../../studio/companion.ts";

function observeScript(input: CompanionInput): ScriptObservation {
  const narrative = input.value.data as unknown as Narrative;
  const author = input.authoring.elements.get(input.authorKey);
  const unit = author ? input.authoring.units.get(author.sourceUnit) : undefined;
  const body = author?.rawBody;
  const idAttribute = author?.attributes.find(attribute => attribute.name === "id")?.attribute.value;
  const parsed = unit && body ? parseScript(unit.text.slice(body.start, body.end), idAttribute?.kind === "literal" ? idAttribute.text.trim() : input.authorKey, unit.file, body.start, body) : undefined;
  const frames = new Map<string, number>();
  if (input.timeline.storyAnchors) { frames.set(input.timeline.storyAnchors.start, 0); frames.set(input.timeline.storyAnchors.end, input.timeline.totalFrames); }
  for (const placement of input.timeline.placements) for (const [key, frame] of Object.entries(placement.take.anchorFrames)) frames.set(key, frame + placement.offsetFrames);
  const rows: StudioEntity[] = [];
  const laneKey = `${input.authorKey}/semantic`;
  const legalAnchors = [...new Set(parsed?.sourceMap.gaps.map(gap => gap.anchorKey) ?? [])].flatMap(anchorKey => frames.has(anchorKey) ? [{ anchorKey, frame: frames.get(anchorKey)! }] : []);
  const add = (key: string, title: string, startKey: string, endKey: string | undefined, band: NonNullable<StudioEntity["semanticKind"]>, text?: string) => {
    const start = frames.get(startKey); const end = endKey ? frames.get(endKey) : start;
    if (start === undefined || end === undefined || band === "selection" && end <= start) return;
    const raw = band === "segment" ? parsed?.sourceMap.segments.find(item => item.name === key)?.slice : band === "word" ? parsed?.sourceMap.tokens[narrative.tokens.findIndex(item => item.tokenKey === key)]?.slices[0] : parsed?.sourceMap.markers.find(item => item.name === key);
    const temporal: TemporalAuthority[] = [];
    if (parsed && unit && (band === "selection" || band === "moment")) {
      const edges = band === "moment" ? ["cue"] as const : ["start", "end", "range"] as const;
      const selection = narrative.selections.find(selection => selection.selectionKey === key);
      const moment = narrative.moments.find(moment => moment.momentKey === key);
      for (const edge of edges) {
        const markerKey = `${key}:${edge}`;
        temporal.push({ key: markerKey, originKind: "semantic", originKey: input.authorKey, consumerPort: markerKey, ...(selection ? { window: projectWindow(input.timeline, { kind: "during", source: selection }, markerKey) } : moment ? { instant: projectInstant(input.timeline, { kind: "at", source: moment }, markerKey) } : {}), ...(edge === "range" ? {} : { anchorKey: edge === "end" ? endKey! : startKey }), gestures: edge === "start" ? ["trim-start", "reanchor"] : edge === "end" ? ["trim-end", "reanchor"] : edge === "range" ? ["move"] : ["move", "reanchor"], anchors: legalAnchors, binding: { ownerKey: input.authorKey, sourceUnit: unit.unit, attribute: "$body", access: "write" } });
      }
    }
    const editorIdentity = band === "word" ? String(narrative.tokens.findIndex(token => token.tokenKey === key)) : key;
    rows.push({ editorKey: `${input.authorKey}/${band}/${editorIdentity}`, authorKey: input.authorKey, title, paintRank: rows.length, intervals: [{ start, end: Math.max(start + 1, end) }], laneKey, bandKey: `${laneKey}/${band}`, semanticKind: band, ...(text === undefined ? {} : { text }), pictureParts: [], parameterOwners: [], facts: { storyKey: narrative.storyKey, anchorKey: startKey, ...(endKey ? { endAnchorKey: endKey } : {}), ...(band === "selection" ? { selectionKey: key } : band === "moment" ? { momentKey: key } : {}) }, temporal, ...(raw && unit && body ? { sourceSlice: { unit: unit.unit, span: spanAt(unit.file, unit.text, raw.start, raw.end), text: raw.text } } : input.sourceSlice ? { sourceSlice: input.sourceSlice } : {}) });
  };
  for (const segment of narrative.segments) { const name = parsed?.sourceMap.segments.find(item => item.segmentKey.split(":").slice(2).join(":") === segment.segmentKey.split(":").slice(2).join(":"))?.name ?? segment.segmentKey.split(":").at(-1)!; add(name, name, segment.anchors.start, segment.anchors.end, "segment"); }
  for (const token of narrative.tokens) add(token.tokenKey, token.speechText, token.anchors.start, token.anchors.end, "word", token.speechText);
  for (const selection of narrative.selections) add(selection.selectionKey, selection.selectionKey, selection.anchors.start, selection.anchors.end, "selection");
  for (const moment of narrative.moments) add(moment.momentKey, moment.momentKey, moment.anchorKey, undefined, "moment");
  return { rows, anchors: narrative.anchors.map(anchor => ({ anchorKey: anchor.anchorKey, ...(frames.has(anchor.anchorKey) ? { frame: frames.get(anchor.anchorKey)! } : {}) })) };
}

export const scriptStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/script@1/narrative", moduleId: "dsivio-video/script@1",
  matches: [{ surface: "Script", output: "", type: timelineTypes.narrative }], family: "script", icon: "script", tone: "neutral",
  project(input) {
    const entities = observeScript(input).rows; const laneKey = `${input.authorKey}/semantic`;
    return { entities, lanes: [{ key: laneKey, title: "Script", height: 24, order: -1 }], bands: ["segment", "word", "selection", "moment"].filter(kind => entities.some(entity => entity.bandKey === `${laneKey}/${kind}`)).map((kind, order) => ({ key: `${laneKey}/${kind}`, laneKey, title: kind, height: 20, order })), materials: [], fieldGroups: [], parameterOwners: [] };
  },
  script: {
    observe: observeScript,
    rewriteAnchor(input) {
      const split = input.anchorKey.lastIndexOf(":"); const name = input.anchorKey.slice(0, split); const edge = input.anchorKey.slice(split + 1);
      if (edge !== "start" && edge !== "end" && edge !== "cue") throw new DvError("STUDIO_SCRIPT_MARKER_INVALID", "Marker identity must be name:start, name:end or name:cue");
      const parsed = parseScript(input.text, "studio-inverse");
      const target = parsed.sourceMap.gaps.find(gap => gap.anchorKey.split(":").slice(2).join(":") === input.targetAnchorKey.split(":").slice(2).join(":"));
      if (!target) throw new DvError("STUDIO_SCRIPT_ANCHOR_MISSING", "Target anchor is not in this Script");
      return rewriteScriptAnchor(parsed.sourceMap, name, edge, target.anchorKey).map(patch => ({ ...patch, unit: input.sourceUnit }));
    },
  },
};
