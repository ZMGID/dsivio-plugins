import { DvError } from "../../core/errors.ts";
import { validateCanvas } from "../../space/validate.ts";
import { validateTimeline, validateWindow } from "../../timeline/validate.ts";
import { finite, identity, integer, object } from "../sound/validate.ts";
import type { OverlayAuthorPlan, OverlayEffect, OverlayKind, OverlayProgram } from "./types.ts";

type Rule = { kind: "number"; min?: number; max?: number; positive?: boolean; integer?: boolean } | { kind: "color" | "colors" } | { kind: "choice"; values: readonly string[] };
const number: Rule = { kind: "number" };
const unit: Rule = { kind: "number", min: 0, max: 1 };
const positive: Rule = { kind: "number", positive: true };
const seed: Rule = { kind: "number", min: 0, integer: true };
const color: Rule = { kind: "color" };
const colors: Rule = { kind: "colors" };
/** The same closed field schema drives author decoding, type validation and surface documentation. */
export const OVERLAY_FIELDS = {
  Flash: { color, intensity: unit, attack: seed, hold: seed, decay: seed },
  ColorWash: { color, opacity: unit },
  Vignette: { "center-x": unit, "center-y": unit, "radius-x": positive, "radius-y": positive, softness: unit, color, opacity: unit },
  ScanLines: { spacing: positive, thickness: positive, angle: number, opacity: unit, travel: number },
  DirectionalMatte: { angle: number, coverage: unit, feather: unit, color, opacity: unit, from: { kind: "number", min: -1, max: 2 }, to: { kind: "number", min: -1, max: 2 } },
  WhipVeil: { direction: { kind: "choice", values: ["left", "right", "up", "down"] }, width: positive, softness: { kind: "number", min: 0 }, travel: positive, opacity: unit },
  GlitchVeil: { bars: { kind: "number", min: 1, max: 256, integer: true }, colors, opacity: unit, travel: number, seed },
  Grain: { amount: unit, size: positive, chroma: { kind: "choice", values: ["monochrome", "color"] }, "motion-rate": number, seed },
  LightLeak: { colors, angle: number, softness: unit, travel: number, intensity: unit, seed },
  Bokeh: { amount: unit, "min-size": positive, "max-size": positive, color, warmth: { kind: "number", min: -1, max: 1 }, drift: number, seed },
  TVStatic: { amount: unit, size: positive, "scan-lines": unit, "motion-rate": number, seed },
} as const satisfies Record<OverlayKind, Record<string, Rule>>;
export const OVERLAY_KINDS = Object.keys(OVERLAY_FIELDS) as OverlayKind[];
export function isOverlayKind(kind: string): kind is OverlayKind { return Object.hasOwn(OVERLAY_FIELDS, kind); }
function validateColor(value: unknown): void {
  if (typeof value !== "string" || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) throw new DvError("OVERLAY_COLOR", "Overlay colors require six/eight-digit hexadecimal values.");
}
function validateField(rule: Rule, value: unknown, field: string): void {
  if (rule.kind === "number") {
    finite(value, rule.min, rule.max);
    if (rule.positive && value <= 0) throw new DvError("OVERLAY_ATTRIBUTE", `'${field}' must be positive.`);
    if (rule.integer) integer(value, rule.min);
  } else if (rule.kind === "color") validateColor(value);
  else if (rule.kind === "colors") {
    if (!Array.isArray(value) || !value.length) throw new DvError("OVERLAY_COLOR", "Overlay colors require a nonempty color list.");
    value.forEach(validateColor);
  } else if (rule.kind === "choice" && (typeof value !== "string" || !rule.values.includes(value))) throw new DvError("OVERLAY_ATTRIBUTE", `'${field}' requires ${rule.values.join(" or ")}.`);
}
export function parseOverlayOptions(kind: OverlayKind, literals: Record<string, string>): OverlayEffect["options"] {
  const fields: Record<string, Rule> = OVERLAY_FIELDS[kind];
  const options: Record<string, string | number | string[]> = {};
  for (const [field, rule] of Object.entries(fields)) {
    const value = literals[field];
    if (value === undefined || !value.trim()) throw new DvError("OVERLAY_ATTRIBUTE", `${kind} requires '${field}'.`);
    options[field] = rule.kind === "number" ? Number(value) : rule.kind === "colors" ? value.split(",").map(part => part.trim()) : value;
  }
  validateOptions(kind, options);
  return options as OverlayEffect["options"];
}
function validateOptions(kind: OverlayKind, data: unknown): void {
  const fields: Record<string, Rule> = OVERLAY_FIELDS[kind];
  const options = object(data, Object.keys(fields));
  for (const [field, rule] of Object.entries(fields)) validateField(rule, options[field], field);
  if (kind === "ScanLines" && (options.thickness as number) > (options.spacing as number)) throw new DvError("OVERLAY_ATTRIBUTE", "ScanLines thickness must not exceed spacing.");
  if (kind === "Bokeh" && (options["max-size"] as number) < (options["min-size"] as number)) throw new DvError("OVERLAY_ATTRIBUTE", "Bokeh max-size must not be smaller than min-size.");
}
function validateEffect(data: unknown, extension: "window" | "windowIndex"): void {
  const effect = object(data, ["kind", "options", "effectKey", "z", extension]);
  identity(effect.effectKey); integer(effect.z, -Number.MAX_SAFE_INTEGER);
  if (typeof effect.kind !== "string" || !isOverlayKind(effect.kind)) throw new DvError("OVERLAY_KIND", "Unknown overlay kind.");
  validateOptions(effect.kind, effect.options);
}
export function validateOverlayPlan(data: unknown): asserts data is OverlayAuthorPlan {
  const plan = object(data, ["effects"]);
  if (!Array.isArray(plan.effects) || !plan.effects.length) throw new DvError("OVERLAY_EMPTY", "Overlay Track requires at least one effect.");
  const keys = new Set<string>();
  for (const entry of plan.effects) {
    validateEffect(entry, "windowIndex");
    const effect = entry as OverlayAuthorPlan["effects"][number];
    integer(effect.windowIndex);
    if (keys.has(effect.effectKey)) throw new DvError("OVERLAY_DUPLICATE", "Overlay identities must be unique.");
    keys.add(effect.effectKey);
  }
}
export function validateOverlayProgram(data: unknown): asserts data is OverlayProgram {
  const program = object(data, ["trackKey", "canvas", "timeline", "effects"]);
  identity(program.trackKey); validateCanvas(program.canvas); validateTimeline(program.timeline);
  if (!Array.isArray(program.effects) || !program.effects.length) throw new DvError("OVERLAY_EMPTY", "Overlay Track requires at least one effect.");
  const keys = new Set<string>();
  for (const entry of program.effects) {
    validateEffect(entry, "window");
    const effect = entry as OverlayProgram["effects"][number]; validateWindow(effect.window);
    if (keys.has(effect.effectKey) || effect.window.consumerKey !== effect.effectKey || effect.window.axisKey !== program.timeline.axisKey || effect.window.frames.end > program.timeline.totalFrames) throw new DvError("OVERLAY_WINDOW", "Effect window has mismatched identity, axis or bounds.");
    keys.add(effect.effectKey);
  }
}
