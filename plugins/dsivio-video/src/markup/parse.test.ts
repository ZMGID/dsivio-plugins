import assert from "node:assert/strict";
import test from "node:test";
import { DvError } from "../core/errors.ts";
import { parseMarkup } from "./parse.ts";

const header = '<?dvml using="dsivio-video/markup@1"?>\n';
const options = { isRaw: (tag: string) => tag === "raw" };

test("structured markup preserves text, spans, literals, and whole-value references", () => {
  const text = `${header}<!-- before --><dvml>\n  <import from="dsivio-video/text@1" as="text"/>\n  <import source="./kit.dvs" as="kit"/>\n  <text:Render id="x" template={ kit.hero } literal="{foo}" escape="&amp;lt; &#65; &apos;"> A &lt; B<!-- discarded -->\n  <text:Set text={hero-prompt}/></text:Render>\n</dvml><!-- after -->`;
  const document = parseMarkup("film.dvml", text, options);
  assert.deepEqual(document.imports.map(({ from, source, as }) => ({ from, source, as })), [
    { from: "dsivio-video/text@1", source: undefined, as: "text" },
    { from: undefined, source: "./kit.dvs", as: "kit" },
  ]);
  const element = document.body[0]!;
  assert.equal(element.kind, "element");
  if (element.kind !== "element") return;
  const [id, reference, literal, escape] = element.attributes;
  assert.equal(id?.value.kind, "literal");
  assert.equal(reference?.value.kind, "ref");
  if (reference?.value.kind === "ref") assert.equal(reference.value.name, "kit.hero");
  if (literal?.value.kind === "literal") assert.equal(literal.value.text, "{foo}");
  if (escape?.value.kind === "literal") assert.equal(escape.value.text, "&lt; &#65; '");
  assert.deepEqual(element.children.map((node) => node.kind === "text" ? node.text : node.tag), [" A < B", "\n  ", "text:Set"]);
  assert.equal(element.span.start, text.indexOf("<text:Render"));
  assert.equal(element.span.end, text.indexOf("</text:Render>") + "</text:Render>".length);
  assert.equal(element.span.line, 5);
  assert.equal(element.span.column, 3);
});

test("raw bodies stay byte-exact with original offsets and resolved imports", () => {
  const body = '\r\n<主持人>😀 &amp; {x}<!-- literal -->\\n\r\n<raw-other/>\n';
  const text = `\uFEFF${header}<dvml><import from="raw-module" as="r"/><r:Script id="story">${body}</r:Script ></dvml>`;
  const document = parseMarkup("raw.dvml", text, { isRaw: (tag, imports) => tag === "r:Script" && imports.some((item) => item.as === "r") });
  const raw = document.body[0]!;
  assert.equal(raw.kind, "raw");
  if (raw.kind !== "raw") return;
  assert.equal(raw.body, body);
  assert.deepEqual(Buffer.from(raw.body), Buffer.from(body));
  assert.equal(raw.bodyStart, text.indexOf(body));
  assert.equal(text.slice(raw.bodyStart, raw.bodyStart + raw.body.length), body);
});

test("run roots retain attributes without coupling the root to using", () => {
  const document = parseMarkup("film.dvrun", `${header}<dvrun version="1"><author source="./main.dvml"/><target output="shot.video"/></dvrun>`, options);
  assert.equal(document.root, "dvrun");
  const version = document.rootAttributes[0]!.value;
  assert.equal(version.kind, "literal");
  if (version.kind === "literal") assert.equal(version.text, "1");
  assert.deepEqual(document.body.map((element) => element.tag), ["author", "target"]);
});

const failures = [
  { body: "<wrong></wrong>", code: "MARKUP_ROOT", line: 2, column: 1 },
  { body: '<dvml version="1"></dvml>', code: "MARKUP_ROOT_ATTRIBUTE", line: 2, column: 7 },
  { body: "<dvml></wrong>", code: "MARKUP_ROOT_CLOSE", line: 2, column: 7 },
  { body: "<dvml>", code: "MARKUP_ROOT_UNCLOSED", line: 2, column: 1 },
  { body: "<dvml></dvml>\nextra", code: "MARKUP_TRAILING", line: 3, column: 1 },
  { body: "<dvml><1/></dvml>", code: "MARKUP_NAME", line: 2, column: 8 },
  { body: "<dvml><x", code: "MARKUP_OPEN", line: 2, column: 7 },
  { body: "<dvml><x></x extra></dvml>", code: "MARKUP_CLOSE", line: 2, column: 10 },
  { body: "<dvml><x></y></dvml>", code: "MARKUP_CLOSE_MISMATCH", line: 2, column: 10 },
  { body: "<dvml><x>", code: "MARKUP_ELEMENT_UNCLOSED", line: 2, column: 7 },
  { body: "<dvml>\n<!--", code: "MARKUP_COMMENT", line: 3, column: 1 },
  { body: "<dvml><x a=bare/></dvml>", code: "MARKUP_ATTRIBUTE", line: 2, column: 12 },
  { body: '<dvml><x a="1" a="2"/></dvml>', code: "MARKUP_ATTRIBUTE_DUPLICATE", line: 2, column: 16 },
  { body: "<dvml><x a={x + y}/></dvml>", code: "MARKUP_REFERENCE", line: 2, column: 12 },
  { body: '<dvml><import from="x"></import></dvml>', code: "MARKUP_IMPORT", line: 2, column: 7 },
  { body: '<dvml><import from="x" source="y"/></dvml>', code: "MARKUP_IMPORT_KIND", line: 2, column: 7 },
  { body: '<dvml><import source="./y"/></dvml>', code: "MARKUP_IMPORT_SOURCE_ALIAS", line: 2, column: 7 },
  { body: '<dvml><import from="x" as="Upper"/></dvml>', code: "MARKUP_IMPORT_ALIAS", line: 2, column: 7 },
  { body: '<dvml><x/>\n<import from="x"/></dvml>', code: "MARKUP_IMPORT_AFTER_BODY", line: 3, column: 1 },
  { body: '<dvml><import from="x" as="x"/>\n<import source="./y" as="x"/></dvml>', code: "MARKUP_ALIAS_DUPLICATE", line: 3, column: 1 },
  { body: "<dvml>\n  prose</dvml>", code: "MARKUP_BODY_TEXT", line: 3, column: 3 },
  { body: "<dvml>\n<raw/></dvml>", code: "MARKUP_RAW_SELF_CLOSING", line: 3, column: 1 },
];
for (const failure of failures) {
  test(failure.code, () => {
    assert.throws(() => parseMarkup("film.dvml", header + failure.body, options), (error: unknown) => {
      assert.ok(error instanceof DvError);
      assert.equal(error.code, failure.code);
      assert.equal(error.span?.line, failure.line);
      assert.equal(error.span?.column, failure.column);
      return true;
    });
  });
}

test("import references and unexpected attributes are rejected at their location", () => {
  for (const body of ['<dvml><import from={x}/></dvml>', '<dvml><import from="x" id="x"/></dvml>']) {
    assert.throws(() => parseMarkup("film.dvml", header + body, options), (error: unknown) => error instanceof DvError && error.code === "MARKUP_IMPORT" && error.span?.line === 2);
  }
});
