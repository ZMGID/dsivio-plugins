import { DvError } from "./errors.ts";
import type { SourceSpan } from "./errors.ts";
import type { TypeDef } from "./module.ts";
import { canonicalJson } from "./value.ts";
import type { Value } from "./value.ts";

export function validateValue(value: Value, typeDef: TypeDef | undefined, span: SourceSpan): void {
  if (!typeDef) throw new DvError("UNKNOWN_TYPE", `Unknown type ${value.type}`, { span });
  try {
    canonicalJson(value.data);
    typeDef.validate(value.data);
  } catch (cause) {
    throw new DvError("TYPE_REFINEMENT_REJECTED", `${value.type}: ${cause instanceof Error ? cause.message : String(cause)}`, { span, cause });
  }
}
