import assert from "node:assert/strict";
import test from "node:test";
import { DvError } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
import { parseDvs, serializeDvsValue } from "./dvs.ts";

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

test("DVS UTF-16 rule/property spans preserve separators and adjacent trivia during edits", () => {
  const body = '{\r\n  /* 中文😀 before */\r\n  settings /* name */ : /* value */ {"中文":"😀","rows":[1,{"x":true}]}  /* trailing😀 */ ;\r\n  /* adjacent */\r\n  label: \'中文😀 &amp;\\n\';\r\n  /* end */\r\n}';
  const text = `\uFEFF${header}${root}/* 😀 prefix */\r\nmedia.base /* opening */ ${body}\r\n</sheet>`;
  const sheet = parseDvs("utf16.dvs", text);
  const rule = sheet.rules[0]!;
  const settings = rule.properties[0]!;
  const label = rule.properties[1]!;
  const slice = (span: { start: number; end: number } | undefined) => {
    assert.ok(span);
    return text.slice(span.start, span.end);
  };
  assert.equal(sheet.source, text);
  assert.equal(rule.nameSpan?.start, text.indexOf("media.base"));
  assert.equal(slice(rule.nameSpan), "media.base");
  assert.equal(slice(rule.bodySpan), body);
  assert.equal(slice(rule.openingBrace), "{");
  assert.equal(slice(rule.closingBrace), "}");
  assert.equal(rule.insertion?.start, text.lastIndexOf("}"));
  assert.equal(slice(rule.insertion), "");
  assert.equal(slice(settings.nameSpan), "settings");
  assert.equal(slice(settings.valueSpan), '{"中文":"😀","rows":[1,{"x":true}]}');
  assert.equal(settings.valueRaw, slice(settings.valueSpan));
  assert.equal(slice(settings.fullSpan), 'settings /* name */ : /* value */ {"中文":"😀","rows":[1,{"x":true}]}  /* trailing😀 */ ;');
  assert.equal(settings.raw, slice(settings.fullSpan));
  assert.equal(slice(settings.deleteSpan), slice(settings.fullSpan));
  assert.equal(slice(settings.separatorSpan), ";");
  assert.equal(slice(label.valueSpan), "'中文😀 &amp;\\n'");
  assert.equal(label.value, "中文😀 &amp;\\n");
  const span = settings.valueSpan!;
  const value: Json = { 中文: "新的😀", rows: [false, { x: null }] };
  const edited = text.slice(0, span.start) + serializeDvsValue(value) + text.slice(span.end);
  assert.deepEqual(parseDvs("utf16.dvs", edited).rules[0]!.properties[0]!.value, value);
  assert.ok(edited.includes('  /* trailing😀 */ ;\r\n  /* adjacent */'));
  const deletion = settings.deleteSpan!;
  const deleted = text.slice(0, deletion.start) + text.slice(deletion.end);
  const remaining = parseDvs("utf16.dvs", deleted).rules[0]!.properties;
  assert.deepEqual(remaining.map(({ name, value }) => ({ name, value })), [{ name: "label", value: "中文😀 &amp;\\n" }]);
  assert.ok(deleted.includes("/* 中文😀 before */"));
  assert.ok(deleted.includes("/* adjacent */"));
});

test("DVS insertion spans admit new properties without rebuilding existing text", () => {
  const text = `${header}${root}media.empty { /* keep😀 */ }\n</sheet>`;
  const rule = parseDvs("insert.dvs", text).rules[0]!;
  const gap = rule.insertion!;
  const edited = text.slice(0, gap.start) + `rows: ${serializeDvsValue([{ label: "中文😀", items: [1, null] }])}; ` + text.slice(gap.end);
  assert.ok(edited.includes("{ /* keep😀 */ rows: "));
  assert.deepEqual(parseDvs("insert.dvs", edited).rules[0]!.properties[0]!.value, [{ label: "中文😀", items: [1, null] }]);
});

test("DVS serializers preserve scalar escapes and strict JSON record/list values", () => {
  const values: Json[] = [
    null, true, false, 0, -0, -2.5, 1e21, 1e-7, Number.MIN_VALUE, Number.MAX_VALUE,
    "", "中文😀", "50%", "null", 'He said "hi"', "don't", "line\\ntext", "a; } /* literal */", 'escaped \\"quote',
    [1, "😀\n中文", { quote: '"', nested: [null, false] }],
    { 中文: "😀", escapes: "\n\\\"'", nested: { list: [1, 2] } },
  ];
  for (const value of values) {
    const serialized = serializeDvsValue(value);
    const actual = parseDvs("serialize.dvs", `${header}${root}media.base { value: ${serialized}; }</sheet>`).rules[0]!.properties[0]!.value;
    assert.deepEqual(actual, value, serialized);
  }
  assert.throws(() => serializeDvsValue('both " and \' delimiters'), (error: unknown) => error instanceof DvError && error.code === "DVS_VALUE_STRING");
  assert.throws(() => serializeDvsValue({ bad: Infinity }), (error: unknown) => error instanceof DvError && error.code === "DVS_VALUE_NUMBER");
});
