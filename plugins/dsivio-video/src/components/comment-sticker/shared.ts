import { DvError } from "../../core/errors.ts";
import type { Json, ResourceRef } from "../../core/value.ts";
import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { ElementNode } from "../../markup/ast.ts";
import { WINDOW_ATTRIBUTES, decodeWindowAttributes, publishWindow } from "../../modules/time/index.ts";
import { validateMedia } from "../../modules/media/index.ts";
import { finite, integer, object } from "../sound/validate.ts";
import { parseFrameInk } from "../performance/author.ts";
export type Rule = { value: Json; min?: number; max?: number; integer?: boolean; choices?: readonly string[]; color?: boolean; background?: boolean };
export function resolveProperties(properties: Record<string, Json>, rules: Record<string, Rule>): Record<string, Json> {
  for (const key of Object.keys(properties)) if (!rules[key]) throw new DvError("STICKER_RECIPE", `Unknown recipe property '${key}'.`);
  const result: Record<string, Json> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const value = Object.hasOwn(properties, key) ? properties[key]! : rule.value;
    if (rule.background) { parseFrameInk(value); }
    else if (rule.color) { if (typeof value !== "string" || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) throw new DvError("STICKER_RECIPE", `'${key}' requires a six/eight-digit color.`); }
    else if (rule.choices) { if (typeof value !== "string" || !rule.choices.includes(value)) throw new DvError("STICKER_RECIPE", `Invalid '${key}'.`); }
    else if (typeof rule.value === "boolean") { if (typeof value !== "boolean") throw new DvError("STICKER_RECIPE", `'${key}' requires a boolean.`); }
    else { finite(value, rule.min ?? -Infinity, rule.max ?? Infinity); if (rule.integer) integer(value, rule.min ?? -Number.MAX_SAFE_INTEGER); }
    result[key] = value;
  }
  return result;
}
export function checkedProperties(data: unknown, rules: Record<string, Rule>): Record<string, Json> {
  const record = object(data, Object.keys(rules));
  return resolveProperties(record as Record<string, Json>, rules);
}
export function image(data: unknown): asserts data is ResourceRef {
  validateMedia(data as Json, "image");
  if ((data as ResourceRef).bytes <= 0) throw new DvError("STICKER_IMAGE", "Images require positive byte counts.");
}
export function requiredWindow(element: ElementNode, timeline: Binding, key: string, ctx: ElaborationContext): Binding {
  if (!element.attributes.some(attribute => WINDOW_ATTRIBUTES.includes(attribute.name as typeof WINDOW_ATTRIBUTES[number]))) ctx.fail("TIME_FORM", "An explicit window is required.", element.span);
  return publishWindow(timeline, decodeWindowAttributes(element, ctx), key, ctx, element.span);
}
export function number(properties: Record<string, Json>, key: string): number { return properties[key] as number; }
export function text(properties: Record<string, Json>, key: string): string { return properties[key] as string; }
