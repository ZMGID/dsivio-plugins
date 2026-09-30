import assert from "node:assert/strict";
import test from "node:test";
import { DvError } from "../core/errors.ts";
import { parseDvs } from "./dvs.ts";

const header = '<?dvml using="dsivio-video/dvs@1"?>\n';
const root = '<sheet version="1">\n';

test("DVS preserves flat rules and recognizes scalars, JSON, and strings in order", () => {
  const text = `${header}<sheet version="1" id="look">\n/* palette */\nmedia.performance {\n  nil: null;\n  yes: true;\n  no: false;\n  duration: -6.5;\n  exponent: 1e3;\n  positive: +2;\n  unit: 8f;\n  percentage: 50%;\n  palette: ["#204060", "#f4e8d0"];\n  settings: {"enabled":true,"nested":[null,1]};\n  quoted: 'line\\ntext';\n  text: "a; } /* preserved */";\n  motion: fixed;\n}\nmedia.base { duration: 6; }\n</sheet>\n/* done */`;
  const sheet = parseDvs("look.dvs", text);
  assert.equal(sheet.using, "dsivio-video/dvs@1");
  assert.equal(sheet.id, "look");
  assert.deepEqual(sheet.rules.map((rule) => rule.name), ["media.performance", "media.base"]);
  assert.deepEqual(Object.fromEntries(sheet.rules[0]!.properties.map((property) => [property.name, property.value])), {
    nil: null, yes: true, no: false, duration: -6.5, exponent: "1e3", positive: "+2", unit: "8f", percentage: "50%",
    palette: ["#204060", "#f4e8d0"], settings: { enabled: true, nested: [null, 1] }, quoted: "line\\ntext", text: "a; } /* preserved */", motion: "fixed",
  });
  assert.equal(sheet.rules[0]!.span.line, 4);
  assert.equal(sheet.rules[0]!.span.column, 1);
  assert.equal(sheet.rules[0]!.properties[0]!.span.line, 5);
  assert.equal(sheet.rules[0]!.properties[0]!.span.column, 3);
});

test("BOM, CRLF, and strict JSON string escapes preserve correct offsets", () => {
  const text = `\uFEFF${header.replace("\n", "\r\n")}${root.replace("\n", "\r\n")}text.template {\r\n  value: {"line":"a\\nb;}","array":[1,2]};\r\n}\r\n</sheet>`;
  const sheet = parseDvs("template.dvs", text);
  assert.deepEqual(sheet.rules[0]!.properties[0]!.value, { line: "a\nb;}", array: [1, 2] });
  assert.equal(sheet.rules[0]!.span.start, text.indexOf("text.template"));
  assert.equal(sheet.rules[0]!.span.line, 3);
  assert.equal(sheet.rules[0]!.properties[0]!.span.column, 3);
});

const failures = [
  { body: "<wrong>", code: "DVS_ROOT", line: 2, column: 1 },
  { body: root, code: "DVS_ROOT_UNCLOSED", line: 2, column: 1 },
  { body: `${root}</sheet>\nextra`, code: "DVS_TRAILING", line: 4, column: 1 },
  { body: '<sheet version="2"></sheet>', code: "DVS_VERSION", line: 2, column: 1 },
  { body: '<sheet version="1" id="Upper"></sheet>', code: "DVS_SHEET_ID", line: 2, column: 1 },
  { body: '<sheet version="1" extra="x"></sheet>', code: "DVS_SHEET_ATTRIBUTE", line: 2, column: 20 },
  { body: '<sheet version="1" version="1"></sheet>', code: "DVS_SHEET_ATTRIBUTE_DUPLICATE", line: 2, column: 20 },
  { body: `${root}single {}\n</sheet>`, code: "DVS_RULE", line: 3, column: 1 },
  { body: `${root}media.base {}\nmedia.base {}\n</sheet>`, code: "DVS_RULE_DUPLICATE", line: 4, column: 1 },
  { body: `${root}media.base;\n</sheet>`, code: "DVS_RULE_OPEN", line: 3, column: 11 },
  { body: `${root}media.base {\n</sheet>`, code: "DVS_RULE_UNCLOSED", line: 3, column: 1 },
  { body: `${root}media.base {\n  Bad: 1;\n}\n</sheet>`, code: "DVS_PROPERTY", line: 4, column: 3 },
  { body: `${root}media.base {\n  a: 1;\n  a: 2;\n}\n</sheet>`, code: "DVS_PROPERTY_DUPLICATE", line: 5, column: 3 },
  { body: `${root}media.base {\n  camera fixed;\n}\n</sheet>`, code: "DVS_PROPERTY_COLON", line: 4, column: 10 },
  { body: `${root}media.base {\n  duration: 6\n}\n</sheet>`, code: "DVS_PROPERTY_SEMICOLON", line: 5, column: 1 },
  { body: `${root}media.base {\n  duration: ;\n}\n</sheet>`, code: "DVS_VALUE_EMPTY", line: 4, column: 13 },
  { body: `${root}media.base {\n  palette: [1,];\n}\n</sheet>`, code: "DVS_VALUE_STRUCTURED", line: 4, column: 12 },
  { body: `${root}/* never closed`, code: "DVS_COMMENT_UNCLOSED", line: 3, column: 1 },
];
for (const failure of failures) {
  test(failure.code, () => {
    assert.throws(() => parseDvs("look.dvs", header + failure.body), (error: unknown) => {
      assert.ok(error instanceof DvError);
      assert.equal(error.code, failure.code);
      assert.equal(error.span?.line, failure.line);
      assert.equal(error.span?.column, failure.column);
      return true;
    });
  });
}

test("structured values reject single quotes, trailing commas, references, and JSON comments", () => {
  for (const value of ["['x']", '{"x":1,}', "[{binding}]", "[1", "[1, /* forbidden */ 2]"]) {
    assert.throws(() => parseDvs("look.dvs", `${header}${root}media.base {\n  value: ${value};\n}\n</sheet>`), (error: unknown) => error instanceof DvError && error.code === "DVS_VALUE_STRUCTURED" && error.span?.line === 4 && error.span.column === 10);
  }
});
