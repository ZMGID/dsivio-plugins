import { DvError, spanAt } from "../core/errors.ts";
import type { SourceSpan } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
import type { Attribute, ElementNode, ImportDecl, MarkupDocument, MarkupNode, RawElement } from "./ast.ts";
import { readHeader } from "./header.ts";

export interface MarkupOptions {
  isRaw(tag: string, imports: readonly ImportDecl[]): boolean;
}

const namePattern = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const entities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => entities[name]!);
}

/** Serialize a complete scalar attribute value, escaping only markup entities. */
export function serializeAttributeValue(value: Json, quote: string = '"'): string {
  if (quote !== '"' && quote !== "'") throw new DvError("MARKUP_ATTRIBUTE_QUOTE", "An attribute quote must be a single or double quote.");
  if (value !== null && typeof value === "object") throw new DvError("MARKUP_ATTRIBUTE_SCALAR", "Attribute values must be scalar.");
  if (typeof value === "number" && !Number.isFinite(value)) throw new DvError("MARKUP_ATTRIBUTE_SCALAR", "Attribute numbers must be finite.");
  const text = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quote + text.replace(quote === '"' ? /"/g : /'/g, quote === '"' ? "&quot;" : "&apos;") + quote;
}

export function serializeAttributeReference(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw new DvError("MARKUP_REFERENCE", "A reference must contain one binding name.");
  return `{${name}}`;
}

class Parser {
  readonly file: string;
  readonly text: string;
  readonly options: MarkupOptions;
  readonly imports: ImportDecl[] = [];
  cursor: number;

  constructor(file: string, text: string, cursor: number, options: MarkupOptions) {
    this.file = file;
    this.text = text;
    this.cursor = cursor;
    this.options = options;
  }

  fail(code: string, message: string, start = this.cursor, end = start): never {
    throw new DvError(code, message, { span: spanAt(this.file, this.text, start, end) });
  }

  whitespace(): void {
    while (/\s/.test(this.text[this.cursor] ?? "") && this.cursor < this.text.length) this.cursor++;
  }

  comment(): void {
    const start = this.cursor;
    const end = this.text.indexOf("-->", start + 4);
    if (end < 0) this.fail("MARKUP_COMMENT", "The comment is not closed.", start, this.text.length);
    this.cursor = end + 3;
  }

  trivia(): void {
    this.whitespace();
    while (this.text.startsWith("<!--", this.cursor)) {
      this.comment();
      this.whitespace();
    }
  }

  name(): string {
    const match = namePattern.exec(this.text.slice(this.cursor));
    if (!match) this.fail("MARKUP_NAME", "Expected an element or attribute name.");
    this.cursor += match[0].length;
    return match[0];
  }

  open(root = false): { tag: string; attributes: Attribute[]; selfClosing: boolean; start: number; openingTag: SourceSpan; insertion: SourceSpan } {
    const start = this.cursor;
    if (this.text[this.cursor] !== "<" || this.text.startsWith("</", this.cursor)) {
      this.fail(root ? "MARKUP_ROOT" : "MARKUP_OPEN", "Expected an opening element.");
    }
    this.cursor++;
    const tag = this.name();
    const attributes: Attribute[] = [];
    const names = new Set<string>();
    for (;;) {
      const beforeSpace = this.cursor;
      this.whitespace();
      if (this.text.startsWith("/>", this.cursor)) {
        const insertion = spanAt(this.file, this.text, this.cursor, this.cursor);
        this.cursor += 2;
        return { tag, attributes, selfClosing: true, start, openingTag: spanAt(this.file, this.text, start, this.cursor), insertion };
      }
      if (this.text[this.cursor] === ">") {
        const insertion = spanAt(this.file, this.text, this.cursor, this.cursor);
        this.cursor++;
        return { tag, attributes, selfClosing: false, start, openingTag: spanAt(this.file, this.text, start, this.cursor), insertion };
      }
      if (this.cursor >= this.text.length) this.fail("MARKUP_OPEN", "The opening element is not closed.", start, this.cursor);
      if (beforeSpace === this.cursor) this.fail("MARKUP_ATTRIBUTE", "Attributes must be separated by whitespace.");
      const attrStart = this.cursor;
      const name = this.name();
      const nameSpan = spanAt(this.file, this.text, attrStart, this.cursor);
      if (names.has(name)) this.fail("MARKUP_ATTRIBUTE_DUPLICATE", `Attribute ${name} is repeated.`, attrStart);
      names.add(name);
      this.whitespace();
      if (this.text[this.cursor] !== "=") this.fail("MARKUP_ATTRIBUTE", "Expected = after the attribute name.");
      this.cursor++;
      this.whitespace();
      const valueStart = this.cursor;
      const quote = this.text[this.cursor];
      let value: Attribute["value"];
      if (quote === '"' || quote === "'") {
        this.cursor++;
        const end = this.text.indexOf(quote, this.cursor);
        if (end < 0) this.fail("MARKUP_ATTRIBUTE", "The attribute string is not closed.", valueStart);
        const text = decode(this.text.slice(this.cursor, end));
        this.cursor = end + 1;
        value = { kind: "literal", text, span: spanAt(this.file, this.text, valueStart, this.cursor), innerSpan: spanAt(this.file, this.text, valueStart + 1, end), quote, raw: this.text.slice(valueStart, this.cursor) };
      } else if (quote === "{") {
        this.cursor++;
        const end = this.text.indexOf("}", this.cursor);
        if (end < 0) this.fail("MARKUP_REFERENCE", "The reference is not closed.", valueStart);
        const name = this.text.slice(this.cursor, end).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) this.fail("MARKUP_REFERENCE", "A reference must contain one binding name.", valueStart, end + 1);
        this.cursor = end + 1;
        value = { kind: "ref", name, span: spanAt(this.file, this.text, valueStart, this.cursor), innerSpan: spanAt(this.file, this.text, valueStart + 1, end), raw: this.text.slice(valueStart, this.cursor) };
      } else {
        this.fail("MARKUP_ATTRIBUTE", "Attribute values must be quoted strings or whole-value references.");
      }
      const span = spanAt(this.file, this.text, attrStart, this.cursor);
      attributes.push({ name, value, span, nameSpan, valueSpan: value.span, fullSpan: span, raw: this.text.slice(attrStart, this.cursor) });
    }
  }

  close(expected: string, root = false): SourceSpan {
    const start = this.cursor;
    this.cursor += 2;
    const tag = this.name();
    this.whitespace();
    if (this.text[this.cursor] !== ">") this.fail(root ? "MARKUP_ROOT_CLOSE" : "MARKUP_CLOSE", "Expected > after the closing name.", start);
    this.cursor++;
    if (tag !== expected) this.fail(root ? "MARKUP_ROOT_CLOSE" : "MARKUP_CLOSE_MISMATCH", `Expected </${expected}>, not </${tag}>.`, start, this.cursor);
    return spanAt(this.file, this.text, start, this.cursor);
  }

  element(): ElementNode | RawElement {
    const opening = this.open();
    if (this.options.isRaw(opening.tag, this.imports)) {
      if (opening.selfClosing) this.fail("MARKUP_RAW_SELF_CLOSING", "Raw elements cannot be self-closing.", opening.start, this.cursor);
      const bodyStart = this.cursor;
      const closing = new RegExp(`</${opening.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>`, "g");
      closing.lastIndex = this.cursor;
      const match = closing.exec(this.text);
      if (!match) this.fail("MARKUP_ELEMENT_UNCLOSED", `Element ${opening.tag} is not closed.`, opening.start, this.text.length);
      const body = this.text.slice(bodyStart, match.index);
      this.cursor = match.index;
      const closingTag = this.close(opening.tag);
      return { kind: "raw", tag: opening.tag, attributes: opening.attributes, body, bodyStart, bodySpan: spanAt(this.file, this.text, bodyStart, match.index), span: spanAt(this.file, this.text, opening.start, this.cursor), openingTag: opening.openingTag, closingTag, insertion: opening.insertion };
    }
    const children: MarkupNode[] = [];
    let closingTag: SourceSpan | undefined;
    if (!opening.selfClosing) {
      for (;;) {
        if (this.cursor >= this.text.length) this.fail("MARKUP_ELEMENT_UNCLOSED", `Element ${opening.tag} is not closed.`, opening.start, this.cursor);
        if (this.text.startsWith("</", this.cursor)) {
          closingTag = this.close(opening.tag);
          break;
        }
        if (this.text.startsWith("<!--", this.cursor)) this.comment();
        else if (this.text[this.cursor] === "<") children.push(this.element());
        else {
          const start = this.cursor;
          const next = this.text.indexOf("<", start);
          this.cursor = next < 0 ? this.text.length : next;
          children.push({ kind: "text", text: decode(this.text.slice(start, this.cursor)), span: spanAt(this.file, this.text, start, this.cursor) });
        }
      }
    }
    return { kind: "element", tag: opening.tag, attributes: opening.attributes, children, selfClosing: opening.selfClosing, span: spanAt(this.file, this.text, opening.start, this.cursor), openingTag: opening.openingTag, ...(closingTag === undefined ? {} : { closingTag }), insertion: opening.insertion };
  }

  import(element: ElementNode | RawElement): void {
    if (element.kind !== "element" || !element.selfClosing) this.fail("MARKUP_IMPORT", "Imports must be self-closing.", element.span.start);
    const declaration: ImportDecl = { span: element.span, attributes: element.attributes, ...(element.openingTag === undefined ? {} : { openingTag: element.openingTag }), ...(element.insertion === undefined ? {} : { insertion: element.insertion }) };
    for (const attribute of element.attributes) {
      if ((attribute.name !== "from" && attribute.name !== "source" && attribute.name !== "as") || attribute.value.kind !== "literal") {
        this.fail("MARKUP_IMPORT", "Imports accept only quoted from, source, and as attributes.", attribute.span.start);
      }
      declaration[attribute.name] = attribute.value.text;
    }
    if ((declaration.from === undefined) === (declaration.source === undefined) || declaration.from === "" || declaration.source === "") {
      this.fail("MARKUP_IMPORT_KIND", "An import needs exactly one nonempty from or source locator.", element.span.start);
    }
    if (declaration.source !== undefined && declaration.as === undefined) this.fail("MARKUP_IMPORT_SOURCE_ALIAS", "Source imports require an alias.", element.span.start);
    if (declaration.as !== undefined) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(declaration.as)) this.fail("MARKUP_IMPORT_ALIAS", "The import alias must be a lowercase identifier of at most 64 characters.", element.span.start);
      if (this.imports.some((previous) => previous.as === declaration.as)) this.fail("MARKUP_ALIAS_DUPLICATE", `Import alias ${declaration.as} is repeated.`, element.span.start);
    }
    this.imports.push(declaration);
  }
}

