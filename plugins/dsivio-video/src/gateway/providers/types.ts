import type { Json } from "../../core/value.ts";
import type { ModelDescription } from "../description.ts";
import type { ProviderConfiguration } from "../standalone-config.ts";

export type StandaloneKind = "image" | "video" | "speech";
export interface ProviderRequest { kind: StandaloneKind; model: string; arguments: Record<string, Json> }
export type ProviderOutput = { mime: string; bytes: Buffer } | { mime: string; url: string };
export type ProviderOutcome =
  | { state: "accepted"; receipt: string; retryAfterMs?: number }
  | { state: "succeeded"; outputs: ProviderOutput[]; receipt?: string; usage?: Json }
  | { state: "failed" | "cancelled"; code: string; message: string };
export interface DurableHooks {
  taskId: string;
  /** Commit intent before the network side effect, commit receipt before proceeding. */
  stage(name: string, receipt?: Json): void;
  stages: Record<string, Json>;
}
export interface ProviderAdapter {
  readonly version: string;
  describe(identity: string, model: string, kind: StandaloneKind): ModelDescription;
  submit(request: ProviderRequest, hooks: DurableHooks): Promise<ProviderOutcome>;
  poll(receipt: string, request: ProviderRequest): Promise<ProviderOutcome>;
  cancel(receipt?: string): Promise<"unsupported" | "too-late">;
}
export class ProviderFailure extends Error {
  readonly disposition: "rejected" | "uncertain" | "query";
  readonly code: string;
  readonly retryAfterMs?: number;
  constructor(code: string, message: string, disposition: "rejected" | "uncertain" | "query", retryAfterMs?: number) { super(message); this.name = "ProviderFailure"; this.code = code; this.disposition = disposition; this.retryAfterMs = retryAfterMs; }
}
export type ProviderConnection = Pick<ProviderConfiguration, "baseUrl" | "apiKey">;
