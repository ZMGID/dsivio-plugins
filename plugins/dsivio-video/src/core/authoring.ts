import type { SourceSpan } from "./errors.ts";
import type { Binding } from "./module.ts";
import type { Json } from "./value.ts";
import type { Attribute, ElementNode, RawElement } from "../markup/ast.ts";

/** Compiler metadata only: never persisted into domain Values. */
export interface AuthoringUnit {
  unit: string;
  file: string;
  fileName: string;
  language: "dvml" | "dvs" | "dvrun";
  sourceVersion: string;
  text: string;
}
export interface AuthoringAttribute {
  name: string;
  attribute: Attribute;
  nameSpan: SourceSpan;
  valueSpan: SourceSpan;
  fullSpan: SourceSpan;
  expectedText: string;
}
export interface AuthoringElement {
  authorKey: string;
  sourceUnit: string;
  moduleId: string;
  surface: string;
  declarationPath: string;
  elementSpan: SourceSpan;
  openingTag: SourceSpan;
  closingTag?: SourceSpan;
  insertion: SourceSpan;
  attributes: readonly AuthoringAttribute[];
  rawBody?: SourceSpan;
  contentBody?: SourceSpan;
  pureText?: boolean;
  recipe?: { name: string; properties: readonly AuthoringProperty[] };
}
export interface AuthoringProperty {
  name: string;
  value: Json;
  nameSpan: SourceSpan;
  valueSpan: SourceSpan;
  fullSpan: SourceSpan;
  deleteSpan: SourceSpan;
}
/** Explicit semantic attribution; binding is the actual returned record/output. */
export interface AuthoringRegistration {
  binding: Binding;
  element: ElementNode | RawElement;
  role: "output" | "input" | "plan" | "parameter" | "instant" | "window" | "script";
  /** Public domain identity, e.g. consumerKey; never infer from a random record key. */
  identity?: string;
  /** The consuming operation binding and exact producer port/list position. */
  consumer?: { operation: string; port: string; index?: number };
  /** Optional author property/reference responsible for this relation. */
  attribute?: string;
}
export interface AuthoringRelation {
  bindingKey: string;
  authorKey: string;
  role: AuthoringRegistration["role"];
  surfaceOutput?: string;
  identity?: string;
  consumer?: AuthoringRegistration["consumer"];
  attribute?: string;
}
export interface AuthoringIndex {
  units: ReadonlyMap<string, AuthoringUnit>;
  elements: ReadonlyMap<string, AuthoringElement>;
  relations: readonly AuthoringRelation[];
  references: readonly { authorKey: string; attribute: string; bindingKey: string }[];
  /** Actual compiler input edges, including list positions and anonymous records. */
  inputs: readonly { operation: string; port: string; index?: number; bindingKey: string; authorKey?: string }[];
}
