import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Frame } from "../../space/types.ts";
import { spaceTypes } from "../../space/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import type { PerformanceStyle } from "../types.ts";
import { trackTypes } from "../types.ts";
import type { Ink, StyleDeclaration } from "../../render/ir.ts";
import { RECIPE, validateRecipe } from "../../modules/recipe/index.ts";
import { decodeTrackUses, empty, literal, reference, structured } from "../sound/author.ts";
import { finite, integer } from "../sound/validate.ts";
import { validatePerformanceStyle } from "./validate.ts";

const APPEARANCE_KEYS = ["stack-order", "fit", "frame-x", "frame-y", "content-x", "content-y", "fit-offset-x", "fit-offset-y", "fit-constraint", "opacity", "blur", "brightness", "contrast", "saturation", "clip", "radius", "padding", "border-width", "border-style", "border-color", "shadows", "frame-paint"];
function number(properties: Record<string, Json>, key: string, fallback: number, min = -Infinity, max = Infinity): number {
  const value = properties[key] ?? fallback;
  finite(value, min, max);
  return value;
}
function choice<T extends string>(properties: Record<string, Json>, key: string, fallback: T, values: readonly T[]): T {
  const value = properties[key] ?? fallback;
  if (typeof value !== "string" || !values.includes(value as T)) throw new DvError("PERFORMANCE_RECIPE", `Invalid '${key}'.`);
  return value as T;
}
function color(value: unknown): string {
  if (typeof value !== "string" || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) throw new DvError("PERFORMANCE_RECIPE", "Colors must be six/eight-digit hexadecimal values.");
  return value;
}
export function parseFrameInk(value: unknown): Ink {
  if (typeof value !== "string") throw new DvError("PERFORMANCE_RECIPE", "Frame paint must be an explicit color or gradient.");
  if (value.startsWith("#")) return { kind: "solid", color: color(value) };
  const match = /^(linear|radial)\(([^;]+);(.+)\)$/.exec(value.trim());
  if (!match) throw new DvError("PERFORMANCE_RECIPE", "Gradient syntax is linear(angle; offset color, ...) or radial(x y; offset color, ...).");
  const stops = match[3]!.split(",").map(part => {
    const fields = part.trim().split(/\s+/);
    if (fields.length !== 2 && fields.length !== 3) throw new DvError("PERFORMANCE_RECIPE", "Gradient stop requires offset, color and optional opacity.");
    const offset = Number(fields[0]); const opacity = fields[2] === undefined ? 1 : Number(fields[2]);
    finite(offset, 0, 1); finite(opacity, 0, 1);
    return { offset, color: color(fields[1]), opacity };
  });
  if (stops.length < 2 || stops.some((stop, index) => index > 0 && stop.offset <= stops[index - 1]!.offset)) throw new DvError("PERFORMANCE_RECIPE", "Gradient needs at least two strictly ordered stops.");
  const coordinates = match[2]!.trim().split(/\s+/).map(Number);
  if (match[1] === "linear") {
    if (coordinates.length !== 1) throw new DvError("PERFORMANCE_RECIPE", "Linear gradient requires one angle.");
    finite(coordinates[0]); return { kind: "linear", angleDegrees: coordinates[0], stops };
  }
  if (coordinates.length !== 2) throw new DvError("PERFORMANCE_RECIPE", "Radial gradient requires two center ratios.");
  finite(coordinates[0], 0, 1); finite(coordinates[1], 0, 1);
  return { kind: "radial", centerX: coordinates[0], centerY: coordinates[1], stops };
}
export function frameInkCss(ink: Ink): string {
  if (ink.kind === "solid") return ink.color;
  const stops = ink.stops.map(stop => `color-mix(in srgb, ${stop.color} ${stop.opacity * 100}%, transparent) ${stop.offset * 100}%`).join(", ");
  return ink.kind === "linear" ? `linear-gradient(${ink.angleDegrees}deg, ${stops})` : `radial-gradient(at ${ink.centerX * 100}% ${ink.centerY * 100}%, ${stops})`;
}
export function performanceStyle(styleKey: string, frame: Frame, properties: Record<string, Json>): PerformanceStyle {
  if (Object.keys(properties).some(key => !APPEARANCE_KEYS.includes(key)) || properties["stack-order"] === undefined) throw new DvError("PERFORMANCE_RECIPE", "Appearance requires stack-order and only supported performance keys; playback/trim are forbidden.");
  const layer = number(properties, "stack-order", 0); integer(layer, -Number.MAX_SAFE_INTEGER);
  const padding = properties.padding ?? "0";
  if (typeof padding !== "string") throw new DvError("PERFORMANCE_RECIPE", "Padding is a one/two/four-number string.");
  const sides = padding.trim().split(/\s+/).map(Number); sides.forEach(value => finite(value, 0));
  if (![1, 2, 4].includes(sides.length)) throw new DvError("PERFORMANCE_RECIPE", "Padding requires one, two or four sides.");
  const border = number(properties, "border-width", 0, 0);
  const contentInsetPx: [number, number, number, number] = sides.length === 1 ? [sides[0]!, sides[0]!, sides[0]!, sides[0]!] : sides.length === 2 ? [sides[0]!, sides[1]!, sides[0]!, sides[1]!] : [sides[0]!, sides[1]!, sides[2]!, sides[3]!];
  for (let index = 0; index < 4; index++) contentInsetPx[index] = contentInsetPx[index]! + border;
  const radiusPx = number(properties, "radius", 0, 0);
  const outerStyle: StyleDeclaration[] = [{ property: "opacity", value: String(number(properties, "opacity", 1, 0, 1)) }, { property: "filter", value: `blur(${number(properties, "blur", 0, 0)}px) brightness(${number(properties, "brightness", 1, 0)}) contrast(${number(properties, "contrast", 1, 0)}) saturate(${number(properties, "saturation", 1, 0)})` }];
  const borderStyle = choice(properties, "border-style", "solid", ["solid", "dashed", "dotted"]);
  if (properties["border-color"] !== undefined) color(properties["border-color"]);
  if (border > 0) outerStyle.push({ property: "border", value: `${border}px ${borderStyle} ${color(properties["border-color"])}` });
  if (radiusPx > 0) outerStyle.push({ property: "border-radius", value: `${radiusPx}px` });
  if (properties.shadows !== undefined) {
    if (typeof properties.shadows !== "string" || !properties.shadows.trim()) throw new DvError("PERFORMANCE_RECIPE", "Shadows require x y blur spread color groups.");
    const shadows = properties.shadows.split(";").map(part => {
      const fields = part.trim().split(/\s+/);
      if (fields.length !== 5) throw new DvError("PERFORMANCE_RECIPE", "Shadow requires x y blur spread color.");
      const values = fields.slice(0, 4).map(Number); values.forEach(value => finite(value)); finite(values[2], 0);
      return `${values.map(value => `${value}px`).join(" ")} ${color(fields[4])}`;
    });
    outerStyle.push({ property: "box-shadow", value: shadows.join(", ") });
  }
  const style: PerformanceStyle = { styleKey, frame, layer, fit: {
    mode: choice(properties, "fit", "contain", ["contain", "cover", "fit-width", "fit-height", "native", "scale-down", "stretch"] as const),
    frameAnchor: { x: number(properties, "frame-x", 0.5, 0, 1), y: number(properties, "frame-y", 0.5, 0, 1) },
    contentAnchor: { x: number(properties, "content-x", 0.5, 0, 1), y: number(properties, "content-y", 0.5, 0, 1) },
    offsetXPx: number(properties, "fit-offset-x", 0), offsetYPx: number(properties, "fit-offset-y", 0), limit: choice(properties, "fit-constraint", "bounded", ["bounded", "free"] as const),
  }, outerStyle, contentInsetPx, clip: choice(properties, "clip", "frame", ["none", "frame", "rounded"]), radiusPx };
  if (properties["frame-paint"] !== undefined) style.framePaint = { kind: "fill", ink: parseFrameInk(properties["frame-paint"]) };
  validatePerformanceStyle(style);
  return style;
}
export function decodePerformanceStyle(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "frame", "appearance"]); empty(element, ctx);
  const id = literal(attrs, "id", element, ctx);
  const frame = reference(attrs, "frame", [spaceTypes.frame], element, ctx);
  const appearance = reference(attrs, "appearance", [RECIPE], element, ctx);
  if (appearance.kind !== "record") ctx.fail("PERFORMANCE_RECIPE", "Appearance must be a static author Recipe.", element.span);
  validateRecipe(appearance.value.data);
  const key = ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, element.span);
  ctx.operation({ producer: "dsivio-video/performance@1#style", inputs: { frame, appearance, key }, publish: { style: id }, label: id, span: element.span });
}
export function decodePerformanceTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "timeline", "canvas"]);
  const id = literal(attrs, "id", element, ctx);
  const timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx);
  const canvas = reference(attrs, "canvas", [spaceTypes.canvas], element, ctx);
  const uses = decodeTrackUses(element, ctx, id, timeline, trackTypes.performanceStyle);
  const plan = ctx.record(null, { type: trackTypes.performancePlan, data: uses.plan }, element.span);
  const outputs = ctx.operation({ producer: "dsivio-video/performance@1#program", inputs: { timeline, canvas, plan, windows: uses.windows, styles: uses.styles }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/performance@1#lower", inputs: { program: outputs.program! }, publish: { visual: `${id}.visual` }, label: id, span: element.span });
}
