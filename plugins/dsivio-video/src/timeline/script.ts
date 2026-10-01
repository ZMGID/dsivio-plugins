import { DvError, spanAt } from "../core/errors.ts";
import type { SourceSpan } from "../core/errors.ts";
import { stableIdentity, tokenAnchorKey } from "./identity.ts";
import { validateNarrative } from "./validate.ts";
import type { AnchorPair, CaptionCue, CaptionUnit, Narrative, SegmentRef, SpokenToken, Turn } from "./types.ts";

const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const WORD = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\d+(?:[,.]\d+)*(?:[-–]\d+(?:[,.]\d+)*)?|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{M}\p{N}])+(?:[’'._-](?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{M}\p{N}])+)*/gu;
export function normalizeMatchText(source: string): string {
  return source.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}
type Marker = { name: string; close: boolean; left: boolean; moment: boolean; position: number; offset: number };
type BoundMarker = Marker & { anchor: string; tokenBoundary: number };
export type ScriptResult = { narrative: Narrative; segments: Record<string, SegmentRef>; speech: string; dialogue: string; segmentTexts: Record<string, { speech: string; dialogue: string }> };

export function parseScript(body: string, id: string, file = "<script>", bodyStart = 0, bodySpan?: SourceSpan): ScriptResult {
  const fail: (code: string, message: string, offset?: number) => never = (code, message, offset = cursor) => {
    const local = spanAt(file, body, offset, offset + 1);
    const span = { ...local, start: bodyStart + offset, end: bodyStart + offset + 1, line: (bodySpan?.line ?? 1) + local.line - 1, column: local.line === 1 ? (bodySpan?.column ?? 1) + local.column - 1 : local.column };
    throw new DvError(code, message, { span });
  };
  let cursor = 0; let segment: SegmentRef | undefined; let segmentName = ""; let turn: Turn | undefined; let roleSeen = false;
  const narrative: Narrative = { storyKey: "pending", segments: [], turns: [], tokens: [], anchors: [], storyAnchors: { start: "story:start", end: "story:end" }, selections: [], moments: [], captions: { storyKey: "pending", units: [], cues: [] } };
  const segments: Record<string, SegmentRef> = Object.create(null); const boundMarkers: BoundMarker[] = []; const outerMarkers: { marker: Marker; boundary: number; segmentBoundary: number }[] = [];
  const pronunciation = new Map<Turn, string>();
  let pending = ""; let markers: Marker[] = []; let cue: CaptionCue | undefined; let cueBreak = false; let lastAttributed = false;
  const pair = (key: string): AnchorPair => ({ start: `${key}:anchor:start`, end: `${key}:anchor:end` });
  const beginTurn = (role?: string) => { if (!segment) fail("SCRIPT_ROLE", "Role must occur within a segment"); turn = { turnKey: `turn:${narrative.turns.length}`, segmentKey: segment.segmentKey, tokenBounds: { start: narrative.tokens.length, end: narrative.tokens.length }, ...(role !== undefined ? { role } : {}) }; narrative.turns.push(turn); cue = undefined; };
  const addTokens = (source: string): { matches: RegExpMatchArray[]; start: number } => {
    if (!segment) fail("SCRIPT_BODY", "Speech must occur within a segment");
    const start = narrative.tokens.length; const matches = [...source.matchAll(WORD)];
    if (matches.length && !turn) beginTurn();
    for (const match of matches) { const key = `token:${narrative.tokens.length}`; narrative.tokens.push({ tokenKey: key, segmentKey: segment.segmentKey, turnKey: turn!.turnKey, speechText: match[0], matchText: normalizeMatchText(match[0]), anchors: pair(key) }); }
    if (turn) turn.tokenBounds.end = narrative.tokens.length;
    segment.tokenBounds.end = narrative.tokens.length; return { matches, start };
  };
  const addUnit = (text: string, separator: string, start: number, end: number, attributes: CaptionUnit["attributes"] = {}) => {
    if (start === end) fail("SCRIPT_DUAL_SPEECH", "Caption units require at least one spoken token");
    const unit: CaptionUnit = { unitKey: `unit:${narrative.captions.units.length}`, text, separator: start === turn!.tokenBounds.start ? "" : separator, tokenBounds: { start, end }, attributes }; narrative.captions.units.push(unit);
    if (!cue) { cue = { cueKey: `cue:${narrative.captions.cues.length}`, segmentKey: segment!.segmentKey, turnKey: turn!.turnKey, ...(turn!.role !== undefined ? { role: turn!.role } : {}), unitKeys: [] }; narrative.captions.cues.push(cue); }
    cue.unitKeys.push(unit.unitKey); cueBreak = false; lastAttributed = false;
  };
  const bind = (source: string, entries: Marker[], matches: RegExpMatchArray[], start: number) => {
    for (const m of entries) {
      if (matches.some(word => m.position > word.index! && m.position < word.index! + word[0].length)) fail("SCRIPT_MARKER_TOKEN_BOUNDARY", "Semantic markers cannot split a word", m.offset);
      const prev = matches.findLast(word => word.index! + word[0].length <= m.position); const next = matches.find(word => word.index! >= m.position);
      if (prev && m.position === prev.index! + prev[0].length && /[^\s\p{L}\p{M}\p{N}]/u.test(source[m.position] ?? "")) fail("SCRIPT_MARKER_TOKEN_BOUNDARY", "A marker cannot separate a word from attached punctuation", m.offset);
      const local = m.left ? prev ? matches.indexOf(prev) + 1 : 0 : next ? matches.indexOf(next) : matches.length;
      const global = start + local; let anchor: string;
      if (m.left && prev) anchor = narrative.tokens[global - 1]!.anchors.end;
      else if (!m.left && next) anchor = narrative.tokens[global]!.anchors.start;
      else anchor = m.left ? start > segment!.tokenBounds.start ? narrative.tokens[start - 1]!.anchors.end : segment!.anchors.start : `right:${segment!.segmentKey}:${global}`;
      boundMarkers.push({ ...m, anchor, tokenBoundary: m.left && !prev ? start : global });
    }
  };
  const flush = () => {
    if (!segment) { if (pending.trim()) fail("SCRIPT_BODY", "Script outer body accepts only segments and markers"); pending = ""; return; }
    const source = pending.replace(/\s+/gu, " ");
    // Marker offsets refer to the uncollapsed string, so tokenize it before whitespace normalization.
    const result = addTokens(pending); bind(pending, markers, result.matches, result.start);
    if (turn) pronunciation.set(turn, (pronunciation.get(turn) ?? "") + source);
    if (result.matches.length) {
      for (let i = 0; i < result.matches.length; i++) {
        const word = result.matches[i]!; const next = result.matches[i + 1]; const from = i ? word.index! : 0; const to = next ? next.index! : pending.length;
        const chunk = pending.slice(from, to).replace(/\s+/gu, " "); const prefix = /^\s*/u.exec(chunk)![0]; const trailing = /\s*$/u.exec(chunk)![0];
        let display = chunk.slice(prefix.length, chunk.length - trailing.length); let separator = prefix;
        // Whitespace after the previous word belongs to this unit, not to its punctuation.
        if (i) separator = /\s*$/u.exec(pending.slice(result.matches[i - 1]!.index! + result.matches[i - 1]![0].length, word.index!))![0].replace(/\s+/gu, " ");
        if (i === 0 && word.index! > 0) {
          const leading = pending.slice(0, word.index!).replace(/\s+/gu, " ");
          const previous = narrative.captions.units.at(-1);
          if (leading.trim() && previous && result.start > turn!.tokenBounds.start) {
            if (cueBreak) fail("SCRIPT_CAPTION_BREAK", "Cue breaks cannot detach punctuation from its display word");
            previous.text += leading.trimEnd();
            display = pending.slice(word.index!, to).trimEnd();
            separator = /\s*$/u.exec(leading)![0];
          } else display = leading.trimStart() + pending.slice(word.index!, to).trimEnd();
        }
        addUnit(display.replace(/\s+/gu, " "), separator, result.start + i, result.start + i + 1);
      }
    } else if (source.trim()) {
      const unit = narrative.captions.units.at(-1); if (!unit || unit.tokenBounds.end !== narrative.tokens.length || cueBreak) fail("SCRIPT_WORD", "Punctuation requires a spoken word"); unit.text += source.trim();
    }
    pending = ""; markers = [];
  };
  const readMarker = (): Marker => {
    const offset = cursor; const end = body.indexOf("}", cursor + 2); if (end === -1) fail("SCRIPT_MARKER", "Unclosed semantic marker"); const content = body.slice(cursor + 2, end); const match = /^(\/)?(~)?([a-z][a-z0-9_-]{0,63})([!~])?$/.exec(content);
    if (!match || match[1] && match[4] === "!" || match[2] && match[1] || match[4] === "~" && !match[1]) fail("SCRIPT_MARKER", "Invalid semantic marker"); cursor = end + 1;
    return { name: match[3]!, close: !!match[1], left: match[1] ? match[4] !== "~" : !!match[2], moment: match[4] === "!", position: pending.length, offset };
  };
  const attrs = (source: string): CaptionUnit["attributes"] => {
    const result: CaptionUnit["attributes"] = Object.create(null);
    for (const entry of source.split(",")) { const match = /^([a-z][a-z0-9_-]*)(?:=([^\s{},]+))?$/.exec(entry); if (!match || Object.hasOwn(result, match[1]!)) fail("SCRIPT_ATTRIBUTE", "Invalid or duplicate display attribute"); const value = match[2]; if (value === undefined || value === "true") result[match[1]!] = true; else if (value === "false") result[match[1]!] = false; else if (/^-?\d+(?:\.\d+)?$/.test(value)) { const number = Number(value); if (!Number.isFinite(number)) fail("SCRIPT_ATTRIBUTE", "Display numbers must be finite"); result[match[1]!] = number; } else result[match[1]!] = value; }
    return result;
  };
  const decodeDual = (source: string, speechSide: boolean, shared = false): { text: string; markers: Marker[]; attributes: CaptionUnit["attributes"] } => {
    let text = ""; const entries: Marker[] = []; const attributes: CaptionUnit["attributes"] = Object.create(null);
    for (let i = 0; i < source.length;) {
      const ch = source[i]!;
      if (source.startsWith("<!--", i)) { const end = source.indexOf("-->", i + 4); if (end < 0) fail("SCRIPT_COMMENT", "Unclosed Script comment"); i = end + 3; continue; }
      if (ch === "\\") { const next = source[i + 1]; if (!next || !"@<\\|{}>".includes(next)) fail("SCRIPT_ESCAPE", "Unknown Script escape"); text += next; i += 2; }
      else if (source.startsWith("@{", i)) { if (!speechSide && !shared) fail("SCRIPT_DUAL_MARKER", "Explicit Dual Text markers belong on the speech side"); const end = source.indexOf("}", i + 2); if (end < 0) fail("SCRIPT_MARKER", "Unclosed marker"); const content = source.slice(i + 2, end); const match = /^(\/)?(~)?([a-z][a-z0-9_-]{0,63})([!~])?$/.exec(content); if (!match || match[1] && match[4] === "!" || match[2] && match[1] || match[4] === "~" && !match[1]) fail("SCRIPT_MARKER", "Invalid semantic marker"); entries.push({ name: match[3]!, close: !!match[1], left: match[1] ? match[4] !== "~" : !!match[2], moment: match[4] === "!", position: text.length, offset: cursor + i }); i = end + 1; }
      else if (ch === "{") { if (speechSide && !shared) fail("SCRIPT_DUAL_ATTRIBUTE", "Explicit Dual Text attributes belong on the display side"); const end = source.indexOf("}", i + 1); if (end < 0 || !text || /\s$/.test(text)) fail("SCRIPT_ATTRIBUTE", "Display attributes must follow a display word"); const parsed = attrs(source.slice(i + 1, end)); for (const [key, value] of Object.entries(parsed)) { if (Object.hasOwn(attributes, key)) fail("SCRIPT_ATTRIBUTE", "Duplicate Dual Text attribute"); attributes[key] = value; } i = end + 1; }
      else { if (ch === "<" || source.startsWith("||", i) || ch === "@" || ch === "}") fail("SCRIPT_DUAL", "Invalid nested or unescaped Dual Text syntax"); text += ch; i++; }
    }
    return { text, markers: entries, attributes };
  };
  while (cursor < body.length) {
    if (body.startsWith("<!--", cursor)) { const end = body.indexOf("-->", cursor + 4); if (end < 0) fail("SCRIPT_COMMENT", "Unclosed Script comment"); cursor = end + 3; continue; }
    if (body.startsWith("@{", cursor)) { const m = readMarker(); if (segment) markers.push(m); else { if (pending.trim()) fail("SCRIPT_BODY", "Unexpected outer text"); outerMarkers.push({ marker: m, boundary: narrative.tokens.length, segmentBoundary: narrative.segments.length }); } continue; }
    const ch = body[cursor]!;
    if (ch === "\\") { const next = body[cursor + 1]; if (!next || !"@<\\|{}".includes(next)) fail("SCRIPT_ESCAPE", "Unknown Script escape"); pending += next; cursor += 2; continue; }
    if (ch === "<") {
      let end = cursor + 1; let escaped = false;
      for (; end < body.length; end++) {
        if (!escaped && body.startsWith("<!--", end)) { const commentEnd = body.indexOf("-->", end + 4); if (commentEnd < 0) fail("SCRIPT_COMMENT", "Unclosed Script comment"); end = commentEnd + 2; continue; }
        if (!escaped && body[end] === ">") break;
        if (!escaped && body[end] === "\\") escaped = true; else escaped = false;
      }
      if (end === body.length) fail("SCRIPT_SEGMENT_UNCLOSED", "Unclosed Script tag"); const content = body.slice(cursor + 1, end);
      if (!segment) {
        if (pending.trim()) fail("SCRIPT_BODY", "Unexpected outer text"); const self = content.endsWith("/"); const name = self ? content.slice(0, -1) : content;
        if (!NAME.test(name) || name === "script") fail("SCRIPT_SEGMENT_ID", "Invalid Segment name"); if (Object.hasOwn(segments, name)) fail("SCRIPT_SEGMENT_DUPLICATE", `Duplicate Segment '${name}'`);
        segmentName = name; segment = { kind: "segment", storyKey: "pending", segmentKey: `segment:${name}`, tokenBounds: { start: narrative.tokens.length, end: narrative.tokens.length }, anchors: pair(`segment:${name}`) }; segments[name] = segment; narrative.segments.push(segment); pending = ""; turn = undefined; cue = undefined; roleSeen = false; cursor = end + 1;
        if (self) { segment = undefined; segmentName = ""; } continue;
      }
      if (content.startsWith("/")) {
        if (content !== `/${segmentName}`) fail("SCRIPT_SEGMENT_MISMATCH", "Segment closing tag does not match");
        flush(); if (turn && turn.tokenBounds.start === turn.tokenBounds.end) fail("SCRIPT_ROLE_EMPTY", "Role requires spoken content");
        if (cueBreak) fail("SCRIPT_CAPTION_BREAK", "Cue break must be followed by a caption unit");
        segment = undefined; segmentName = ""; turn = undefined; cue = undefined; cursor = end + 1; continue;
      }
      // Unescaped single | distinguishes Dual Text from role cues.
      let split = -1; for (let i = 0; i < content.length; i++) { if (content[i] === "\\") { i++; continue; } if (content[i] === "|") { if (split !== -1) fail("SCRIPT_DUAL", "Dual Text requires exactly one divider"); split = i; } }
      if (split !== -1) {
        const before = pending; flush(); const left = content.slice(0, split); const right = content.slice(split + 1); const shared = !right.trim();
        let display; let spoken;
        if (shared) { const parsed = decodeDual(left, false, true);
          display = parsed; spoken = parsed;
        } else { display = decodeDual(left, false); spoken = decodeDual(right, true); }
        const tokens = addTokens(spoken.text); if (!tokens.matches.length) fail("SCRIPT_DUAL_SPEECH", "Dual Text requires spoken tokens"); bind(spoken.text, spoken.markers, tokens.matches, tokens.start);
        pronunciation.set(turn!, (pronunciation.get(turn!) ?? "") + spoken.text.replace(/\s+/gu, " ").trim());
        addUnit(display.text.replace(/\s+/gu, " ").trim(), /\s$/.test(before) ? " " : "", tokens.start, narrative.tokens.length, display.attributes); cursor = end + 1; continue;
      }
      flush(); if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._-]{0,30}[\p{L}\p{M}\p{N}]$|^[\p{L}\p{N}]$/u.test(content)) fail("SCRIPT_ROLE", "Invalid Role cue");
      if (!roleSeen && narrative.tokens.length > segment.tokenBounds.start) fail("SCRIPT_ROLE_AFTER_TEXT", "First Role cue must precede segment speech"); if (turn && turn.tokenBounds.start === turn.tokenBounds.end) fail("SCRIPT_ROLE_EMPTY", "Role requires spoken content"); roleSeen = true; beginTurn(content); cursor = end + 1; continue;
    }
    if (body.startsWith("||", cursor)) {
      if (!segment) fail("SCRIPT_CAPTION_BREAK", "Cue break requires a segment");
      const joined = pending + (body[cursor + 2] ?? "");
      if ([...joined.matchAll(WORD)].some(word => word.index! < pending.length && word.index! + word[0].length > pending.length)) fail("SCRIPT_CAPTION_BREAK_TOKEN", "Cue break cannot split a word");
      flush(); if (!cue || cueBreak) fail("SCRIPT_CAPTION_BREAK", "Cue break must follow a caption unit");
      cue = undefined; cueBreak = true; cursor += 2; continue;
    }
    if (ch === "{") {
      if (!segment || !pending || /\s$/.test(pending)) fail("SCRIPT_ATTRIBUTE_BOUNDARY", "Display attributes must touch a complete display word");
      const end = body.indexOf("}", cursor + 1); if (end < 0) fail("SCRIPT_ATTRIBUTE", "Unclosed display attributes");
      const joined = pending + (body[end + 1] ?? "");
      if ([...joined.matchAll(WORD)].some(word => word.index! < pending.length && word.index! + word[0].length > pending.length)) fail("SCRIPT_ATTRIBUTE_BOUNDARY", "Display attributes cannot split a word");
      flush(); const unit = narrative.captions.units.at(-1);
      if (!unit || lastAttributed || Object.keys(unit.attributes).length) fail("SCRIPT_ATTRIBUTE_DUPLICATE", "A display word accepts one attribute block");
      unit.attributes = attrs(body.slice(cursor + 1, end)); lastAttributed = true; cursor = end + 1; continue;
    }
    if (ch === "@" || ch === "}" || ch === "|") fail("SCRIPT_ESCAPE", "Reserved Script characters must be escaped");
    pending += ch; cursor++;
  }
  if (segment) fail("SCRIPT_SEGMENT_UNCLOSED", "Unclosed Segment"); if (pending.trim()) fail("SCRIPT_BODY", "Unexpected outer text"); if (!narrative.segments.length) fail("SCRIPT_SEGMENT_CARDINALITY", "Script requires at least one Segment");
  for (const item of outerMarkers) {
    const { marker: m, boundary, segmentBoundary } = item;
    const anchor = segmentBoundary === 0 ? narrative.storyAnchors.start : segmentBoundary === narrative.segments.length ? narrative.storyAnchors.end : m.left ? narrative.segments[segmentBoundary - 1]!.anchors.end : narrative.segments[segmentBoundary]!.anchors.start;
    boundMarkers.push({ ...m, anchor, tokenBoundary: boundary });
  }
  for (const marker of boundMarkers) {
    if (!marker.anchor.startsWith("right:")) continue;
    const segmentKey = marker.anchor.slice(6, marker.anchor.lastIndexOf(":"));
    const owner = narrative.segments.find(s => s.segmentKey === segmentKey)!;
    marker.anchor = marker.tokenBoundary < owner.tokenBounds.end ? narrative.tokens[marker.tokenBoundary]!.anchors.start : owner.anchors.end;
  }
  boundMarkers.sort((a, b) => a.offset - b.offset); const open = new Map<string, BoundMarker>(); const used = new Set<string>();
  for (const m of boundMarkers) {
    if (m.close) { const first = open.get(m.name); if (!first) fail("SCRIPT_SELECTION_CLOSE", `Selection '${m.name}' has no opening`, m.offset); if (m.tokenBoundary < first.tokenBoundary) fail("SCRIPT_SELECTION_ORDER", "Selection is reversed", m.offset); narrative.selections.push({ kind: "selection", storyKey: "pending", selectionKey: m.name, tokenBounds: { start: first.tokenBoundary, end: m.tokenBoundary }, anchors: { start: first.anchor, end: m.anchor } }); open.delete(m.name); }
    else { if (used.has(m.name)) fail(m.moment ? "SCRIPT_MOMENT_DUPLICATE" : "SCRIPT_SELECTION_DUPLICATE", `Duplicate semantic name '${m.name}'`, m.offset); used.add(m.name); if (m.moment) narrative.moments.push({ kind: "moment", storyKey: "pending", momentKey: m.name, anchorKey: m.anchor }); else open.set(m.name, m); }
  }
  if (open.size) fail("SCRIPT_SELECTION_UNCLOSED", "Unclosed Selection");
  // Cue role is a projection of Turn role, not a second authored identity input.
  const captionsForIdentity = { ...narrative.captions, cues: narrative.captions.cues.map(cue => ({ cueKey: cue.cueKey, segmentKey: cue.segmentKey, turnKey: cue.turnKey, unitKeys: cue.unitKeys })) };
  const storyKey = stableIdentity("story", { id, segments: narrative.segments, turns: narrative.turns, tokens: narrative.tokens, selections: narrative.selections, moments: narrative.moments, captions: captionsForIdentity, pronunciation: narrative.turns.map(t => (pronunciation.get(t) ?? "").replace(/\s+/gu, " ").trim()) });
  const identity = (key: string) => `${storyKey}:${key}`; narrative.storyKey = storyKey; narrative.captions.storyKey = storyKey;
  const remapPair = (p: AnchorPair) => { p.start = identity(p.start); p.end = identity(p.end); }; remapPair(narrative.storyAnchors);
  for (const s of narrative.segments) { s.storyKey = storyKey; s.segmentKey = identity(s.segmentKey); remapPair(s.anchors); }
  for (const t of narrative.turns) { t.turnKey = identity(t.turnKey); t.segmentKey = identity(t.segmentKey); }
  for (const t of narrative.tokens) { t.tokenKey = identity(t.tokenKey); t.segmentKey = identity(t.segmentKey); t.turnKey = identity(t.turnKey); t.anchors = { start: tokenAnchorKey(t.tokenKey, "start"), end: tokenAnchorKey(t.tokenKey, "end") }; }
  for (const s of narrative.selections) { s.storyKey = storyKey; remapPair(s.anchors); }
  for (const m of narrative.moments) { m.storyKey = storyKey; m.anchorKey = identity(m.anchorKey); }
  for (const u of narrative.captions.units) u.unitKey = identity(u.unitKey);
  for (const c of narrative.captions.cues) { c.cueKey = identity(c.cueKey); c.segmentKey = identity(c.segmentKey); c.turnKey = identity(c.turnKey); c.unitKeys = c.unitKeys.map(identity); }
  narrative.anchors.push({ anchorKey: narrative.storyAnchors.start, owner: "story", ownerKey: storyKey, edge: "start" });
  for (const s of narrative.segments) {
    narrative.anchors.push({ anchorKey: s.anchors.start, owner: "segment", ownerKey: s.segmentKey, edge: "start" });
    for (let index = s.tokenBounds.start; index < s.tokenBounds.end; index++) {
      const token = narrative.tokens[index]!;
      for (const edge of ["start", "end"] as const) narrative.anchors.push({ anchorKey: token.anchors[edge], owner: "token", ownerKey: token.tokenKey, edge });
    }
    narrative.anchors.push({ anchorKey: s.anchors.end, owner: "segment", ownerKey: s.segmentKey, edge: "end" });
  }
  narrative.anchors.push({ anchorKey: narrative.storyAnchors.end, owner: "story", ownerKey: storyKey, edge: "end" });
  validateNarrative(narrative);
  const texts = (turns: Turn[]) => ({
    speech: turns.map(t => (pronunciation.get(t) ?? "").replace(/\s+/gu, " ").trim()).join(" "),
    dialogue: turns.map(t => `${t.role ? `${t.role}: ` : ""}${(pronunciation.get(t) ?? "").replace(/\s+/gu, " ").trim()}`).join("\n"),
  });
  const segmentTexts: ScriptResult["segmentTexts"] = Object.create(null); for (const [name, s] of Object.entries(segments)) segmentTexts[name] = texts(narrative.turns.filter(t => t.segmentKey === s.segmentKey));
  return { narrative, segments, ...texts(narrative.turns), segmentTexts };
}
