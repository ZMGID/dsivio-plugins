import { DvError, spanAt } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
import type { DvsRule, DvsSheet } from "./ast.ts";
import { readHeader } from "./header.ts";

/** Complete DVS syntax; collections are strict JSON, scalar strings keep raw escapes. */
export function serializeDvsValue(value: Json): string {
  if (typeof value === "string") {
    for (const quote of ['"', "'"]) {
      let safe = true;
      for (let index = 0; index < value.length; index++) {
        if (value[index] === "\\") {
          if (++index === value.length) safe = false;
        } else if (value[index] === quote) safe = false;
      }
      if (safe) return quote + value + quote;
    }
    throw new DvError("DVS_VALUE_STRING", "This scalar string cannot be represented without changing its raw escapes.");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DvError("DVS_VALUE_NUMBER", "DVS numbers must be finite.");
    if (Object.is(value, -0)) return "-0";
    const text = String(value);
    if (!/[eE]/.test(text)) return text;
    // The existing scalar grammar has no exponent notation.
    const [mantissa, exponent] = text.split(/[eE]/);
    const negative = mantissa!.startsWith("-");
    const unsigned = negative ? mantissa!.slice(1) : mantissa!;
    const digits = unsigned.replace(".", "");
    const point = (unsigned.includes(".") ? unsigned.indexOf(".") : unsigned.length) + Number(exponent);
    const decimal = point <= 0 ? "0." + "0".repeat(-point) + digits
      : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : digits.slice(0, point) + "." + digits.slice(point);
    return (negative ? "-" : "") + decimal;
  }
  try {
    return JSON.stringify(value, (_key, child: unknown) => {
      if (typeof child === "number" && !Number.isFinite(child)) throw new DvError("DVS_VALUE_NUMBER", "DVS numbers must be finite.");
      return child;
    });
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("DVS_VALUE_STRUCTURED", "The value must be serializable JSON.", { cause: error });
  }
}

class SheetParser {
  readonly file: string;
  readonly text: string;
  cursor: number;

  constructor(file: string, text: string, cursor: number) {
    this.file = file;
    this.text = text;
    this.cursor = cursor;
  }

  fail(code: string, message: string, start = this.cursor, end = start): never {
    throw new DvError(code, message, { span: spanAt(this.file, this.text, start, end) });
  }

  trivia(): void {
    for (;;) {
      while (this.cursor < this.text.length && /\s/.test(this.text[this.cursor]!)) this.cursor++;
      if (!this.text.startsWith("/*", this.cursor)) return;
      const end = this.text.indexOf("*/", this.cursor + 2);
      if (end < 0) this.fail("DVS_COMMENT_UNCLOSED", "The comment is not closed.", this.cursor, this.text.length);
      this.cursor = end + 2;
    }
  }

  value(): { value: Json; start: number; end: number; separatorStart: number } {
    const start = this.cursor;
    let valueEnd = start;
    let raw = "";
    let quote = "";
    let depth = 0;
    while (this.cursor < this.text.length) {
      const character = this.text[this.cursor]!;
      if (quote) {
        raw += character;
        this.cursor++;
        if (character === "\\" && this.cursor < this.text.length) {
          raw += this.text[this.cursor]!;
          this.cursor++;
        } else if (character === quote) quote = "";
        valueEnd = this.cursor;
        continue;
      }
      if (this.text.startsWith("/*", this.cursor)) {
        const end = this.text.indexOf("*/", this.cursor + 2);
        if (end < 0) this.fail("DVS_COMMENT_UNCLOSED", "The comment is not closed.", this.cursor, this.text.length);
        // DVS comments are trivia, but comments inside a collection must fail strict JSON parsing.
        raw += depth === 0 ? " " : this.text.slice(this.cursor, end + 2);
        this.cursor = end + 2;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "[" || character === "{") depth++;
      else if (character === "]" || character === "}") {
        if (depth === 0) break;
        depth--;
      } else if (character === ";" && depth === 0) break;
      if (this.text.startsWith("</sheet", this.cursor)) break;
      raw += character;
      if (depth > 0 || !/\s/.test(character)) valueEnd = this.cursor + 1;
      this.cursor++;
    }
    raw = raw.trim();
    if (!raw) this.fail("DVS_VALUE_EMPTY", "A property value cannot be empty.", start, this.cursor);
    let value: Json;
    if (raw === "null") value = null;
    else if (raw === "true" || raw === "false") value = raw === "true";
    else if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) value = Number(raw);
    else if (raw.startsWith("[") || raw.startsWith("{")) {
      try {
        value = JSON.parse(raw) as Json;
      } catch (error) {
        throw new DvError("DVS_VALUE_STRUCTURED", "Arrays and objects must be strict JSON.", { span: spanAt(this.file, this.text, start, this.cursor), cause: error });
      }
    } else if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) value = raw.slice(1, -1);
    else value = raw;
    if (this.text[this.cursor] !== ";") this.fail("DVS_PROPERTY_SEMICOLON", "A property must end with a semicolon.");
    const separatorStart = this.cursor;
    this.cursor++;
    return { value, start, end: valueEnd, separatorStart };
  }
}

