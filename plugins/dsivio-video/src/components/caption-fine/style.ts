import { DvError } from "../../core/errors.ts";
import type { Recipe } from "../../modules/recipe/index.ts";
import type { FontFace, FontStack } from "../../fonts/types.ts";
import { validateFontStack } from "../../fonts/validate.ts";
import type { Paint, TextFormat, Ink } from "../../render/ir.ts";
import { validateTextFormat } from "../../render/text-runtime.ts";
import type { FineRecipe, FineStyle } from "./types.ts";
export const actions = "none fade pop scale spring bounce elastic stamp tilt zoom-blur flip-x flip-y spin squash stretch slide-left slide-right slide-up slide-down blur-in wipe-left wipe-right wipe-up wipe-down".split(" ");
type Rule = { fallback?: string | number; minimum?: number; maximum?: number; integer?: boolean; positive?: boolean; choices?: string[]; color?: boolean; padding?: boolean };
const rules: Record<string, Rule> = {};
function numbers(names: string, fallback: number | undefined, minimum = 0, extra: Partial<Rule> = {}): void { for (const name of names.split(" ")) rules[name] = { ...(fallback === undefined ? {} : { fallback }), minimum, ...extra }; }
function choice(name: string, fallback: string, values: string): void { rules[name] = { fallback, choices: values.split(" ") }; }
function color(name: string, fallback?: string): void { rules[name] = { ...(fallback === undefined ? {} : { fallback }), color: true }; }
numbers("stack-order", undefined, 0, { integer: true }); numbers("x y", undefined, 0, { maximum: 1 }); numbers("width", undefined, 0, { positive: true, maximum: 1 }); numbers("height", undefined, 0, { positive: true, maximum: 1 });
choice("anchor-x", "left", "left center right"); choice("anchor-y", "top", "top center bottom"); choice("align", "", "left center right"); delete rules.align!.fallback;
choice("block-align", "center", "start center end"); choice("direction", "ltr", "ltr rtl"); choice("inline-size", "hug", "hug fixed"); choice("wrap", "word", "word grapheme");
numbers("size line-height", undefined, 0, { positive: true }); numbers("letter-spacing", 0, -Infinity); numbers("word-gap", undefined); numbers("max-words-per-line max-lines", undefined, 0, { positive: true, integer: true });
choice("kerning", "auto", "auto normal none"); choice("caps", "normal", "normal small-caps all-small-caps"); choice("text-transform", "none", "none uppercase lowercase capitalize");
color("background"); rules.padding = { padding: true }; numbers("radius", undefined); color("border-color", "#00000000"); numbers("border-width", 0);
color("cue-shadow-color", "#000000"); numbers("cue-shadow-opacity", 0, 0, { maximum: 1 }); numbers("cue-shadow-x cue-shadow-y cue-shadow-spread", 0, -Infinity); numbers("cue-shadow-blur", 0);
const paintDefaults: Record<string, string | number | undefined> = { fill: undefined, opacity: 1, "stroke-color": "#000000", "stroke-width": 0, "shadow-color": "#000000", "shadow-opacity": 0, "shadow-x": 0, "shadow-y": 0, "shadow-spread": 0, "shadow-blur": 0, "glow-color": "#FFFFFF", "glow-opacity": 0, "glow-blur": 0, "glow-spread": 0, "long-shadow-color": "#000000", "long-shadow-opacity": 0, "long-shadow-distance": 0, "long-shadow-angle": 45, "gradient-from": undefined, "gradient-to": undefined, "gradient-angle": 90 };
for (const [name, fallback] of Object.entries(paintDefaults)) {
 const rule: Rule = name === "fill" || name.endsWith("color") || name === "gradient-from" || name === "gradient-to" ? { color: true } : { minimum: name.endsWith("-x") || name.endsWith("-y") || name === "shadow-spread" || name.endsWith("angle") ? -Infinity : 0, ...(name.endsWith("opacity") || name === "opacity" ? { maximum: 1 } : {}) };
 rules[name] = { ...rule, ...(fallback === undefined ? {} : { fallback }) }; rules[`active-${name}`] = { ...rule };
}
choice("underline", "off", "off always"); color("underline-color"); numbers("underline-thickness", 2); numbers("underline-offset", 4);
choice("active-underline", "off", "off current trail"); color("active-underline-color", "#FFD54A"); numbers("active-underline-thickness", 3); numbers("active-underline-offset", 4);
choice("active-box", "off", "off current trail"); choice("active-box-continuity", "isolated", "isolated joined"); color("active-box-background", "#FFD54A"); color("active-box-border-color", "#00000000"); numbers("active-box-border-width", 0); rules["active-box-padding"] = { padding: true, fallback: "0" }; numbers("active-box-radius", 8);
for (const name of ["cue-enter", "cue-exit", "atom-enter", "atom-exit", "active-box-enter", "active-box-exit", "active-response"]) rules[name] = { fallback: "none", choices: actions };
numbers("lead-frames tail-frames cue-enter-frames cue-exit-frames atom-enter-frames atom-exit-frames active-box-transition-frames", 0, 0, { integer: true }); numbers("cue-enter-start-scale", undefined); numbers("active-response-frames", 6, 0, { integer: true }); numbers("active-scale", 1.08, 0, { positive: true }); numbers("slide-distance", 24);
choice("handoff", "cut", "cut overlap"); choice("karaoke", "off", "off current trail"); choice("karaoke-transition", "step", "step wipe"); choice("atom-reveal", "all", "all on-start typewriter"); choice("loop", "none", "none shake wobble glow-pulse breathe float pulse flicker"); choice("loop-target", "cue", "cue active-atom"); numbers("loop-period-frames", 12, 0, { positive: true, integer: true }); numbers("loop-intensity", 1);
const required = "stack-order x y width align size line-height background padding radius fill".split(" ");
export function padding(value: string | number): [number, number, number, number] {
 if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?)?$/.test(value.trim())) throw new DvError("CAPTION_RECIPE", "Padding requires one or two nonnegative pixel numbers");
 const n = value.trim().split(/\s+/).map(Number); return [n[0]!, n[1] ?? n[0]!, n[0]!, n[1] ?? n[0]!];
}
export function decodeFineRecipe(properties: Recipe["properties"]): FineRecipe {
 const result: FineRecipe = {};
 for (const name of Object.keys(properties)) if (!rules[name]) throw new DvError("CAPTION_RECIPE", `Unknown caption recipe property '${name}'`);
 for (const [name, rule] of Object.entries(rules)) {
  const value = properties[name] ?? rule.fallback; if (value === undefined) { if (required.includes(name)) throw new DvError("CAPTION_RECIPE", `Missing caption recipe property '${name}'`); continue; }
  if (rule.padding) padding(value as string);
  else if (rule.color) { if (typeof value !== "string" || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) throw new DvError("CAPTION_RECIPE", `${name} requires a six or eight digit hexadecimal color`); }
  else if (rule.choices) { if (typeof value !== "string" || !rule.choices.includes(value)) throw new DvError("CAPTION_RECIPE", `${name} requires ${rule.choices.join("|")}`); }
  else if (typeof value !== "number" || !Number.isFinite(value) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity) || rule.integer && !Number.isSafeInteger(value) || rule.positive && value === 0) throw new DvError("CAPTION_RECIPE", `Invalid numeric caption property '${name}'`);
  result[name] = value as string | number;
 }
 result["word-gap"] ??= Number(result.size) * .25; result["underline-color"] ??= result.fill!;
 for (const name of Object.keys(paintDefaults)) if (!name.startsWith("gradient-")) result[`active-${name}`] ??= name === "fill" ? "#FFD54A" : result[name]!;
 result["active-gradient-angle"] ??= 90;
 for (const prefix of ["", "active-"]) if ((result[`${prefix}gradient-from`] === undefined) !== (result[`${prefix}gradient-to`] === undefined)) throw new DvError("CAPTION_RECIPE", "Gradient requires both endpoint colors");
 if (result["max-lines"] !== undefined && result["max-words-per-line"] === undefined) throw new DvError("CAPTION_RECIPE", "max-lines requires max-words-per-line");
 if (result["cue-enter-start-scale"] !== undefined && result["cue-enter"] === "none") throw new DvError("CAPTION_RECIPE", "cue-enter-start-scale requires a cue entrance action");
 return result;
}
function alpha(color: string, opacity: number): string { return color.slice(0, 7) + Math.round(opacity * (color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1) * 255).toString(16).padStart(2, "0"); }
function paints(p: FineRecipe, prefix: string): Paint[] {
 const n = (key: string) => Number(p[prefix + key]); const c = (key: string) => String(p[prefix + key]);
 const ink: Ink = p[prefix + "gradient-from"] === undefined ? { kind: "solid", color: c("fill") } : { kind: "linear", angleDegrees: n("gradient-angle"), stops: [{ offset: 0, color: c("gradient-from"), opacity: 1 }, { offset: 1, color: c("gradient-to"), opacity: 1 }] };
 const result: Paint[] = [];
 if (n("long-shadow-opacity") && n("long-shadow-distance")) { const angle = n("long-shadow-angle") * Math.PI / 180; const distance = n("long-shadow-distance"); for (let d = 1; d <= Math.ceil(distance); d++) { const at = Math.min(d, distance); result.push({ kind: "shadow", ink: { kind: "solid", color: alpha(c("long-shadow-color"), n("long-shadow-opacity")) }, xPx: Math.cos(angle) * at, yPx: Math.sin(angle) * at, blurPx: 0, spreadPx: 0 }); } }
 if (n("shadow-opacity")) result.push({ kind: "shadow", ink: { kind: "solid", color: alpha(c("shadow-color"), n("shadow-opacity")) }, xPx: n("shadow-x"), yPx: n("shadow-y"), blurPx: n("shadow-blur"), spreadPx: n("shadow-spread") });
 if (n("glow-opacity")) result.push({ kind: "glow", ink: { kind: "solid", color: alpha(c("glow-color"), n("glow-opacity")) }, blurPx: n("glow-blur"), spreadPx: n("glow-spread") });
 if (n("stroke-width")) result.push({ kind: "stroke", ink: { kind: "solid", color: c("stroke-color") }, widthPx: n("stroke-width"), placement: "center" }); result.push({ kind: "fill", ink }); return result;
}
export function createFineStyle(styleKey: string, recipe: Recipe, font: FontFace | FontStack, fallbacks: FontFace[] = []): FineStyle {
 const p = decodeFineRecipe(recipe.properties); const fonts: FontStack = { stackKey: `${styleKey}/fonts`, faces: [...("faces" in font ? font.faces : [font]), ...fallbacks] }; validateFontStack(fonts);
 const base: TextFormat = { fonts, sizePx: Number(p.size), lineHeight: Number(p["line-height"]), trackingPx: Number(p["letter-spacing"]), wordSpacingPx: Number(p["word-gap"]), axes: [], features: [], direction: p.direction as TextFormat["direction"], writingMode: "horizontal-tb", kerning: p.kerning as TextFormat["kerning"], synthesis: "none", baselineShiftPx: 0, verticalAlign: "baseline", tabSize: 4, indentPx: 0, paragraphBeforePx: 0, paragraphAfterPx: 0, transform: p["text-transform"] as TextFormat["transform"], caps: p.caps as TextFormat["caps"], cjkSpacing: "none", punctuationTrim: "none", paints: paints(p, ""), decorations: p.underline === "always" ? [{ line: "underline", ink: { kind: "solid", color: String(p["underline-color"]) }, style: "solid", thicknessPx: Number(p["underline-thickness"]), offsetPx: Number(p["underline-offset"]), skipInk: false }] : [] };
 const active: TextFormat = { ...base, paints: paints(p, "active-"), decorations: [] }; validateTextFormat(base); validateTextFormat(active); return { kind: "fine", styleKey, recipe: p, base, active };
}
