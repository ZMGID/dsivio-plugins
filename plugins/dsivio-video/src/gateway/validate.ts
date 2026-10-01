import { createHash } from "node:crypto";
import { DvError } from "../core/errors.ts";
import { canonicalJson } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import type { GenerationRequest } from "./request.ts";
import { object } from "./request.ts";
import { ModelArgumentError, normalizeArguments, validateAndResolve } from "./description.ts";
import type { ModelDescription } from "./description.ts";
/** Standard authored aspectRatio binds to the native public --ratio slot when its descriptor says so. */
function argumentName(description: ModelDescription, name: string): string {
  if (Object.hasOwn(description.arguments, name) || name !== "aspectRatio") return name;
  const targets = Object.entries(description.arguments).filter(([, arg]) => arg.transport?.optionKey === "ratio" || arg.transport?.flag === "--ratio").map(([key]) => key);
  if (targets.length > 1) throw new DvError("MODEL_DESCRIPTION_INVALID", "Ambiguous public aspect-ratio transport");
  return targets[0] ?? name;
}
export function validateRequest(request: GenerationRequest, materialized = false): GenerationRequest {
  if (!object(request.capabilitySnapshot)) throw new DvError("MODEL_DESCRIPTION_UNAVAILABLE", "Host model description unavailable; upgrade the host before using model options");
  const description = request.capabilitySnapshot as unknown as ModelDescription;
  if (description.identity !== request.model) throw new DvError("MODEL_DESCRIPTION_CHANGED", "Model identity changed; replan before execution");
  const normalized = normalizeArguments(request.arguments, name => argumentName(description, name));
  const providedArguments = Object.keys(normalizeArguments(Object.fromEntries((request.providedArguments ?? Object.keys(request.arguments)).map(name => [name, true])), name => argumentName(description, name)));
  let args: Record<string, Json>;
  try { args = validateAndResolve(description, normalized, { materialized, providedArguments }); }
  catch (error) { if (description.legacyPublic === true && error instanceof ModelArgumentError && error.code === "MODEL_ARGUMENT_UNSUPPORTED") throw new DvError("MODEL_DESCRIPTION_UNAVAILABLE", "Host model description unavailable; only its existing public parameters are accepted"); throw error; }
  return { ...request, arguments: args, providedArguments, requestHash: `sha256:${createHash("sha256").update(canonicalJson({ model: request.model, backend: request.backend ?? null, arguments: args, descriptionRevision: description.factsRevision })).digest("hex")}` };
}
export function frozenRequest(actual: Json, snapshot: Json): Json {
  if (!object(actual) || !object(snapshot) || !object(actual.arguments) || !object(snapshot.arguments)) throw new DvError("GEN_REQUEST_INVALID", "Invalid frozen request");
  if (actual.model !== snapshot.model || actual.backend !== undefined && actual.backend !== snapshot.backend) throw new DvError("MODEL_DESCRIPTION_CHANGED", "Model or backend changed; replan before execution");
  const description = snapshot.capabilitySnapshot as unknown as ModelDescription, resolved = normalizeArguments(actual.arguments, name => argumentName(description, name));
  return { ...snapshot, arguments: { ...snapshot.arguments, ...resolved } };
}
