import { DvError } from "../core/errors.ts";
import type { AuthoringElement, AuthoringUnit } from "../core/authoring.ts";
import type { Instant, Timeline } from "../timeline/types.ts";
import { serializeAttributeReference, serializeAttributeValue } from "../markup/parse.ts";
import { validateInstant, validateWindow } from "../timeline/validate.ts";
import type { SourcePatch, TemporalAuthority } from "./companion.ts";
import type { TimeEditRequest, ViewRevision } from "./protocol.ts";
import { attributePatch, readyView, sourceOverlay } from "./edits.ts";
import type { EditSession } from "./edits.ts";

function originFrame(instant: Instant, timeline: Timeline): number {
  if (instant.origin.kind === "absolute") return 0;
  if (instant.origin.kind === "program") return instant.origin.edge === "start" ? 0 : timeline.totalFrames;
  const reference = instant.origin.reference;
  const anchorKey = reference.kind === "moment" ? reference.anchorKey : reference.anchors[instant.origin.edge === "end" ? "end" : "start"];
  if (anchorKey === timeline.storyAnchors?.start) return 0;
  if (anchorKey === timeline.storyAnchors?.end) return timeline.totalFrames;
  for (const placement of timeline.placements) {
    const frame = placement.take.anchorFrames[anchorKey];
    if (frame !== undefined) return placement.offsetFrames + frame;
  }
  throw new DvError("STUDIO_TIME_ANCHOR_MISSING", "The temporal origin is not placed in this Timeline.");
}
export function frameExpression(instant: Instant, frame: number, timeline: Timeline): string {
  if (instant.origin.kind === "absolute") return `${frame}f`;
  const base = instant.origin.kind === "program" ? `program.${instant.origin.edge}` : `${instant.origin.reference.kind}.${instant.origin.edge}`;
  const offset = frame - originFrame(instant, timeline);
  return `${base}${offset ? `${offset < 0 ? "-" : "+"}${Math.abs(offset)}f` : ""}`;
}
function patch(unit: AuthoringUnit, start: number, end: number, text: string): SourcePatch {
  return { unit: unit.unit, start, end, expectedText: unit.text.slice(start, end), text };
}
function pointPatches(unit: AuthoringUnit, owner: AuthoringElement, name: string, instant: Instant, frame: number, timeline: Timeline): SourcePatch[] {
  const attr = owner.attributes.find(a => a.name === name);
  if (!attr) throw new DvError("STUDIO_TIME_ENDPOINT_MISSING", `Temporal author has no ${name} endpoint.`);
  const expression = frameExpression(instant, frame, timeline);
  if (attr.attribute.value.kind === "literal") return [attributePatch(unit, owner, name, expression)];
  if (instant.origin.kind !== "semantic") throw new DvError("STUDIO_TIME_READONLY", "A reference requires an explicit semantic origin.");
  const reference = serializeAttributeReference(attr.attribute.value.name);
  const kind = instant.origin.reference.kind;
  if (name === "at" && !owner.attributes.some(a => a.name === "for")) {
    const additions = ` instant=${serializeAttributeValue(expression)} ${kind}=${reference}`;
    const boundary = owner.attributes.find(a => a.name === "boundary");
    return [patch(unit, attr.fullSpan.start, attr.fullSpan.end, ""), ...(boundary ? [patch(unit, boundary.fullSpan.start, boundary.fullSpan.end, "")] : []), patch(unit, owner.insertion.start, owner.insertion.end, additions)];
  }
  if (name !== "at" && name !== "until") throw new DvError("STUDIO_TIME_READONLY", "This referenced endpoint has no supported offset inverse.");
  const named = owner.attributes.find(a => a.name === kind);
  if (named && (named.attribute.value.kind !== "ref" || named.attribute.value.name !== attr.attribute.value.name)) throw new DvError("STUDIO_TIME_AMBIGUOUS", "The temporal expression has another semantic binding.");
  const boundary = owner.attributes.find(a => a.name === "boundary");
  return [patch(unit, attr.valueSpan.start, attr.valueSpan.end, serializeAttributeValue(expression)), ...(boundary ? [patch(unit, boundary.fullSpan.start, boundary.fullSpan.end, "")] : []), ...(!named ? [patch(unit, owner.insertion.start, owner.insertion.end, ` ${kind}=${reference}`)] : [])];
}
function nearestAnchor(anchors: readonly { anchorKey: string; frame: number }[], target: number): { anchorKey: string; frame: number } {
  let nearest = anchors[0];
  for (const anchor of anchors) if (!nearest || Math.abs(anchor.frame - target) < Math.abs(nearest.frame - target)) nearest = anchor;
  if (!nearest) throw new DvError("STUDIO_TIME_ANCHOR_MISSING", "No legal Script insertion anchors are placed.");
  return nearest;
}
function scriptPatches(session: EditSession, authority: TemporalAuthority, request: TimeEditRequest, timeline: Timeline): SourcePatch[] {
  const owner = session.authoring.elements.get(authority.originKey);
  const unit = owner ? session.authoring.units.get(owner.sourceUnit) : undefined;
  const facet = session.companions?.find(c => c.moduleId === owner?.moduleId && c.script)?.script;
  if (!owner?.rawBody || !unit || !facet) throw new DvError("STUDIO_TIME_READONLY", "The Script owner has no registered marker inverse.");
  const anchors = authority.anchors ?? [];
  const split = authority.key.lastIndexOf(":");
  const name = authority.key.slice(0, split); const edge = authority.key.slice(split + 1);
  const instructions: { marker: string; anchor: string }[] = [];
  const oldStart = authority.window?.frames.start ?? authority.instant?.frame;
  const oldEnd = authority.window?.frames.end;
  if (oldStart === undefined) throw new DvError("STUDIO_TIME_ENDPOINT_MISSING", "A semantic authority requires placed time facts.");
  if (request.gesture === "reanchor") {
    if (!anchors.some(a => a.anchorKey === request.anchorKey)) throw new DvError("STUDIO_TIME_ANCHOR_INVALID", "The requested anchor is not declared by this authority.");
    if (edge === "range") throw new DvError("STUDIO_TIME_REQUEST", "Reanchor requires one explicit marker edge.");
    instructions.push({ marker: `${name}:${edge}`, anchor: request.anchorKey! });
  } else if (request.gesture === "move" && authority.window) {
    const stops = [...new Set(anchors.map(a => a.frame))].sort((a, b) => a - b);
    const target = nearestAnchor(anchors, request.targetFrame ?? oldStart + request.deltaFrames!).frame;
    const startIndex = stops.indexOf(oldStart); const endIndex = stops.indexOf(oldEnd!);
    const shift = stops.indexOf(target) - startIndex;
    if (startIndex < 0 || endIndex < 0 || startIndex + shift < 0 || endIndex + shift >= stops.length) throw new DvError("STUDIO_TIME_OUTSIDE", "The semantic move exceeds its legal docking points.");
    if (shift === 0) return [];
    const start = stops[startIndex + shift]!; const end = stops[endIndex + shift]!;
    if (end <= start) throw new DvError("STUDIO_TIME_WINDOW", "A selection must retain a positive window.");
    instructions.push({ marker: `${name}:start`, anchor: nearestAnchor(anchors, start).anchorKey }, { marker: `${name}:end`, anchor: nearestAnchor(anchors, end).anchorKey });
  } else {
    const target = nearestAnchor(anchors, request.targetFrame ?? oldStart + request.deltaFrames!);
    const markerEdge = request.gesture === "trim-start" ? "start" : request.gesture === "trim-end" ? "end" : edge;
    if (target.frame === (markerEdge === "end" ? oldEnd : oldStart)) return [];
    if (authority.window && (markerEdge === "start" ? target.frame >= oldEnd! : target.frame <= oldStart)) throw new DvError("STUDIO_TIME_WINDOW", "A selection must retain a positive window.");
    instructions.push({ marker: `${name}:${markerEdge}`, anchor: target.anchorKey });
  }
  const text = unit.text.slice(owner.rawBody.start, owner.rawBody.end);
  return instructions.flatMap(instruction => facet.rewriteAnchor({ text, sourceUnit: unit.unit, anchorKey: instruction.marker, targetAnchorKey: instruction.anchor, timeline }).map(p => ({ ...p, start: p.start + owner.rawBody!.start, end: p.end + owner.rawBody!.start })));
}
export function temporalPatches(session: EditSession, authority: TemporalAuthority, request: TimeEditRequest, timeline: Timeline): readonly SourcePatch[] {
  if (!authority.gestures.includes(request.gesture)) throw new DvError("STUDIO_TIME_READONLY", "The requested temporal gesture is not authorized.");
  if (authority.originKind === "semantic") return scriptPatches(session, authority, request, timeline);
  if (authority.originKind !== "parameter" || authority.binding?.access !== "write") throw new DvError("STUDIO_TIME_READONLY", "This timing is fixed or derived.");
  const owner = session.authoring.elements.get(authority.originKey);
  const unit = owner ? session.authoring.units.get(owner.sourceUnit) : undefined;
  if (!owner || !unit || authority.binding.sourceUnit !== unit.unit) throw new DvError("STUDIO_TIME_ENDPOINT_MISSING", "The temporal source owner no longer exists.");
  if (request.gesture === "reanchor") throw new DvError("STUDIO_TIME_READONLY", "This local timing does not permit semantic reanchoring.");
  if (authority.instant) {
    validateInstant(authority.instant);
    const target = request.targetFrame ?? authority.instant.frame + request.deltaFrames!;
    if (target < 0 || target > timeline.totalFrames) throw new DvError("STUDIO_TIME_OUTSIDE", "The Instant exceeds the Program range.");
    if (target === authority.instant.frame) return [];
    return pointPatches(unit, owner, owner.attributes.some(a => a.name === "instant") ? "instant" : "at", authority.instant, target, timeline);
  }
  if (!authority.window) throw new DvError("STUDIO_TIME_ENDPOINT_MISSING", "The temporal authority has no Window or Instant.");
  validateWindow(authority.window);
  const old = authority.window.frames;
  const delta = request.deltaFrames ?? (request.targetFrame ?? old.start) - old.start;
  const start = request.gesture === "move" ? old.start + delta : request.gesture === "trim-start" ? request.targetFrame! : old.start;
  const end = request.gesture === "move" ? old.end + delta : request.gesture === "trim-end" ? request.targetFrame! : old.end;
  if (start === old.start && end === old.end) return [];
  if (start < 0 || end > timeline.totalFrames || end <= start) throw new DvError("STUDIO_TIME_WINDOW", "A temporal window must be positive and inside the Program range.");
  const names = owner.attributes.map(a => a.name);
  if (names.includes("at") && names.includes("for")) {
    if (request.gesture === "trim-start") throw new DvError("STUDIO_TIME_READONLY", "An at/for window has no independent start trim.");
    return request.gesture === "move" ? pointPatches(unit, owner, "at", authority.window.leading, start, timeline) : [attributePatch(unit, owner, "for", `${end - start}f`)];
  }
  if (names.includes("until") && names.includes("for")) {
    if (request.gesture === "trim-end") throw new DvError("STUDIO_TIME_READONLY", "An until/for window has no independent end trim.");
    return request.gesture === "move" ? pointPatches(unit, owner, "until", authority.window.trailing, end, timeline) : [attributePatch(unit, owner, "for", `${end - start}f`)];
  }
  if (names.includes("start") && names.includes("end")) return [...(request.gesture !== "trim-end" ? pointPatches(unit, owner, "start", authority.window.leading, start, timeline) : []), ...(request.gesture !== "trim-start" ? pointPatches(unit, owner, "end", authority.window.trailing, end, timeline) : [])];
  throw new DvError("STUDIO_TIME_READONLY", "The temporal author has no supported inverse form.");
}
export async function applyTimeEdit(session: EditSession, request: TimeEditRequest): Promise<ViewRevision> {
  if (!request || typeof request.editorKey !== "string" || typeof request.authorityKey !== "string" || !["move", "trim-start", "trim-end", "reanchor"].includes(request.gesture)) throw new DvError("STUDIO_TIME_REQUEST", "Invalid temporal request identity or gesture.");
  const view = readyView(session, request.expectedViewRevision);
  const target = request.targetFrame !== undefined; const delta = request.deltaFrames !== undefined; const anchor = request.anchorKey !== undefined;
  if (request.gesture === "move" ? target === delta || anchor : request.gesture === "reanchor" ? !anchor || target || delta || typeof request.anchorKey !== "string" : !target || delta || anchor) throw new DvError("STUDIO_TIME_REQUEST", "A temporal gesture requires exactly its mutually exclusive frame or anchor payload.");
  if (target && (!Number.isSafeInteger(request.targetFrame) || request.targetFrame! < 0 || request.targetFrame! > view.totalFrames) || delta && !Number.isSafeInteger(request.deltaFrames)) throw new DvError("STUDIO_TIME_REQUEST", "Temporal gestures require integer Program frames.");
  const entity = view.entities.find(e => e.editorKey === request.editorKey);
  if (!entity) throw new DvError("STUDIO_ENTITY_MISSING", "The selected author entity no longer exists.");
  const authorities = entity.temporal.filter(a => a.key === request.authorityKey);
  if (authorities.length !== 1) throw new DvError(authorities.length ? "STUDIO_TIME_AMBIGUOUS" : "STUDIO_TIME_ENDPOINT_MISSING", "This entity has no unique temporal authority.");
  const overlay = sourceOverlay(session, temporalPatches(session, authorities[0]!, request, view.timeline));
  return overlay.size ? session.transaction(overlay) : view;
}
