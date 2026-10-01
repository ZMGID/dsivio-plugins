// Values that flow through the graph. Everything a Build stores is a typed Value.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Nominal type address, `<module>@<version>#<name>`, e.g. `dsivio-video/media@1#Video`. Compared by exact string. */
export type TypeRef = string;

export function typeRef(module: string, name: string): TypeRef {
  return `${module}#${name}`;
}

/**
 * Bytes held by a resource store. It sits inside Value data as a plain object with a `$resource` key,
 * so a Value is always JSON. The id is an opaque instance identity, never a content hash.
 */
export interface ResourceRef {
  $resource: string;
  bytes: number;
  mime: string;
}

/** A typed value. `data` may contain ResourceRefs at any depth. */
export interface Value {
  type: TypeRef;
  data: Json;
}

/** Stands in for an input that a not-yet-run step will produce; only seen at plan time. */
export interface Pending {
  $pending: string;
  type: TypeRef;
}

export function isResourceRef(data: unknown): data is ResourceRef {
  return typeof data === "object" && data !== null && !Array.isArray(data) && "$resource" in data && typeof data.$resource === "string";
}

export function isPending(data: unknown): data is Pending {
  return typeof data === "object" && data !== null && !Array.isArray(data) && "$pending" in data && typeof data.$pending === "string";
}

/** `scalar`: no resources; `resource`: the data is exactly one ResourceRef; `composite`: resources inside other data. */
export type ValueClass = "scalar" | "resource" | "composite";

export function valueClass(value: Value): ValueClass {
  if (isResourceRef(value.data)) return "resource";
  return resourcesIn(value.data).length > 0 ? "composite" : "scalar";
}

/** Every ResourceRef inside `data`, with its path of object keys and array indexes. */
export function resourcesIn(data: Json): { path: (string | number)[]; ref: ResourceRef }[] {
  const found: { path: (string | number)[]; ref: ResourceRef }[] = [];
  const walk = (node: Json, path: (string | number)[]): void => {
    if (isResourceRef(node)) {
      found.push({ path, ref: node });
      return;
    }
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, [...path, index]));
    else if (node !== null && typeof node === "object") for (const key of Object.keys(node)) walk(node[key]!, [...path, key]);
  };
  walk(data, []);
  return found;
}

/** Deterministic JSON: sorted object keys, -0 written as 0. Throws on values JSON cannot carry. */
export function canonicalJson(data: Json): string {
  const encode = (node: Json): string => {
    if (node === null || typeof node === "boolean") return JSON.stringify(node);
    if (typeof node === "string") {
      if (!node.isWellFormed()) throw new TypeError("Lone Unicode surrogate is not valid JCS JSON");
      return JSON.stringify(node);
    }
    if (typeof node === "number") {
      if (!Number.isFinite(node)) throw new TypeError(`non-finite number in value: ${node}`);
      return JSON.stringify(Object.is(node, -0) ? 0 : node);
    }
    if (Array.isArray(node)) return `[${node.map(encode).join(",")}]`;
    const keys = Object.keys(node).sort();
    return `{${keys.map((key) => `${encode(key)}:${encode(node[key]!)}`).join(",")}}`;
  };
  return encode(data);
}
