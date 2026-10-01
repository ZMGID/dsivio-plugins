import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DvError } from "../core/errors.ts";
import { matchPhrase } from "./transcript.ts";
import type { TranscriptDocument } from "./transcript-types.ts";

export interface SamplingOptions {
  at?: string; start?: string; end?: string; every?: string; frames?: string;
  around?: string; occurrence?: string; padding?: string; everyFrame?: boolean;
}
export interface SampleRange { startSec: number; endSec: number; id?: string; requestedTimes: number[] }
function invalid(message: string): never {
  throw new DvError("MEDIA_SAMPLE", message, { hint: "Use non-negative seconds within the source duration and distinct millisecond sample times." });
}
export function seconds(value: string, name: string, minimum = 0): number {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < minimum) invalid(`--${name} must be finite and at least ${minimum} seconds.`);
  return number;
}
export function sampleInteger(value: string | undefined, name: string, fallback: number, minimum: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum) invalid(`--${name} must be a safe integer at least ${minimum}.`);
  return number;
}
export function sampleRange(duration: number, options: SamplingOptions, transcript?: TranscriptDocument, requireMode = false): SampleRange {
  if (options.everyFrame && (options.at !== undefined || options.every !== undefined || options.frames !== undefined)) invalid("--every-frame cannot be combined with --at, --every or --frames.");
  if (options.every !== undefined && options.frames !== undefined) invalid("--every and --frames are mutually exclusive.");
  if ((options.occurrence !== undefined || options.padding !== undefined) && options.around === undefined) invalid("--occurrence and --padding require --around.");
  if (options.at !== undefined) {
    for (const name of ["start", "end", "every", "frames", "around", "occurrence", "padding"] as const) if (options[name] !== undefined) invalid(`--at cannot be combined with --${name}.`);
    const parts = options.at.split(",");
    if (parts.some(part => !part.trim())) invalid("--at requires a non-empty comma-separated list of seconds.");
    const times = parts.map(part => seconds(part, "at"));
    let previous = -Infinity;
    const rounded = times.map(time => {
      const result = Math.round(time * 1000) / 1000;
      if (time <= previous || time >= duration || result >= duration) invalid(`--at times must be strictly increasing and earlier than ${duration} seconds.`);
      previous = time;
      return result;
    });
    checkIncreasing(rounded);
    return { startSec: rounded[0]!, endSec: rounded.at(-1)!, requestedTimes: rounded };
  }
  let startSec = options.start === undefined ? 0 : seconds(options.start, "start");
  let endSec = options.end === undefined ? duration : seconds(options.end, "end");
  if (options.around !== undefined) {
    if (options.start !== undefined || options.end !== undefined) invalid("--around replaces --start and --end.");
    if (!transcript) invalid("--around requires --transcript.");
    const matches = matchPhrase(transcript, options.around);
    if (!matches.length) invalid(`No whole-word transcript match for ${JSON.stringify(options.around)}.`);
    if (matches.length > 1 && options.occurrence === undefined) invalid(`Phrase matches ${matches.length} times: ${matches.map((match, index) => `${index + 1}: ${match.first.startSec ?? "unknown"}–${match.last.endSec ?? "unknown"}s`).join(", ")}. Specify --occurrence.`);
    const occurrence = sampleInteger(options.occurrence, "occurrence", 1, 1);
    const match = matches[occurrence - 1];
    if (!match) invalid(`--occurrence ${occurrence} exceeds ${matches.length} matches.`);
    if (match.first.startSec === undefined || match.last.endSec === undefined) invalid("The matched phrase lacks its first word start or last word end; boundaries cannot be inferred.");
    const padding = options.padding === undefined ? 0.3 : seconds(options.padding, "padding");
    startSec = Math.max(0, match.first.startSec - padding);
    endSec = Math.min(duration, match.last.endSec + padding);
  }
  if (!(startSec < endSec && endSec <= duration)) invalid(`Range must satisfy 0 ≤ start < end ≤ ${duration} seconds; got ${startSec}:${endSec}.`);
  if (options.everyFrame) return { startSec, endSec, requestedTimes: [] };
  if (requireMode && options.every === undefined) invalid("frames requires --at, --every or --every-frame.");
  const times: number[] = [];
  if (options.every !== undefined) {
    const step = seconds(options.every, "every", 0.001);
    for (let index = 0; startSec + index * step < endSec; index++) {
      const time = Math.round((startSec + index * step) * 1000) / 1000;
      if (time < endSec) times.push(time);
    }
  } else {
    const count = sampleInteger(options.frames, "frames", Math.max(4, Math.min(9, Math.round((endSec - startSec) * 1.5))), 2);
    for (let index = 0; index < count; index++) times.push(Math.round((startSec + (index + 0.5) * (endSec - startSec) / count) * 1000) / 1000);
    if (times.some(time => time >= endSec)) invalid("Millisecond rounding moves a midpoint outside the selected range.");
  }
  if (!times.length) invalid("The selected range contains no millisecond sample times.");
  checkIncreasing(times);
  return { startSec, endSec, requestedTimes: times };
}
function checkIncreasing(times: number[]): void {
  for (let index = 1; index < times.length; index++) if (times[index]! <= times[index - 1]!) invalid("Sample times duplicate after millisecond rounding; use less dense sampling.");
}
function isRangeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export async function readRanges(file: string, duration: number, defaults: SamplingOptions): Promise<SampleRange[]> {
  for (const name of ["start", "end", "at", "around", "padding", "occurrence"] as const) if (defaults[name] !== undefined) invalid(`--ranges cannot be combined with --${name}.`);
  let value: unknown;
  try { value = JSON.parse(await readFile(resolve(file), "utf8")); }
  catch (error) { throw new DvError("MEDIA_RANGES", `Cannot read ranges ${resolve(file)}: ${error instanceof Error ? error.message : String(error)}`, { hint: "Provide a non-empty JSON array of {start,end,id?,frames?,every?}.", cause: error }); }
  if (!Array.isArray(value) || !value.length) invalid("--ranges must contain a non-empty JSON array.");
  const ids = new Set<string>();
  return value.map((item: unknown, index: number) => {
    if (!isRangeObject(item)) invalid(`Range ${index + 1} must be an object.`);
    const range: Record<string, unknown> = item;
    if (typeof range.start !== "number" || typeof range.end !== "number") invalid(`Range ${index + 1} requires numeric start and end.`);
    if (range.id !== undefined && (typeof range.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(range.id))) invalid(`Range ${index + 1} has an unsafe id.`);
    if (typeof range.id === "string" && !defaults.everyFrame) {
      if (ids.has(range.id)) invalid(`Duplicate range id ${range.id}.`);
      ids.add(range.id);
    }
    if (range.frames !== undefined && range.every !== undefined) invalid(`Range ${index + 1}: frames and every are mutually exclusive.`);
    if (defaults.everyFrame && (range.frames !== undefined || range.every !== undefined)) invalid("Raw ranges cannot specify frames or every.");
    if (range.frames !== undefined && typeof range.frames !== "number") invalid(`Range ${index + 1}.frames must be numeric.`);
    if (range.every !== undefined && typeof range.every !== "number") invalid(`Range ${index + 1}.every must be numeric.`);
    const options: SamplingOptions = { ...defaults, start: String(range.start), end: String(range.end) };
    if (range.frames !== undefined) { options.frames = String(range.frames); delete options.every; }
    if (range.every !== undefined) { options.every = String(range.every); delete options.frames; }
    return { ...sampleRange(duration, options), ...(typeof range.id === "string" ? { id: range.id } : {}) };
  });
}
export function timeSlug(time: number): string {
  return time.toFixed(3).replace(".", "_") + "s";
}
