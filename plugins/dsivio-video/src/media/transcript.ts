import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { DvError } from "../core/errors.ts";
import { TRANSCRIPT_FORMAT } from "./transcript-types.ts";
import type { TranscriptDocument, TranscriptToken, TranscriptBlock } from "./transcript-types.ts";

function invalid(message: string): never {
  throw new DvError("TRANSCRIPT_INVALID", message, { hint: "Use a dsivio-video.transcript/1 document with finite non-negative word times." });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function timing(value: Record<string, unknown>, location: string): void {
  for (const key of ["startSec", "endSec"]) {
    const time = value[key];
    if (time !== undefined && (typeof time !== "number" || !Number.isFinite(time) || time < 0)) invalid(`${location}.${key} must be finite and non-negative.`);
  }
  if (typeof value.startSec === "number" && typeof value.endSec === "number" && value.endSec < value.startSec) invalid(`${location}.endSec precedes startSec.`);
}
export function validateTranscript(value: unknown): TranscriptDocument {
  if (!record(value) || value.format !== TRANSCRIPT_FORMAT) invalid(`Expected format ${TRANSCRIPT_FORMAT}.`);
  if (typeof value.source !== "string" || !isAbsolute(value.source)) invalid("Transcript source must be an absolute path.");
  if (typeof value.language !== "string" || !/^[a-z]{2,3}$/.test(value.language)) invalid("Transcript language must be a lowercase 2–3 letter code.");
  if (typeof value.durationSec !== "number" || !Number.isFinite(value.durationSec) || value.durationSec < 0) invalid("Transcript durationSec must be finite and non-negative.");
  if (typeof value.engine !== "string" || !value.engine.trim()) invalid("Transcript engine must be a non-empty string.");
  if (!Array.isArray(value.blocks)) invalid("Transcript blocks must be an array.");
  const blocks: TranscriptBlock[] = value.blocks.map((block: unknown, blockIndex: number) => {
    const location = `blocks[${blockIndex}]`;
    if (!record(block) || typeof block.text !== "string" || !Array.isArray(block.tokens)) invalid(`${location} requires text and tokens.`);
    timing(block, location);
    const tokens: TranscriptToken[] = block.tokens.map((token: unknown, index: number) => {
      if (!record(token) || typeof token.text !== "string") invalid(`${location}.tokens[${index}] requires string text.`);
      timing(token, `${location}.tokens[${index}]`);
      if (token.confidence !== undefined && (typeof token.confidence !== "number" || !Number.isFinite(token.confidence) || token.confidence < 0 || token.confidence > 1)) invalid(`${location}.tokens[${index}].confidence must be between 0 and 1.`);
      return { text: token.text, ...(typeof token.startSec === "number" ? { startSec: token.startSec } : {}), ...(typeof token.endSec === "number" ? { endSec: token.endSec } : {}), ...(typeof token.confidence === "number" ? { confidence: token.confidence } : {}) };
    });
    return { text: block.text, tokens, ...(typeof block.startSec === "number" ? { startSec: block.startSec } : {}), ...(typeof block.endSec === "number" ? { endSec: block.endSec } : {}) };
  });
  return { format: TRANSCRIPT_FORMAT, source: value.source, language: value.language, durationSec: value.durationSec, engine: value.engine, blocks };
}
export async function readTranscript(file: string): Promise<TranscriptDocument> {
  const path = resolve(file);
  try { return validateTranscript(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("TRANSCRIPT_READ", `Cannot read transcript ${path}: ${error instanceof Error ? error.message : String(error)}`, { hint: "Provide a readable versioned transcript JSON file.", cause: error });
  }
}
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}
export interface PhraseMatch { first: TranscriptToken; last: TranscriptToken }
export function matchPhrase(document: TranscriptDocument, phrase: string): PhraseMatch[] {
  const query = normalize(phrase);
  if (!query) throw new DvError("TRANSCRIPT_PHRASE", "--around must contain a non-empty phrase.", { hint: "Use complete transcript words, not a substring of a word." });
  const tokens = document.blocks.flatMap(block => block.tokens).filter(token => normalize(token.text) !== "");
  const words = tokens.map(token => normalize(token.text));
  const matches: PhraseMatch[] = [];
  for (let first = 0; first < words.length; first++) {
    let candidate = "";
    for (let last = first; last < words.length; last++) {
      candidate += words[last];
      if (!query.startsWith(candidate)) break;
      if (candidate === query) { matches.push({ first: tokens[first]!, last: tokens[last]! }); break; }
    }
  }
  return matches;
}
export interface TranscriptContext { activeTokens: TranscriptToken[]; contextTokens: TranscriptToken[] }
export function transcriptContext(document: TranscriptDocument, time: number): TranscriptContext {
  const tokens = document.blocks.flatMap(block => block.tokens);
  const indices: number[] = [];
  tokens.forEach((token, index) => { if (token.startSec !== undefined && token.endSec !== undefined && token.startSec <= time && time < token.endSec) indices.push(index); });
  let first = indices[0];
  let last = indices.at(-1);
  if (first === undefined) {
    let distance = Infinity;
    tokens.forEach((token, index) => {
      for (const boundary of [token.startSec, token.endSec]) {
        if (boundary !== undefined && Math.abs(boundary - time) < distance) { distance = Math.abs(boundary - time); first = index; last = index; }
      }
    });
  }
  return { activeTokens: indices.map(index => tokens[index]!), contextTokens: first === undefined || last === undefined ? [] : tokens.slice(Math.max(0, first - 3), last + 4) };
}
