import { DvError } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
export type MediaKind = "image" | "video" | "speech" | "transcribe";
export type GatewayBackend = "dsivio" | "standalone";
/** One canonical argument map; ResourceRefs/Pending stay graph values until execution. */
export type GenerationRequest = { model: string; arguments: Record<string, Json>; backend?: GatewayBackend; capabilitySnapshot?: Json; requestHash?: string; providedArguments?: string[] };
export function object(data: unknown): data is Record<string, Json> { return data !== null && typeof data === "object" && !Array.isArray(data); }
export function readRequest(data: Json, _kind: MediaKind): GenerationRequest {
  if (!object(data) || Object.keys(data).some(key => !["model", "arguments", "backend", "capabilitySnapshot", "requestHash", "providedArguments"].includes(key))) throw new DvError("GEN_REQUEST_INVALID", "Expected canonical generation request");
  if (typeof data.model !== "string" || !data.model.trim()) throw new DvError("GEN_MODEL_REQUIRED", "Exact provider/model identity is required");
  if (!object(data.arguments)) throw new DvError("GEN_REQUEST_INVALID", "arguments must be an object");
  if (data.backend !== undefined && data.backend !== "dsivio" && data.backend !== "standalone") throw new DvError("GATEWAY_BACKEND_INVALID", "Invalid selected backend");
  if (data.requestHash !== undefined && typeof data.requestHash !== "string") throw new DvError("GEN_REQUEST_INVALID", "requestHash must be a string");
  if (data.providedArguments !== undefined && (!Array.isArray(data.providedArguments) || data.providedArguments.some(item => typeof item !== "string") || new Set(data.providedArguments).size !== data.providedArguments.length)) throw new DvError("GEN_REQUEST_INVALID", "providedArguments must contain unique argument names");
  return { model: data.model, arguments: { ...data.arguments }, ...(data.backend === undefined ? {} : { backend: data.backend }), ...(data.capabilitySnapshot === undefined ? {} : { capabilitySnapshot: data.capabilitySnapshot }), ...(typeof data.requestHash === "string" ? { requestHash: data.requestHash } : {}), ...(Array.isArray(data.providedArguments) && data.providedArguments.every(item => typeof item === "string") ? { providedArguments: data.providedArguments as string[] } : {}) };
}
