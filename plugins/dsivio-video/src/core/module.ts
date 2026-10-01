// What a module contributes: types, markup surfaces, deterministic producers and .dvs frontends.
// Modules are trusted code shipped with dsivio-video and listed in src/modules/index.ts.

import type { SourceSpan } from "./errors.ts";
import type { Json, Pending, TypeRef, Value } from "./value.ts";
import type { DvsSheet, ElementNode, RawElement } from "../markup/ast.ts";

export interface ModuleDef {
  /** Import address, e.g. `dsivio-video/text@1`. Type refs of this module are `${id}#Name`. */
  id: string;
  summary: string;
  types: Record<string, TypeDef>;
  /** Keyed by unprefixed tag; the importer's alias adds the prefix (`gen:Video`). */
  surfaces: Record<string, SurfaceDef>;
  /** Keyed by local name; referenced from operations as `${id}#name`. */
  producers: Record<string, ProducerDef>;
  /** `.dvs` readers keyed by their header `using` address, e.g. `dsivio-video/text/dvs@1`. */
  frontends?: Record<string, FrontendDef>;
}

export interface TypeDef {
  summary: string;
  /** Throw DvError(`TYPE_INVALID`) when `data` is not a valid value of this type. Required: every type checks its data. */
  validate(data: Json): void;
}

// ---------- Surfaces (markup elements) ----------

export interface SurfaceDef {
  /** `raw`: the element body is handed over unparsed (like `<script>`). */
  mode: "structured" | "raw";
  doc: SurfaceDoc;
  elaborate(element: ElementNode | RawElement, ctx: ElaborationContext): void;
}

/** What `vocabulary` prints. Keep it truthful: it is the agent's reference. */
export interface SurfaceDoc {
  summary: string;
  attributes: AttributeDoc[];
  children?: { tag: string; summary: string; repeat: boolean }[];
  /** Public names this surface publishes, relative to its id (`""` means the id itself). */
  outputs: { name: string; type: TypeRef; summary: string }[];
  /** True when elaborating it creates a paid external request. */
  paid?: boolean;
  example?: string;
}

export interface AttributeDoc {
  name: string;
  required: boolean;
  /** `text`, `number`, `boolean`, `one of a|b|c`, or a TypeRef for `{reference}` values. */
  accepts: string;
  summary: string;
  default?: string;
}

/** Something a `{name}` reference or an operation input can point at. */
export type Binding =
  /** A value known at compile time. */
  | { kind: "record"; key: string; type: TypeRef; value: Value }
  /** A value an operation will produce. */
  | { kind: "output"; key: string; operation: string; port: string; type: TypeRef };

export interface OperationSpec {
  /** `${moduleId}#${producerName}`. */
  producer: string;
  /** Exactly the producer's ports; list ports take arrays. Types must match exactly. */
  inputs: Record<string, Binding | Binding[]>;
  /** Output port -> public name. Unlisted ports stay private. */
  publish: Record<string, string>;
  /** Author-facing label, normally the element id. */
  label: string;
  span: SourceSpan;
}

export interface ElaborationContext {
  readonly file: string;
  /** Resolve a public name visible in this source (local or imported). Throws MARKUP_REFERENCE. */
  lookup(name: string, span: SourceSpan): Binding;
  /** Add a static value. `publicName` null keeps it private. */
  record(publicName: string | null, value: Value, span: SourceSpan): Binding;
  /** Add one operation; returns a binding per output port. */
  operation(spec: OperationSpec): Record<string, Binding>;
  /** A project file referenced from source (`./a.png`), relative to this file, checked against the workspace. */
  asset(locator: string, type: TypeRef, mime: string | undefined, span: SourceSpan): Binding;
  /** Throw a DvError at `span`. */
  fail(code: string, message: string, span: SourceSpan): never;
  /**
   * Claim a public domain identity (e.g. a Script's story id) for the whole source closure.
   * Claiming the same kind+key from another element fails with DUPLICATE_SOURCE_IDENTITY, even across import aliases.
   */
  identity(kind: string, key: string, span: SourceSpan): void;
}

// ---------- Producers (deterministic steps) ----------

export interface PortDef {
  type: TypeRef;
  optional?: boolean;
  list?: boolean;
}

export type InputValue = Value | Pending;

/** Input values keyed by port: a list port gets an array; an absent optional port is undefined. */
export type ProducerInputs = Record<string, InputValue | InputValue[] | undefined>;

export interface ProducerDef {
  inputs: Record<string, PortDef>;
  outputs: Record<string, TypeRef>;
  /**
   * Pure: same inputs, same result; no IO, clock or randomness. Every output port is produced exactly once,
   * either directly in `outputs` or by an external request in `needs`.
   * At build time every input is a Value. At plan time, if `previewsPending` is set, inputs another step has
   * not produced yet arrive as Pending, and the request may carry them.
   */
  run(inputs: ProducerInputs): ProducerResult;
  previewsPending?: boolean;
}

export interface ProducerResult {
  outputs?: Record<string, Value>;
  needs?: Record<string, NeedRequest>;
}

/** A request for a capability (paid generation or heavy local work). JSON; may contain ResourceRef and Pending. */
export interface NeedRequest {
  capability: string;
  request: Json;
}

// ---------- .dvs frontends ----------

export interface FrontendDef {
  summary: string;
  compile(sheet: DvsSheet, ctx: FrontendContext): void;
}

export interface FrontendContext {
  /** Publish a static value under a public name (the importer adds its alias prefix). */
  record(publicName: string, value: Value, span: SourceSpan): void;
  fail(code: string, message: string, span: SourceSpan): never;
}
