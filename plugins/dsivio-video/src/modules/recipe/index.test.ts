import test from "node:test";
import assert from "node:assert/strict";
import recipe, { RECIPE, validateRecipe } from "./index.ts";
import { DvError } from "../../core/errors.ts";
import type { Json, Value } from "../../core/value.ts";

const span = { file: "look.dvs", start: 0, end: 1, line: 1, column: 1 };

test("recipe frontend publishes independent full dotted names without the sheet id", () => {
  const values: Record<string, Value> = {};
  recipe.frontends!["dsivio-video/dvs@1"]!.compile({ file: span.file, using: "dsivio-video/dvs@1", id: "look", rules: [
    { name: "media.base", properties: [{ name: "palette", value: ["red", "blue"], span }, { name: "duration", value: 5, span }], span },
    { name: "media.hero", properties: [{ name: "duration", value: 6, span }], span },
  ] }, { record(name, value) { values[name] = value; }, fail(code, message, source) { throw new DvError(code, message, { span: source }); } });
  assert.deepEqual(JSON.parse(JSON.stringify(values)), {
    "media.base": { type: RECIPE, data: { rule: "media.base", properties: { palette: ["red", "blue"], duration: 5 } } },
    "media.hero": { type: RECIPE, data: { rule: "media.hero", properties: { duration: 6 } } },
  });
});

test("recipe validates its data, including nested finite numbers", () => {
  const cases: Json[] = [null, "recipe", { rule: "base", properties: {} }, { rule: "media.base", properties: [] }, { rule: "media.base", properties: { x: [Infinity] } }, { rule: "media.base", properties: { "bad_name": 1 } }];
  for (const data of cases) {
    assert.throws(() => validateRecipe(data), { code: "TYPE_INVALID" });
  }
});

test("recipe frontend rejects duplicate rules and properties", () => {
  const rule = { name: "media.base", properties: [{ name: "x", value: 1, span }], span };
  const ctx = { record() {}, fail(code: string, message: string) { throw new DvError(code, message); } };
  for (const rules of [[rule, rule], [{ ...rule, properties: [...rule.properties, ...rule.properties] }]]) {
    assert.throws(() => recipe.frontends!["dsivio-video/dvs@1"]!.compile({ file: span.file, using: "dsivio-video/dvs@1", rules }, ctx), { code: "RECIPE_DUPLICATE" });
  }
});
