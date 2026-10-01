import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { FontFace, FontStack } from "../../fonts/types.ts";
import type { Recipe } from "../../modules/recipe/index.ts";
import { typographyStyle } from "../typo/author.ts";
import { object, exact, key } from "../../space/validate.ts";
import type { RankingKind, RankingStyle, SoundStyle } from "./types.ts";
const soundDefaults = { "appear-gain": 1, "move-gain": 1, "sound-fade-frames": 0 };
const textDefaults = { "font-size": 28, "font-weight": 700, "text-color": "#ffffff", "line-height": 1.15, "appear-frames": 6, "move-frames": 8, "motion-easing": "ease-in-out" };
const boardDefaults = { "board-background": "#151821", "board-border-color": "#ffffff33", "board-border-width": 1, "board-radius": 18, "board-shadow-x": 0, "board-shadow-y": 10, "board-shadow-blur": 24, "board-shadow-spread": 0, "board-shadow-color": "#00000066" };
const rankColors = ["#facc15", "#d1d5db", "#fb923c", "#60a5fa", "#a78bfa"];
export const defaults: Record<RankingKind, Record<string, Json>> = {
  TierBoard: { ...soundDefaults, rows: ["s", "a", "b", "c", "d"].map((id, i) => ({ id, label: id.toUpperCase(), color: ["#EE5F52", "#F0A04C", "#F0C84D", "#EDE356", "#A6DA7B"][i]! })), "label-text-color": "#2c2c2c", "label-size": .3, "line-height": 1, "board-background": "#2b2b30", "board-border-color": "#111315", "board-border-width": 3, "stage-x": .2, "stage-y": .3, "stage-size": 168, "icon-radius-ratio": .12, "icon-fit": "cover", "appear-frames": 8, "move-frames": 14, "board-stack": 20, "stage-stack": 25, "item-stack": 30 },
  Column: { ...soundDefaults, ...textDefaults, ...boardDefaults, "board-stack": 20, "item-stack": 30, "stage-stack": 25, "rank-colors": rankColors, padding: 18, "row-height": 74, "row-gap": 10, "icon-size": 58, "icon-radius": 10, "icon-fit": "cover", "stage-x": .66, "stage-y": .73, "stage-size": 356 },
  TopThree: { ...soundDefaults, ...textDefaults, ...boardDefaults, "slot-colors": rankColors.slice(0, 3), "center-x": .5, "baseline-y": .55, "slot-gap": 24, "icon-size": 104, "icon-radius": 52, "icon-fit": "cover", "ring-width": 5, "label-gap": 12, "board-stack": 20, "item-stack": 30 },
};
const positive = ["font-size", "line-height", "stage-size", "row-height", "icon-size"];
const nonnegative = ["board-border-width", "board-radius", "padding", "row-gap", "icon-radius", "slot-gap", "ring-width", "label-gap"];
const ratios = ["label-size", "label-width", "stage-x", "stage-y", "icon-radius-ratio", "center-x", "baseline-y"];
const integers = ["font-weight", "board-stack", "item-stack", "stage-stack", "appear-frames", "move-frames", "sound-fade-frames"];
const color = (v: unknown): void => { if (typeof v !== "string" || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(v)) throw new DvError("RANKING_RECIPE", "Colors require six or eight hexadecimal digits"); };
export function validateProperties(kind: RankingKind, properties: unknown): asserts properties is Record<string, Json> {
  const p = object(properties); const allowed = [...Object.keys(defaults[kind]), ...(kind === "TierBoard" ? ["label-width"] : [])];
  exact(p, allowed);
  for (const name of Object.keys(defaults[kind])) if (p[name] === undefined) throw new DvError("RANKING_RECIPE", `Missing normalized property '${name}'`);
  for (const [name, value] of Object.entries(p)) {
    if (name === "rows") {
      if (!Array.isArray(value) || !value.length) throw new DvError("RANKING_RECIPE", "rows must be nonempty");
      const seen = new Set<string>(); for (const row of value) { const r = object(row); exact(r, ["id", "label", "color"]); key(r.id); key(r.label); color(r.color); if (seen.has(r.id)) throw new DvError("RANKING_RECIPE", "Tier row IDs must be unique"); seen.add(r.id); }
    } else if (name.endsWith("colors")) { if (!Array.isArray(value) || !value.length) throw new DvError("RANKING_RECIPE", `${name} requires nonempty colors`); value.forEach(color); }
    else if (name.includes("color") || name === "board-background") color(value);
    else if (name === "icon-fit") { if (value !== "contain" && value !== "cover") throw new DvError("RANKING_RECIPE", "icon-fit must be contain or cover"); }
    else if (name === "motion-easing") { if (!["linear", "ease-in", "ease-out", "ease-in-out"].includes(String(value))) throw new DvError("RANKING_RECIPE", "Unsupported motion easing"); }
    else {
      if (typeof value !== "number" || !Number.isFinite(value) || positive.includes(name) && value <= 0 || nonnegative.includes(name) && value < 0 || ratios.includes(name) && (value < 0 || value > 1) || integers.includes(name) && !Number.isSafeInteger(value) || name.endsWith("-frames") && value < (name === "sound-fade-frames" ? 0 : 1) || name.endsWith("-gain") && (value < 0 || value > 64)) throw new DvError("RANKING_RECIPE", `Invalid numeric recipe property '${name}'`);
    }
  }
}
export function rankingStyle(kind: RankingKind, styleKey: string, recipe: Recipe, font: FontFace | FontStack): RankingStyle {
  const properties = { ...defaults[kind], ...recipe.properties }; validateProperties(kind, properties);
  const format = typographyStyle(styleKey, { rule: "ranking.format", properties: { size: kind === "TierBoard" ? 28 : properties["font-size"]!, weight: kind === "TierBoard" ? ("faces" in font ? font.faces[0]!.weight : font.weight) : properties["font-weight"]!, fill: kind === "TierBoard" ? properties["label-text-color"]! : properties["text-color"]!, "line-height": properties["line-height"]!, "stack-order": 0 } }, font, { paints: [], axes: [], features: [], decorations: [] }).format;
  const sound: SoundStyle = { appearGain: Number(properties["appear-gain"]), moveGain: Number(properties["move-gain"]), fadeFrames: Number(properties["sound-fade-frames"]) };
  return { kind, styleKey, properties, format, sound };
}
