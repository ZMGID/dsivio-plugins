import { DvError } from "../core/errors.ts";
import { frameToSample48k } from "./math.ts";
import { tokenAnchorKey } from "./identity.ts";
import type { AnchorPair, Bounds, CaptionDocument, Clock, Instant, Narrative, SegmentRef, SelectionRef, MomentRef, SemanticTake, SynchronizedMedia, Timeline, Window } from "./types.ts";
import type { Adjustment, PlacementPlan } from "./types.ts";

export function invalid(message: string): never { throw new DvError("TYPE_INVALID", message); }
export function object(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) invalid("Expected an object");
  return data as Record<string, unknown>;
}
export function text(data: unknown): asserts data is string { if (typeof data !== "string" || !data.trim()) invalid("Expected a nonempty string"); }
export function integer(data: unknown, minimum = 0): asserts data is number { if (typeof data !== "number" || !Number.isSafeInteger(data) || data < minimum) invalid(`Expected a safe integer >= ${minimum}`); }
export function array(data: unknown): asserts data is unknown[] { if (!Array.isArray(data)) invalid("Expected an array"); }
export function unique(keys: string[], label: string): void { if (new Set(keys).size !== keys.length) invalid(`Duplicate ${label}`); }
export function validateBounds(data: unknown, maximum = Number.MAX_SAFE_INTEGER, positive = false): asserts data is Bounds {
  const d = object(data); integer(d.start); integer(d.end); if (d.end > maximum || d.start > d.end || (positive && d.start === d.end)) invalid("Invalid half-open bounds");
}
export function validateAnchorPair(data: unknown, allowSame = false): asserts data is AnchorPair {
  const d = object(data); text(d.start); text(d.end); if (!allowSame && d.start === d.end) invalid("Start and end anchors must have distinct identities");
}
export function validateClockData(data: unknown): asserts data is Clock {
  const d = object(data); const fps = object(d.fps); integer(fps.numerator, 1); integer(fps.denominator, 1);
}
export function validateSegmentRef(data: unknown): asserts data is SegmentRef {
  const d = object(data); if (d.kind !== "segment") invalid("Expected SegmentRef"); text(d.storyKey); text(d.segmentKey); validateBounds(d.tokenBounds); validateAnchorPair(d.anchors);
}
export function validateSelectionRef(data: unknown): asserts data is SelectionRef {
  const d = object(data); if (d.kind !== "selection") invalid("Expected SelectionRef"); text(d.storyKey); text(d.selectionKey); validateBounds(d.tokenBounds); validateAnchorPair(d.anchors, true);
}
export function validateMomentRef(data: unknown): asserts data is MomentRef {
  const d = object(data); if (d.kind !== "moment") invalid("Expected MomentRef"); text(d.storyKey); text(d.momentKey); text(d.anchorKey);
}
export function validateCaptionDocument(data: unknown): asserts data is CaptionDocument {
  const d = object(data); text(d.storyKey); array(d.units); array(d.cues);
  const units = new Map<string, Bounds>();
  for (const item of d.units) {
    const u = object(item); text(u.unitKey); if (typeof u.text !== "string" || typeof u.separator !== "string" || !/^\s*$/.test(u.separator)) invalid("Invalid caption text or separator"); validateBounds(u.tokenBounds, Number.MAX_SAFE_INTEGER, true);
    const attrs = object(u.attributes); for (const value of Object.values(attrs)) if (!(["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value))) invalid("Caption attributes must be finite scalars");
    if (units.has(u.unitKey)) invalid("Duplicate caption unit"); units.set(u.unitKey, u.tokenBounds);
  }
  const used: string[] = []; const cueKeys: string[] = [];
  for (const item of d.cues) { const c = object(item); text(c.cueKey); text(c.segmentKey); text(c.turnKey); array(c.unitKeys); if (!c.unitKeys.length) invalid("Empty caption cue"); for (const key of c.unitKeys) { text(key); if (!units.has(key)) invalid("Unknown caption unit"); used.push(key); } cueKeys.push(c.cueKey); }
  unique(cueKeys, "caption cue"); unique(used, "caption cue unit"); if (used.length !== units.size || used.some((key, i) => key !== [...units.keys()][i])) invalid("Caption cues must cover units in author order");
}
export function validateNarrative(data: unknown): asserts data is Narrative {
  const d = object(data); text(d.storyKey); validateAnchorPair(d.storyAnchors);
  for (const key of ["segments", "turns", "tokens", "anchors", "selections", "moments"]) array(d[key]);
  for (const key of ["segments", "turns", "tokens", "anchors", "selections", "moments"]) for (const item of d[key] as unknown[]) object(item);
  for (const item of d.segments as unknown[]) validateSegmentRef(item);
  for (const item of d.turns as unknown[]) { const turn = object(item); text(turn.turnKey); text(turn.segmentKey); validateBounds(turn.tokenBounds, Number.MAX_SAFE_INTEGER, true); }
  for (const item of d.tokens as unknown[]) { const token = object(item); text(token.tokenKey); text(token.segmentKey); text(token.turnKey); text(token.speechText); text(token.matchText); validateAnchorPair(token.anchors); }
  const n = data as Narrative;
  if (!n.segments.length) invalid("Narrative requires at least one segment");
  const anchors = new Map(n.anchors.map(a => [a.anchorKey, a])); unique(n.anchors.map(a => a.anchorKey), "anchor");
  for (const a of n.anchors) { text(a.anchorKey); text(a.ownerKey); if (!["story", "segment", "token"].includes(a.owner) || !["start", "end"].includes(a.edge)) invalid("Invalid anchor"); }
  if (anchors.size !== 2 * n.tokens.length + 2 * n.segments.length + 2) invalid("Narrative anchor cardinality mismatch");
  const positions = new Map<string, number>();
  const pair = (p: AnchorPair, owner: string, key: string, bounds: Bounds) => { validateAnchorPair(p); for (const edge of ["start", "end"] as const) { const a = anchors.get(p[edge]); if (!a || a.owner !== owner || a.ownerKey !== key || a.edge !== edge) invalid("Anchor ownership mismatch"); positions.set(p[edge], bounds[edge]); } };
  pair(n.storyAnchors, "story", n.storyKey, { start: 0, end: n.tokens.length });
  let cursor = 0; unique(n.segments.map(s => s.segmentKey), "segment");
  for (const s of n.segments) { validateSegmentRef(s); if (s.storyKey !== n.storyKey || s.tokenBounds.start !== cursor || s.tokenBounds.end > n.tokens.length) invalid("Segments must partition author tokens"); cursor = s.tokenBounds.end; pair(s.anchors, "segment", s.segmentKey, s.tokenBounds); }
  if (cursor !== n.tokens.length) invalid("Incomplete segment coverage");
  unique(n.tokens.map(t => t.tokenKey), "token"); unique(n.turns.map(t => t.turnKey), "turn");
  for (let i = 0; i < n.tokens.length; i++) { const t = n.tokens[i]!; text(t.tokenKey); text(t.speechText); text(t.matchText); const s = n.segments.find(s => s.segmentKey === t.segmentKey); const turn = n.turns.find(r => r.turnKey === t.turnKey); if (!s || !turn || turn.segmentKey !== s.segmentKey || i < s.tokenBounds.start || i >= s.tokenBounds.end || i < turn.tokenBounds.start || i >= turn.tokenBounds.end) invalid("Invalid token ownership"); pair(t.anchors, "token", t.tokenKey, { start: i, end: i + 1 }); }
  if (n.anchors[0]!.anchorKey !== n.storyAnchors.start || n.anchors.at(-1)!.anchorKey !== n.storyAnchors.end) invalid("Narrative anchors must be enclosed by story boundaries");
  let previousPosition = 0;
  for (const anchor of n.anchors) { const position = positions.get(anchor.anchorKey)!; if (position < previousPosition) invalid("Narrative anchors are not in author order"); previousPosition = position; }
  const covered = new Set<number>(); for (const turn of n.turns) { text(turn.turnKey); text(turn.segmentKey); if (turn.role !== undefined) text(turn.role); validateBounds(turn.tokenBounds, n.tokens.length, true); const s = n.segments.find(s => s.segmentKey === turn.segmentKey); if (!s || turn.tokenBounds.start < s.tokenBounds.start || turn.tokenBounds.end > s.tokenBounds.end) invalid("Turn exceeds segment"); for (let i = turn.tokenBounds.start; i < turn.tokenBounds.end; i++) { if (covered.has(i) || n.tokens[i]!.turnKey !== turn.turnKey) invalid("Turn coverage mismatch"); covered.add(i); } }
  if (covered.size !== n.tokens.length) invalid("Incomplete turn coverage");
  const names: string[] = [];
  const anchorOrder = new Map(n.anchors.map((anchor, index) => [anchor.anchorKey, index]));
  for (const s of n.selections) {
    validateSelectionRef(s);
    if (s.storyKey !== n.storyKey || s.tokenBounds.end > n.tokens.length || positions.get(s.anchors.start) !== s.tokenBounds.start || positions.get(s.anchors.end) !== s.tokenBounds.end || anchorOrder.get(s.anchors.start)! > anchorOrder.get(s.anchors.end)!) invalid("Selection anchor bounds mismatch");
    names.push(s.selectionKey);
  }
  for (const m of n.moments) { validateMomentRef(m); if (m.storyKey !== n.storyKey || !anchors.has(m.anchorKey)) invalid("Moment references an unknown anchor"); names.push(m.momentKey); } unique(names, "semantic name");
  validateCaptionDocument(n.captions); if (n.captions.storyKey !== n.storyKey) invalid("Caption story mismatch");
  let end = 0; for (const u of n.captions.units) { if (u.tokenBounds.start !== end || u.tokenBounds.end > n.tokens.length) invalid("Caption units must partition tokens"); end = u.tokenBounds.end; } if (end !== n.tokens.length) invalid("Incomplete caption token coverage");
  for (const cue of n.captions.cues) { for (const key of cue.unitKeys) { const unit = n.captions.units.find(u => u.unitKey === key)!; if (n.tokens.slice(unit.tokenBounds.start, unit.tokenBounds.end).some(t => t.segmentKey !== cue.segmentKey || t.turnKey !== cue.turnKey)) invalid("Caption cue ownership mismatch"); } }
}
export function validateSynchronizedMedia(data: unknown): asserts data is SynchronizedMedia {
  const d = object(data); validateClockData(d.clock); integer(d.totalFrames, 1); if (!d.picture && !d.sound) invalid("Media requires picture or sound");
  const resource = (data: unknown) => { const r = object(data); text(r.$resource); integer(r.bytes); text(r.mime); };
  if (d.picture !== undefined) { const p = object(d.picture); resource(p.resource); const e = object(p.extent); for (const key of ["widthPx", "heightPx"]) if (typeof e[key] !== "number" || !Number.isFinite(e[key]) || e[key] <= 0) invalid("Invalid picture extent"); if (p.alpha !== "opaque" && p.alpha !== "straight") invalid("Invalid picture alpha"); }
  if (d.sound !== undefined) { const s = object(d.sound); resource(s.resource); integer(s.totalSamples, 1); if (s.totalSamples !== frameToSample48k(d.totalFrames, d.clock)) invalid("Sound sample count differs from media clock"); }
}
export function validateSemanticTake(data: unknown, allowZeroWidth = true): asserts data is SemanticTake {
  const d = object(data); text(d.storyKey); validateAnchorPair(d.storyAnchors); validateSegmentRef(d.segment); validateSynchronizedMedia(d.media); array(d.tokens); const frames = object(d.anchorFrames); const t = data as SemanticTake;
  if (t.segment.storyKey !== t.storyKey || t.tokens.length !== t.segment.tokenBounds.end - t.segment.tokenBounds.start) invalid("Take segment/token mismatch");
  for (const [key, value] of Object.entries(frames)) { text(key); integer(value); if (value > t.media.totalFrames || key === t.storyAnchors.start || key === t.storyAnchors.end) invalid("Invalid local anchor frame"); }
  if (frames[t.segment.anchors.start] !== 0 || frames[t.segment.anchors.end] !== t.media.totalFrames || Object.keys(frames).length !== 2 + 2 * t.tokens.length) invalid("Take anchors must cover exactly its segment and tokens");
  for (const item of d.tokens) { const token = object(item); text(token.tokenKey); validateBounds(token.frames, t.media.totalFrames, !allowZeroWidth); }
  unique(t.tokens.map(t => t.tokenKey), "take token"); let start = 0; let end = 0;
  for (const token of t.tokens) { text(token.tokenKey); validateBounds(token.frames, t.media.totalFrames, !allowZeroWidth); if (token.frames.start < start || token.frames.end < end) invalid("Nonmonotonic token frames"); if (frames[tokenAnchorKey(token.tokenKey, "start")] !== token.frames.start || frames[tokenAnchorKey(token.tokenKey, "end")] !== token.frames.end) invalid("Token frames differ from anchors"); start = token.frames.start; end = token.frames.end; }
}
export function validateTimeline(data: unknown): asserts data is Timeline {
  const d = object(data); text(d.axisKey); validateClockData(d.clock); integer(d.totalFrames, 1); array(d.placements); const t = data as Timeline;
  for (const item of d.placements) object(item);
  if (!t.placements.length) { if (d.storyKey !== undefined || d.storyAnchors !== undefined) invalid("Empty timeline cannot have a story"); return; }
  text(d.storyKey); validateAnchorPair(d.storyAnchors); const segments: string[] = []; const tokens: string[] = []; const anchors: string[] = [];
  for (const p of t.placements) { text(p.placementKey); integer(p.offsetFrames); validateSemanticTake(p.take); if (p.take.storyKey !== t.storyKey || p.take.storyAnchors.start !== t.storyAnchors!.start || p.take.storyAnchors.end !== t.storyAnchors!.end || p.take.media.clock.fps.numerator !== t.clock.fps.numerator || p.take.media.clock.fps.denominator !== t.clock.fps.denominator || p.offsetFrames + p.take.media.totalFrames > t.totalFrames) invalid("Placement domain mismatch"); segments.push(p.take.segment.segmentKey); tokens.push(...p.take.tokens.map(x => x.tokenKey)); anchors.push(...Object.keys(p.take.anchorFrames)); }
  unique(t.placements.map(p => p.placementKey), "placement"); unique(segments, "placed segment"); unique(tokens, "placed token"); unique(anchors, "placed anchor");
}
export function validateInstant(data: unknown): asserts data is Instant {
  const d = object(data); text(d.axisKey); text(d.consumerKey); text(d.expression); integer(d.frame); if (!["none", "semantic-anchor", "local-offset", "duration"].includes(String(d.editAuthority))) invalid("Invalid edit authority"); const origin = object(d.origin);
  if (origin.kind === "absolute") return;
  if (origin.kind === "program") { if (origin.edge !== "start" && origin.edge !== "end") invalid("Invalid program boundary"); return; }
  if (origin.kind !== "semantic") invalid("Invalid instant origin"); const r = object(origin.reference); if (r.kind === "moment") { validateMomentRef(r); if (origin.edge !== "cue") invalid("Moment requires cue edge"); } else { if (r.kind === "segment") validateSegmentRef(r); else validateSelectionRef(r); if (origin.edge !== "start" && origin.edge !== "end") invalid("Invalid semantic edge"); }
}
export function validateWindow(data: unknown): asserts data is Window {
  const d = object(data); text(d.axisKey); text(d.consumerKey); validateInstant(d.leading); validateInstant(d.trailing); validateBounds(d.frames, Number.MAX_SAFE_INTEGER, true); if (d.leading.axisKey !== d.axisKey || d.trailing.axisKey !== d.axisKey || d.leading.consumerKey !== d.consumerKey || d.trailing.consumerKey !== d.consumerKey || d.frames.start !== d.leading.frame || d.frames.end !== d.trailing.frame) invalid("Window endpoint domain mismatch");
}

export function validateAdjustment(data: unknown): asserts data is Adjustment {
  const d = object(data); text(d.storyKey); array(d.edits);
  if (!d.edits.length) invalid("Adjustment requires at least one edit");
  const keys: string[] = [];
  for (const item of d.edits) { const edit = object(item); text(edit.anchorKey); integer(edit.localFrame); keys.push(edit.anchorKey); }
  if (new Set(keys).size !== keys.length) throw new DvError("ADJUST_ANCHOR", "Duplicate adjusted anchor");
}

export function validatePlacementPlan(data: unknown): asserts data is PlacementPlan {
  const d = object(data); text(d.timelineKey); array(d.placements);
  const keys: string[] = [];
  for (const item of d.placements) { const p = object(item); text(p.placementKey); keys.push(p.placementKey); if (p.at !== undefined) text(p.at); }
  unique(keys, "placement identity");
}
