// Syntax trees produced by src/markup. Parsing knows nothing about modules or graphs.

import type { SourceSpan } from "../core/errors.ts";
import type { Json } from "../core/value.ts";

export type AttrValue =
  /** `"text"` or `'text'`: always a string; the surface decides how to convert it. */
  | { kind: "literal"; text: string; span: SourceSpan }
  /** `{name}`: the whole value is a reference to a public name (dots are part of the name). */
  | { kind: "ref"; name: string; span: SourceSpan };

export interface Attribute {
  name: string;
  value: AttrValue;
  span: SourceSpan;
}

export interface ElementNode {
  kind: "element";
  /** Tag as written, including a prefix, e.g. `gen:Video`. */
  tag: string;
  attributes: Attribute[];
  children: MarkupNode[];
  selfClosing: boolean;
  span: SourceSpan;
}

export interface TextNode {
  kind: "text";
  /** Entities already decoded. Whitespace kept; surfaces decide trimming. */
  text: string;
  span: SourceSpan;
}

/** A surface that parses its own body (e.g. `<script>`). The body is everything up to the matching close tag. */
export interface RawElement {
  kind: "raw";
  tag: string;
  attributes: Attribute[];
  body: string;
  /** Offset of `body` in the file, so the owner can report precise spans. */
  bodyStart: number;
  /** Line/column of `bodyStart`; add the newlines inside `body` to locate any later offset. */
  bodySpan: SourceSpan;
  span: SourceSpan;
}

export type MarkupNode = ElementNode | TextNode | RawElement;

export interface ImportDecl {
  /** `from="dsivio-video/text@1"`: a module. */
  from?: string;
  /** `source="./look.dvs"`: another source file. */
  source?: string;
  as?: string;
  span: SourceSpan;
}

/** A parsed markup file (`.dvml` or `.dvrun`). */
export interface MarkupDocument {
  file: string;
  /** Value of the header `using`, e.g. `dsivio-video/markup@1`. */
  using: string;
  /** Root element name (`dvml` / `dvrun`) and its attributes. */
  root: string;
  rootAttributes: Attribute[];
  imports: ImportDecl[];
  /** Top-level elements after the imports; comments dropped, whitespace-only text dropped. */
  body: (ElementNode | RawElement)[];
}

/** A parsed `.dvs` sheet: flat named rules with scalar/JSON properties. */
export interface DvsSheet {
  file: string;
  using: string;
  id?: string;
  rules: DvsRule[];
}

export interface DvsRule {
  /** Full dotted name, e.g. `media.performance`. Dots do not imply nesting. */
  name: string;
  properties: { name: string; value: Json; span: SourceSpan }[];
  span: SourceSpan;
}