export function parseMarkup(file: string, text: string, options: MarkupOptions): MarkupDocument {
  const header = readHeader(file, text);
  const parser = new Parser(file, text, header.bodyStart, options);
  parser.trivia();
  const root = parser.open(true);
  if ((root.tag !== "dvml" && root.tag !== "dvrun") || root.selfClosing) parser.fail("MARKUP_ROOT", "The root must be a non-self-closing dvml or dvrun element.", root.start);
  if (root.tag === "dvml" && root.attributes.length > 0) parser.fail("MARKUP_ROOT_ATTRIBUTE", "The dvml root accepts no attributes.", root.attributes[0]!.span.start);
  const body: (ElementNode | RawElement)[] = [];
  let closingTag: SourceSpan | undefined;
  for (;;) {
    parser.trivia();
    if (parser.cursor >= text.length) parser.fail("MARKUP_ROOT_UNCLOSED", `Root ${root.tag} is not closed.`, root.start, text.length);
    if (text.startsWith("</", parser.cursor)) {
      closingTag = parser.close(root.tag, true);
      break;
    }
    if (text[parser.cursor] !== "<") parser.fail("MARKUP_BODY_TEXT", "The top-level body must contain elements, not text.");
    const element = parser.element();
    if (element.tag === "import") {
      if (body.length > 0) parser.fail("MARKUP_IMPORT_AFTER_BODY", "Imports must precede the body.", element.span.start);
      parser.import(element);
    } else body.push(element);
  }
  parser.trivia();
  if (parser.cursor !== text.length) parser.fail("MARKUP_TRAILING", "Only whitespace and comments may follow the root.");
  return { file, source: text, using: header.using, root: root.tag, rootAttributes: root.attributes, imports: parser.imports, body, openingTag: root.openingTag, ...(closingTag === undefined ? {} : { closingTag }), insertion: root.insertion };
}
