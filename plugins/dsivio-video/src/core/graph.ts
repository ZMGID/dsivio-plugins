// The three graphs of a Build: what the author wrote, what this run selects, and the fixed program to execute.

import type { SourceSpan } from "./errors.ts";
import type { NeedRequest } from "./module.ts";
import type { Json, ResourceRef, TypeRef, Value } from "./value.ts";

/** Where an operation input comes from. */
export type InputSource = { record: string } | { operation: string; port: string };

export interface AuthorOperation {
  /** Unique within the graph; stable for the same source text. */
  key: string;
  producer: string;
  label: string;
  inputs: Record<string, InputSource | InputSource[]>;
  outputs: Record<string, TypeRef>;
  span: SourceSpan;
}

export interface AuthorRecord {
  key: string;
  value: Value;
  span: SourceSpan;
}

/** A public, buildable name: an operation output. */
export interface LogicalOutput {
  name: string;
  type: TypeRef;
  operation: string;
  port: string;
}

/** A source file referenced as an asset; bytes are read when a Build is submitted. */
export interface SourceAsset {
  ref: ResourceRef;
  path: string;
}

export interface AuthorGraph {
  /** Entry source (absolute path). */
  source: string;
  /** Every source in the closure (absolute paths). */
  sources: string[];
  records: Map<string, AuthorRecord>;
  operations: Map<string, AuthorOperation>;
  outputs: Map<string, LogicalOutput>;
  /** Public static values (`{name}` resolvable, not buildable). */
  publicRecords: Map<string, string>;
  assets: Map<string, SourceAsset>;
  /** Module ids used. */
  modules: string[];
}

// ---------- Run ----------

export type CandidateDecl =
  | { kind: "file"; name: string; path: string; mime: string; type: TypeRef; span: SourceSpan }
  | { kind: "value"; name: string; path: string; type: TypeRef; span: SourceSpan }
  | { kind: "build"; name: string; build: string; output: string; span: SourceSpan };

export interface RunIntent {
  /** The `.dvrun` file (absolute). */
  file: string;
  /** Author source (absolute). */
  author: string;
  targets: string[];
  targetSpans: Map<string, SourceSpan>;
  candidates: Map<string, CandidateDecl>;
  /** Logical output name -> candidate name. */
  satisfy: Map<string, string>;
  satisfySpans: Map<string, SourceSpan>;
}

// ---------- Execution definition (immutable once submitted) ----------

export interface Step {
  key: string;
  producer: string;
  label: string;
  /** Port -> record key(s). */
  inputs: Record<string, string | string[]>;
  /** Output port -> record key where its value lands. */
  results: Record<string, string>;
  /** Output port -> exact type, so the machine can check facts without the module registry. */
  resultTypes: Record<string, TypeRef>;
}

export interface ExecutionDefinition {
  schema: "dsivio-video.definition/1";
  author: string;
  run: string;
  targets: string[];
  /** Values known before execution: authored records and selected file/value candidates. */
  seeds: Record<string, Value>;
  /** Targets satisfied whole by an earlier Build's output: no step, no bytes copied. */
  forwarded: Record<string, { build: string; output: string }>;
  /** Earlier Build outputs consumed by steps; resolved into seeds at submit. Kept for provenance. */
  reused: Record<string, { build: string; output: string }>;
  /** Sorted by key; order is not execution order. */
  steps: Step[];
  /** Every reachable public output -> record key holding its value. */
  outputs: Record<string, { record: string; type: TypeRef }>;
  modules: string[];
  gatewayBackend?: "dsivio" | "standalone";
  /** Planned gateway snapshots keyed by fulfil command. Pending values are replaced by real producer inputs, not replanned. */
  gatewaySnapshots?: Record<string, Json>;
}

// ---------- Build machine commands and facts ----------

export type Command =
  | { kind: "produce"; key: string; step: string }
  | { kind: "fulfil"; key: string; step: string; port: string; need: NeedRequest };

export type Fact =
  | { kind: "produced"; command: string; outputs: Record<string, Value>; needs: Record<string, NeedRequest> }
  | { kind: "fulfilled"; command: string; value: Value }
  | { kind: "failed"; command: string; code: string; message: string };

export type MachineState = "running" | "complete" | "failed";
