// Capabilities fulfil NeedRequests: paid generation through the media gateway, or heavy local work.
// The worker is the only caller of `execute`; `plan` and `build` call `resolve` before anything is spent.

import type { Json, ResourceRef, TypeRef, Value } from "./value.ts";

export interface ResolveContext {
  /** Project root (absolute). */
  projectRoot: string;
  signal?: AbortSignal;
}

export type Resolution =
  | {
      ok: true;
      /** The exact request that will be sent (model explicit, defaults applied). Pending inputs stay Pending. */
      request: Json;
      /** Which backend serves it, e.g. `dsivio`. Recorded in the Build. */
      backend: string;
      /** Human summary shown by `plan`: model, key parameters, pending inputs. */
      summary: Record<string, Json>;
      cost: "paid" | "local";
    }
  | { ok: false; code: string; reason: string };

export interface ResourceStore {
  /** Take ownership of a file's bytes as a new resource (copied, or moved when `move`). */
  putFile(path: string, mime: string, options?: { move?: boolean }): Promise<ResourceRef>;
  /** Absolute path of a resource's bytes (read-only). */
  pathOf(ref: ResourceRef): string;
}

export interface ExecuteContext {
  buildId: string;
  commandKey: string;
  /** Stable for this command across retries and worker restarts; pass to paid backends. */
  idempotencyKey: string;
  projectRoot: string;
  store: ResourceStore;
  /** Private scratch directory for this command. */
  workDir: string;
  signal: AbortSignal;
  log(message: string): void;
}

export type PollResult =
  | { state: "pending"; retryAfterMs: number; progress?: string }
  | { state: "done"; value: Value }
  | { state: "failed"; code: string; message: string; charged: "no" | "maybe" };

export interface ImmediateExecutor {
  kind: "immediate";
  run(request: Json, ctx: ExecuteContext): Promise<Value>;
}

export interface AsyncExecutor {
  kind: "async";
  /** Submit once. `handle` must let `poll` find the same remote task after a worker restart. */
  submit(request: Json, ctx: ExecuteContext): Promise<{ handle: Json; receipt?: string }>;
  /** Query only; never resubmits. On success it stores outputs in ctx.store and returns the typed value. */
  poll(handle: Json, ctx: ExecuteContext): Promise<PollResult>;
  cancel?(handle: Json, ctx: ExecuteContext): Promise<"confirmed" | "requested" | "unsupported" | "too-late">;
}

export interface CapabilityDef {
  /** e.g. `gateway/video`. */
  name: string;
  returns: TypeRef;
  resolve(request: Json, ctx: ResolveContext): Promise<Resolution>;
  executor: ImmediateExecutor | AsyncExecutor;
}
