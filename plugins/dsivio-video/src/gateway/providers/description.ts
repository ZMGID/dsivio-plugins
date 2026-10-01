import type { Json } from "../../core/value.ts";
import { withFactsRevision } from "../description.ts";
import type { ModelDescription, ArgumentDescription, Constraint } from "../description.ts";
import type { StandaloneKind, ProviderConnection } from "./types.ts";

export function providerDescription(identity: string, kind: StandaloneKind, version: string, connection: ProviderConnection, adapter: string, argumentsMap: Record<string, Json>, constraints: Json[], mimeTypes: string[], asynchronous = false): ModelDescription {
  // These maps are constructed exclusively by the static provider routes, then verified by the shared validator.
  const argumentsSpec = argumentsMap as unknown as Record<string, ArgumentDescription>;
  const rules = constraints as unknown as Constraint[];
  return withFactsRevision({ descriptionVersion: 1, identity, operation: kind, factsComplete: false, unknownFacts: ["billing", kind === "speech" ? "text.lengthUnit" : "prompt.lengthUnit"], adapterVersion: version, connectionIdentity: { id: identity.split("/")[0]!, adapter, baseUrl: connection.baseUrl }, arguments: argumentsSpec, constraints: rules, products: { mediaKind: kind === "speech" ? "audio" : kind, ordered: true, countMeaning: kind === "image" ? "maximum" : "exact", minCount: 1, maxCount: kind === "image" && adapter === "minimax" ? 9 : 1, mimeTypes, hasAlpha: false }, lifecycle: { submission: asynchronous ? "asynchronous" : "synchronous", remoteCancel: "unsupported" }, billingInfo: null });
}
export function scalar(dataType: string, optionKey: string, extra: Record<string, Json> = {}): Json { return { dataType, required: false, ...(dataType === "string" && (extra.minLength !== undefined || extra.maxLength !== undefined) ? { lengthUnit: "unicodeCodePoint" } : {}), ...extra, transport: { optionKey, encoding: "options-json" } }; }
export function mediaArgument(optionKey: string, maxCount: number, mimePatterns: string[], maxBytes?: number): Json { return { dataType: "mediaList", required: false, minCount: 0, maxCount, mimePatterns, locations: ["local"], ...(maxBytes ? { maxBytes } : {}), transport: { optionKey, encoding: "options-json" } }; }
export function wireObject(value: unknown): Record<string, Json> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider object"); return value as Record<string, Json>; }
export function mediaEntries(value: Json | undefined): Record<string, Json>[] { if (value === undefined) return []; if (!Array.isArray(value)) throw new Error("Expected media list"); return value.map(wireObject); }
