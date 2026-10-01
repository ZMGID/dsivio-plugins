import { DvError } from "../core/errors.ts";
import type { AlignmentEvidence, EvidenceWord, EvidenceCharacter } from "../pipeline/types.ts";
import type { Bounds, Narrative, SegmentRef, SemanticTake, SynchronizedMedia } from "./types.ts";
import { validateEvidence, validateMedia } from "../pipeline/validate.ts";
import { validateNarrative, validateSegmentRef, validateSemanticTake } from "./validate.ts";
import { normalizeMatchText as normalizeMatch } from "./script.ts";

type Group = { scriptStart: number; scriptCount: number; wordStart: number; wordCount: number };
type Score = { cost: number; exact: number; missing: number; inserted: number; complexity: number; previous?: { i: number; j: number; group: Group } };
export type MatchResult = { groups: Group[]; cost: number; exact: number; missing: number; inserted: number };
function better(a: Score, b: Score | undefined): boolean {
  if (!b) return true;
  if (Math.abs(a.cost - b.cost) > 1e-9) return a.cost < b.cost;
  if (a.exact !== b.exact) return a.exact > b.exact;
  if (a.missing !== b.missing) return a.missing < b.missing;
  if (a.inserted !== b.inserted) return a.inserted < b.inserted;
  return a.complexity < b.complexity;
}
function characterAlignment(left: string[], right: string[]): { distance: number; pairs: [number, number][] } {
  const width = right.length + 1; const distances = new Uint32Array((left.length + 1) * width);
  for (let i = 0; i <= left.length; i++) distances[i * width] = i;
  for (let j = 0; j <= right.length; j++) distances[j] = j;
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) distances[i * width + j] = Math.min(distances[(i - 1) * width + j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1), distances[(i - 1) * width + j]! + 1, distances[i * width + j - 1]! + 1);
  const distance = distances[left.length * width + right.length]!;
  const pairs: [number, number][] = []; let i = left.length; let j = right.length;
  while (i || j) {
    const d = distances[i * width + j]!;
    if (i && j && d === distances[(i - 1) * width + j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1)) { pairs.push([--i, --j]); }
    else if (i && d === distances[(i - 1) * width + j]! + 1) i--;
    else j--;
  }
  pairs.reverse(); return { distance, pairs };
}
function lcs(left: string[], right: string[]): number {
  const row = new Uint32Array(right.length + 1);
  for (const token of left) { let diagonal = 0; for (let j = 1; j <= right.length; j++) { const old = row[j]!; row[j] = token === right[j - 1] ? diagonal + 1 : Math.max(row[j]!, row[j - 1]!); diagonal = old; } }
  return row[right.length]!;
}
export function matchTokens(script: string[], words: EvidenceWord[], characters: EvidenceCharacter[] = []): MatchResult {
  const left = script.map(normalizeMatch); const right = words.map(w => normalizeMatch(w.text));
  if (left.some(t => !t)) throw new DvError("SPEECH_TOKEN_TEXT", "Script token has no normalized characters");
  const width = right.length + 1; const states: (Score | undefined)[] = new Array((left.length + 1) * width);
  states[0] = { cost: 0, exact: 0, missing: 0, inserted: 0, complexity: 0 };
  for (let i = 0; i <= left.length; i++) for (let j = 0; j <= right.length; j++) {
    const state = states[i * width + j]; if (!state) continue;
    const advance = (a: number, b: number, cost: number, exact = 0): void => {
      const score: Score = { cost: state.cost + cost, exact: state.exact + exact, missing: state.missing + (b === 0 ? a : 0), inserted: state.inserted + (a === 0 ? b : 0), complexity: state.complexity + Math.max(0, a + b - 2), previous: { i, j, group: { scriptStart: i, scriptCount: a, wordStart: j, wordCount: b } } };
      const index = (i + a) * width + j + b; if (better(score, states[index])) states[index] = score;
    };
    if (i < left.length) advance(1, 0, 0.5);
    if (j < right.length) advance(0, 1, 0.35);
    const pair = (a: number, b: number, exactOnly = false): void => {
      const s = left.slice(i, i + a); const w = right.slice(j, j + b); const sText = s.join(""); const wText = w.join("");
      if (sText === wText) { advance(a, b, a === 1 && b === 1 ? 0 : 0.055, a === 1 && b === 1 ? 1 : 0); return; }
      if (exactOnly) return;
      const scores = words.slice(j, j + b).flatMap(word => word.confidence === undefined ? [] : [Math.max(0, Math.min(1, word.confidence))]);
      for (const char of characters) if (char.wordIndex >= j && char.wordIndex < j + b && char.confidence !== undefined) scores.push(Math.max(0, Math.min(1, char.confidence)));
      const reliability = scores.length ? 0.5 + 0.5 * scores.reduce((sum, v) => sum + v, 0) / scores.length : 0.8;
      const distance = characterAlignment(Array.from(sText), Array.from(wText)).distance;
      const cost = distance / Math.max(1, Array.from(sText).length, Array.from(wText).length) * reliability + 0.055 * Math.max(0, a + b - 2) + 0.06 * (a + b - 2 * lcs(s, w));
      advance(a, b, cost);
    };
    for (let a = 1; a <= Math.min(4, left.length - i); a++) for (let b = 1; b <= Math.min(4, right.length - j); b++) pair(a, b);
    for (let a = 5; a <= left.length - i && j < right.length; a++) pair(a, 1, true);
    for (let b = 5; b <= right.length - j && i < left.length; b++) pair(1, b, true);
  }
  const final = states[left.length * width + right.length]!; const groups: Group[] = [];
  let i = left.length; let j = right.length;
  while (i || j) { const previous = states[i * width + j]!.previous!; groups.push(previous.group); i = previous.i; j = previous.j; }
  groups.reverse(); return { groups, cost: final.cost, exact: final.exact, missing: final.missing, inserted: final.inserted };
}
function positive(bounds: Bounds | undefined): bounds is Bounds { return Boolean(bounds && bounds.end > bounds.start); }
function wordReferences(word: EvidenceWord, characters: EvidenceCharacter[]): { text: string; samples?: Bounds }[] {
  const chars = Array.from(normalizeMatch(word.text));
  const references = chars.map((text, i) => ({ text, ...(positive(word.samples) ? { samples: { start: Math.round(word.samples.start + (word.samples.end - word.samples.start) * i / chars.length), end: Math.round(word.samples.start + (word.samples.end - word.samples.start) * (i + 1) / chars.length) } } : {}) }));
  const measured = characters.flatMap(c => Array.from(normalizeMatch(c.text)).map(text => ({ text, samples: c.samples })));
  const aligned = characterAlignment(chars, measured.map(c => c.text));
  for (const [a, b] of aligned.pairs) if (positive(measured[b]!.samples)) references[a]!.samples = measured[b]!.samples;
  return references;
}
export function materializeTake(narrative: Narrative, segment: SegmentRef, media: SynchronizedMedia, evidence?: AlignmentEvidence): SemanticTake {
  validateNarrative(narrative); validateSegmentRef(segment); validateMedia(media);
  const canonical = narrative.segments.find(s => s.segmentKey === segment.segmentKey);
  if (!canonical || segment.storyKey !== narrative.storyKey || canonical.tokenBounds.start !== segment.tokenBounds.start || canonical.tokenBounds.end !== segment.tokenBounds.end || canonical.anchors.start !== segment.anchors.start || canonical.anchors.end !== segment.anchors.end) throw new DvError("SPEECH_SEGMENT_INVALID", "Segment must be a complete Narrative segment");
  const tokens = narrative.tokens.slice(segment.tokenBounds.start, segment.tokenBounds.end);
  const take: SemanticTake = { storyKey: narrative.storyKey, storyAnchors: narrative.storyAnchors, segment, media, tokens: [], anchorFrames: { [segment.anchors.start]: 0, [segment.anchors.end]: media.totalFrames } };
  if (!tokens.length) { if (evidence !== undefined) throw new DvError("SPEECH_EMPTY_EVIDENCE", "Empty segment must not request evidence"); validateSemanticTake(take, false); return take; }
  if (!media.sound || !evidence) throw new DvError("SPEECH_AUDIO_REQUIRED", "Spoken segment requires normalized audio and evidence");
  validateEvidence(evidence);
  const expected = Number((2n * BigInt(media.totalFrames) * 16000n * BigInt(media.clock.fps.denominator) + BigInt(media.clock.fps.numerator)) / (2n * BigInt(media.clock.fps.numerator)));
  if (evidence.totalSamples !== expected) throw new DvError("SPEECH_WINDOW", "Evidence duration disagrees with media clock");
  const words: EvidenceWord[] = []; const chars: EvidenceCharacter[] = [];
  for (const block of evidence.blocks) { const offset = words.length; words.push(...block.words); chars.push(...block.characters.map(c => ({ ...c, wordIndex: c.wordIndex + offset }))); }
  const match = matchTokens(tokens.map(t => t.matchText), words, chars);
  const samples: (Bounds | undefined)[] = new Array(tokens.length);
  for (const group of match.groups) {
    if (!group.scriptCount || !group.wordCount) continue;
    const references = words.slice(group.wordStart, group.wordStart + group.wordCount).flatMap((word, index) => wordReferences(word, chars.filter(c => c.wordIndex === group.wordStart + index)));
    const owners: number[] = []; const scriptChars: string[] = [];
    for (let index = group.scriptStart; index < group.scriptStart + group.scriptCount; index++) for (const c of Array.from(normalizeMatch(tokens[index]!.matchText))) { scriptChars.push(c); owners.push(index); }
    for (const [a, b] of characterAlignment(scriptChars, references.map(r => r.text)).pairs) {
      const measured = references[b]!.samples; if (!positive(measured)) continue;
      const index = owners[a]!; const current = samples[index]; samples[index] = current ? { start: Math.min(current.start, measured.start), end: Math.max(current.end, measured.end) } : { ...measured };
    }
    const measured = words.slice(group.wordStart, group.wordStart + group.wordCount).flatMap(w => positive(w.samples) ? [w.samples] : []);
    if (measured.length) {
      const first = group.scriptStart; const last = first + group.scriptCount - 1;
      const start = Math.min(...measured.map(b => b.start)); const end = Math.max(...measured.map(b => b.end));
      if (samples[first]) samples[first]!.start = Math.min(samples[first]!.start, start);
      if (samples[last]) samples[last]!.end = Math.max(samples[last]!.end, end);
      if (group.scriptCount === 1) samples[first] = { start, end };
    }
  }
  const activity = evidence.voiceRegions?.filter(positive) ?? [];
  for (let i = 0; i < samples.length;) {
    if (samples[i]) { i++; continue; }
    const first = i; while (i < samples.length && !samples[i]) i++;
    const left = first ? samples[first - 1]!.end : activity.length ? Math.min(...activity.map(b => b.start)) : 0;
    const right = i < samples.length ? samples[i]!.start : activity.length ? Math.max(...activity.map(b => b.end)) : evidence.totalSamples;
    const span = Math.max(0, right - left); const weights = tokens.slice(first, i).map(t => Math.max(1, Array.from(normalizeMatch(t.matchText)).length)); const total = weights.reduce((sum, w) => sum + w, 0);
    let consumed = 0; for (let k = first; k < i; k++) { const start = Math.round(left + span * consumed / total); consumed += weights[k - first]!; samples[k] = { start, end: Math.round(left + span * consumed / total) }; }
  }
  const divisor = 16000n * BigInt(media.clock.fps.denominator);
  for (const [index, token] of tokens.entries()) {
    const sample = samples[index]!;
    let start = Math.min(media.totalFrames, Number(BigInt(sample.start) * BigInt(media.clock.fps.numerator) / divisor));
    let end = Math.min(media.totalFrames, Number((BigInt(sample.end) * BigInt(media.clock.fps.numerator) + divisor - 1n) / divisor));
    if (end <= start) { start = Math.min(start, media.totalFrames - 1); end = start + 1; }
    take.tokens.push({ tokenKey: token.tokenKey, frames: { start, end } });
    take.anchorFrames[token.anchors.start] = start; take.anchorFrames[token.anchors.end] = end;
  }
  validateSemanticTake(take, false); return take;
}
