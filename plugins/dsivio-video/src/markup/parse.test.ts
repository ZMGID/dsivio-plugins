import assert from "node:assert/strict";
import test from "node:test";
import { DvError } from "../core/errors.ts";
import { parseMarkup, serializeAttributeReference, serializeAttributeValue } from "./parse.ts";

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

test("UTF-16 tag and attribute spans retain quotes, entities, and raw references", () => {
  const opening = '<x title = \'中文😀 &amp; &apos;\' other="&quot;" ref={ kit.hero } >';
  const text = `${header}<dvml><!-- 😀中文 -->${opening}<child />正文😀</x ></dvml>`;
  const document = parseMarkup("utf16.dvml", text, options);
  const element = document.body[0]!;
  const slice = (span: { start: number; end: number } | undefined) => {
    assert.ok(span);
    return text.slice(span.start, span.end);
  };
  assert.equal(document.source, text);
  assert.equal(slice(document.openingTag), "<dvml>");
  assert.equal(slice(document.closingTag), "</dvml>");
  assert.equal(slice(element.openingTag), opening);
  assert.equal(element.openingTag?.start, text.indexOf(opening));
  assert.equal(slice(element.closingTag), "</x >");
  assert.equal(element.insertion?.start, text.indexOf(" >", text.indexOf(opening)) + 1);
  assert.equal(slice(element.insertion), "");
  const [title, other, reference] = element.attributes;
  assert.ok(title && other && reference);
  assert.equal(slice(title.nameSpan), "title");
  assert.equal(slice(title.valueSpan), "'中文😀 &amp; &apos;'");
  assert.equal(slice(title.value.innerSpan), "中文😀 &amp; &apos;");
  assert.equal(slice(title.fullSpan), "title = '中文😀 &amp; &apos;'");
  assert.equal(title.raw, slice(title.fullSpan));
  assert.equal(title.value.raw, slice(title.valueSpan));
  assert.equal(title.value.quote, "'");
  assert.equal(title.value.kind === "literal" && title.value.text, "中文😀 & '");
  assert.equal(other.value.kind === "literal" && other.value.text, '"');
  assert.equal(reference.value.kind === "ref" && reference.value.name, "kit.hero");
  assert.equal(slice(reference.value.innerSpan), " kit.hero ");
  assert.equal(reference.value.raw, "{ kit.hero }");
  assert.equal(reference.value.quote, undefined);
  assert.equal(element.kind, "element");
  if (element.kind !== "element") return;
  const child = element.children[0]!;
  assert.equal(child.kind, "element");
  if (child.kind !== "element") return;
  assert.equal(slice(child.openingTag), "<child />");
  assert.equal(child.closingTag, undefined);
  assert.equal(child.insertion?.start, text.indexOf("/>"));
});

test("raw body and tag ranges remain exact through UTF-16 attribute edits", () => {
  const body = "\r\n中文😀 <not-xml> &amp; {x}\r\n";
  const text = `${header}<dvml><raw title="old">${body}</raw ></dvml>`;
  const raw = parseMarkup("raw.dvml", text, options).body[0]!;
  assert.equal(raw.kind, "raw");
  if (raw.kind !== "raw") return;
  assert.equal(text.slice(raw.openingTag!.start, raw.openingTag!.end), '<raw title="old">');
  assert.equal(text.slice(raw.closingTag!.start, raw.closingTag!.end), "</raw >");
  assert.equal(text.slice(raw.bodySpan.start, raw.bodySpan.end), body);
  const span = raw.attributes[0]!.valueSpan!;
  const edited = text.slice(0, span.start) + serializeAttributeValue('新😀 " & <') + text.slice(span.end);
  const result = parseMarkup("raw.dvml", edited, options).body[0]!;
  assert.equal(result.kind === "raw" && result.body, body);
  assert.equal(result.attributes[0]!.value.kind === "literal" && result.attributes[0]!.value.text, '新😀 " & <');
});

test("attribute scalar and reference serializers round-trip without double decoding", () => {
  for (const quote of ['"', "'"]) {
    for (const value of ['中文😀 <>& "\' &amp; {literal}\n', "", true, false, null, 0, -2.5]) {
      const document = parseMarkup("serialize.dvml", `${header}<dvml><x value=${serializeAttributeValue(value, quote)}/></dvml>`, options);
      const actual = document.body[0]!.attributes[0]!.value;
      assert.equal(actual.kind, "literal");
      assert.equal(actual.kind === "literal" && actual.text, String(value));
      assert.equal(actual.quote, quote);
    }
  }
  const document = parseMarkup("serialize.dvml", `${header}<dvml><x value=${serializeAttributeReference("kit.hero-video")}/></dvml>`, options);
  const reference = document.body[0]!.attributes[0]!.value;
  assert.equal(reference.kind === "ref" && reference.name, "kit.hero-video");
  assert.throws(() => serializeAttributeReference("kit.hero + 1"), (error: unknown) => error instanceof DvError && error.code === "MARKUP_REFERENCE");
  assert.throws(() => serializeAttributeValue({ nested: 1 }), (error: unknown) => error instanceof DvError && error.code === "MARKUP_ATTRIBUTE_SCALAR");
});
