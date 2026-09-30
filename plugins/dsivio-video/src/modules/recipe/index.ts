import { DvError } from "../../core/errors.ts";
import type { ModuleDef } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";

export const RECIPE = "dsivio-video/recipe@1#Recipe";
export type Recipe = { rule: string; properties: Record<string, Json> };

export function validateRecipe(data: Json): asserts data is Recipe {
  if (data === null || typeof data !== "object" || Array.isArray(data)
    || typeof data.rule !== "string" || !/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/.test(data.rule)
    || data.properties === null || typeof data.properties !== "object" || Array.isArray(data.properties)
    || Object.keys(data).some((key) => key !== "rule" && key !== "properties")) {
    throw new DvError("TYPE_INVALID", "Recipe must contain a dotted rule name and a properties object.");
  }
  for (const key of Object.keys(data.properties)) {
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new DvError("TYPE_INVALID", `Invalid recipe property '${key}'.`);
  }
  const check = (value: Json): void => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new DvError("TYPE_INVALID", "Recipe numbers must be finite.");
    if (Array.isArray(value)) value.forEach(check);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(check);
  };
  check(data.properties);
}

const recipe: ModuleDef = {
  id: "dsivio-video/recipe@1",
  summary: "Explicit recipe data; dotted rule names do not imply inheritance or cascade.",
  types: { Recipe: { summary: "A full dotted rule name and its unmodified JSON properties.", validate: validateRecipe } },
  surfaces: {},
  producers: {},
  frontends: {
    "dsivio-video/dvs@1": {
      summary: "Publishes each sheet rule as a Recipe under its full dotted name; sheet id adds no prefix. No inheritance or cascade.",
      compile(sheet, ctx) {
        const names = new Set<string>();
        for (const rule of sheet.rules) {
          if (names.has(rule.name)) ctx.fail("RECIPE_DUPLICATE", `Duplicate recipe '${rule.name}'.`, rule.span);
          names.add(rule.name);
          const properties: Record<string, Json> = Object.create(null);
          for (const property of rule.properties) {
            if (Object.hasOwn(properties, property.name)) ctx.fail("RECIPE_DUPLICATE", `Duplicate property '${property.name}'.`, property.span);
            properties[property.name] = property.value;
          }
          const data = { rule: rule.name, properties };
          try { validateRecipe(data); }
          catch (error) {
            if (error instanceof DvError) ctx.fail(error.code, error.message, rule.span);
            throw error;
          }
          ctx.record(rule.name, { type: RECIPE, data }, rule.span);
        }
      },
    },
  },
};

export default recipe;
