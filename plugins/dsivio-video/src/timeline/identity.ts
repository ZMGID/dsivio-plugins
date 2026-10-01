import { createHash } from "node:crypto";
import { canonicalJson } from "../core/value.ts";
import type { Json } from "../core/value.ts";

/** Domain-separated stable identities; never depends on resources, time or randomness. */
export function stableIdentity(kind: string, data: Json): string {
  return `${kind}:${createHash("sha256").update(kind).update("\0").update(canonicalJson(data)).digest("hex")}`;
}

export function entityIdentity(file: string, id: string, index?: number): string {
  return stableIdentity("entity", index === undefined ? { file, id } : { file, id, index });
}

export function tokenAnchorKey(tokenKey: string, edge: "start" | "end"): string {
  return `${tokenKey}:anchor:${edge}`;
}