export function parseDvs(file: string, text: string): DvsSheet {
  const header = readHeader(file, text);
  const parser: SheetParser = new SheetParser(file, text, header.bodyStart);
  parser.trivia();
  const rootStart = parser.cursor;
  if (!text.startsWith("<sheet", parser.cursor) || !/[\s>]/.test(text[parser.cursor + 6] ?? "")) parser.fail("DVS_ROOT", "Expected a sheet root.");
  parser.cursor += 6;
  const attributes = new Map<string, string>();
  for (;;) {
    const beforeSpace = parser.cursor;
    while (parser.cursor < text.length && /\s/.test(text[parser.cursor]!)) parser.cursor++;
    if (text[parser.cursor] === ">") {
      parser.cursor++;
      break;
    }
    if (parser.cursor >= text.length || text.startsWith("/>", parser.cursor)) parser.fail("DVS_ROOT", "The sheet root must have a complete, non-self-closing opening tag.", rootStart);
    const start = parser.cursor;
    if (beforeSpace === parser.cursor) parser.fail("DVS_SHEET_ATTRIBUTE", "Sheet attributes must be separated by whitespace.");
    const name = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(parser.cursor));
    if (!name) parser.fail("DVS_SHEET_ATTRIBUTE", "Expected a sheet attribute.");
    parser.cursor += name[0].length;
    while (parser.cursor < text.length && /\s/.test(text[parser.cursor]!)) parser.cursor++;
    if (text[parser.cursor] !== "=") parser.fail("DVS_SHEET_ATTRIBUTE", "Expected = after the sheet attribute.");
    parser.cursor++;
    while (parser.cursor < text.length && /\s/.test(text[parser.cursor]!)) parser.cursor++;
    const quote = text[parser.cursor];
    if (quote !== '"' && quote !== "'") parser.fail("DVS_SHEET_ATTRIBUTE", "Sheet attributes must be quoted strings.");
    const end = text.indexOf(quote, parser.cursor + 1);
    if (end < 0) parser.fail("DVS_SHEET_ATTRIBUTE", "The sheet attribute string is not closed.");
    const value = text.slice(parser.cursor + 1, end);
    parser.cursor = end + 1;
    if (attributes.has(name[0])) parser.fail("DVS_SHEET_ATTRIBUTE_DUPLICATE", `Sheet attribute ${name[0]} is repeated.`, start);
    if (name[0] !== "version" && name[0] !== "id") parser.fail("DVS_SHEET_ATTRIBUTE", `Unknown sheet attribute ${name[0]}.`, start);
    attributes.set(name[0], value);
  }
  if (attributes.get("version") !== "1") parser.fail("DVS_VERSION", "The sheet version must be 1.", rootStart);
  const id = attributes.get("id");
  if (id !== undefined && !/^[a-z][a-z0-9_-]{0,63}$/.test(id)) parser.fail("DVS_SHEET_ID", "The sheet id must be a lowercase identifier of at most 64 characters.", rootStart);
  const rules: DvsRule[] = [];
  const ruleNames = new Set<string>();
  for (;;) {
    parser.trivia();
    if (parser.cursor >= text.length) parser.fail("DVS_ROOT_UNCLOSED", "The sheet root is not closed.", rootStart, text.length);
    if (text.startsWith("</sheet", parser.cursor)) {
      const closing = /^<\/sheet\s*>/.exec(text.slice(parser.cursor));
      if (!closing) parser.fail("DVS_ROOT", "Expected </sheet>.");
      parser.cursor += closing[0].length;
      break;
    }
    const start = parser.cursor;
    const name = /^[^\s{};<>]+/.exec(text.slice(parser.cursor));
    if (!name || !/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(name[0])) parser.fail("DVS_RULE", "A rule name must contain lowercase dotted segments.");
    parser.cursor += name[0].length;
    const nameSpan = spanAt(file, text, start, parser.cursor);
    if (ruleNames.has(name[0])) parser.fail("DVS_RULE_DUPLICATE", `Rule ${name[0]} is repeated.`, start);
    ruleNames.add(name[0]);
    parser.trivia();
    if (text[parser.cursor] !== "{") parser.fail("DVS_RULE_OPEN", "Expected { after the rule name.");
    const bodyStart = parser.cursor;
    parser.cursor++;
    const properties: DvsRule["properties"] = [];
    const propertyNames = new Set<string>();
    let closingStart = parser.cursor;
    for (;;) {
      parser.trivia();
      if (text[parser.cursor] === "}") {
        closingStart = parser.cursor;
        parser.cursor++;
        break;
      }
      if (parser.cursor >= text.length || text.startsWith("</sheet", parser.cursor)) parser.fail("DVS_RULE_UNCLOSED", `Rule ${name[0]} is not closed.`, start, parser.cursor);
      const propertyStart = parser.cursor;
      const property = /^[^\s:;{}<>]+/.exec(text.slice(parser.cursor));
      if (!property || !/^[a-z][a-z0-9-]*$/.test(property[0])) parser.fail("DVS_PROPERTY", "Expected a lowercase property name.");
      parser.cursor += property[0].length;
      if (propertyNames.has(property[0])) parser.fail("DVS_PROPERTY_DUPLICATE", `Property ${property[0]} is repeated.`, propertyStart);
      propertyNames.add(property[0]);
      parser.trivia();
      if (text[parser.cursor] !== ":") parser.fail("DVS_PROPERTY_COLON", "Expected : after the property name.");
      parser.cursor++;
      parser.trivia();
      const parsed = parser.value();
      const span = spanAt(file, text, propertyStart, parser.cursor);
      properties.push({
        name: property[0], value: parsed.value, span,
        nameSpan: spanAt(file, text, propertyStart, propertyStart + property[0].length),
        valueSpan: spanAt(file, text, parsed.start, parsed.end),
        fullSpan: span, deleteSpan: span,
        separatorSpan: spanAt(file, text, parsed.separatorStart, parser.cursor),
        raw: text.slice(propertyStart, parser.cursor),
        valueRaw: text.slice(parsed.start, parsed.end),
      });
    }
    rules.push({
      name: name[0], properties, span: spanAt(file, text, start, parser.cursor), nameSpan,
      bodySpan: spanAt(file, text, bodyStart, parser.cursor),
      openingBrace: spanAt(file, text, bodyStart, bodyStart + 1),
      closingBrace: spanAt(file, text, closingStart, parser.cursor),
      insertion: spanAt(file, text, closingStart, closingStart),
    });
  }
  parser.trivia();
  if (parser.cursor !== text.length) parser.fail("DVS_TRAILING", "Only whitespace and comments may follow the sheet.");
  return { file, source: text, using: header.using, ...(id === undefined ? {} : { id }), rules };
}
