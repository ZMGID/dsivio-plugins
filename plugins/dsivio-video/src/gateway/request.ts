import { DvError } from "../core/errors.ts";
import { isPending } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { imageType, videoType, audioType, validateMedia } from "../modules/media/index.ts";

export type MediaKind = "image" | "video";
/**
 * Pure producer request: prompt is Text data (string) or Pending; media fields are
 * ResourceRefs or Pending, never paths. params holds only the public scalar knobs;
 * options holds authored model-specific extras (currently rejected by Dsivio).
 * resolve adds backend and a capability snapshot, and expands backend defaults.
 * The worker preserves this snapshot instead of consulting changed model settings.
 */
export type GenerationRequest = {
  model: string;
  prompt: Json;
  params: Record<string, Json>;
  references: { images: Json[]; videos: Json[]; audios: Json[] };
  options: Record<string, Json>;
  firstFrame?: Json;
  lastFrame?: Json;
  backend?: string;
  capabilities?: Json;
};

export function object(data: Json): data is Record<string, Json> {
  return data !== null && typeof data === "object" && !Array.isArray(data);
}

export function readRequest(data: Json, kind: MediaKind): GenerationRequest {
  if (!object(data)) throw new DvError("GEN_REQUEST_INVALID", "Generation request must be an object");
  if (Object.keys(data).some((key) => !["model", "prompt", "params", "references", "options", "firstFrame", "lastFrame", "backend", "capabilities"].includes(key))) throw new DvError("GEN_REQUEST_INVALID", "Unknown generation request field");
  if (typeof data.model !== "string" || !data.model.trim()) throw new DvError("GEN_MODEL_REQUIRED", "model is required");
  if (!(typeof data.prompt === "string" && data.prompt.trim()) && !(isPending(data.prompt) && data.prompt.type === "dsivio-video/text@1#Text")) throw new DvError("GEN_PROMPT_INVALID", "prompt must be non-empty Text or Pending Text");
  if (!object(data.params ?? null) || !object(data.references ?? null) || !object(data.options ?? null)) throw new DvError("GEN_REQUEST_INVALID", "params, references and options must be objects");
  const params = data.params;
  const refs = data.references;
  const options = data.options;
  // TypeScript cannot preserve indexed narrowing across the object guard's argument.
  if (!params || !object(params) || !refs || !object(refs) || !options || !object(options)) throw new DvError("GEN_REQUEST_INVALID", "Invalid request objects");
  const allowed = kind === "image" ? ["ratio", "size", "quality", "count"] : ["duration", "resolution", "ratio", "audio"];
  for (const [name, value] of Object.entries(params)) {
    if (!allowed.includes(name)) throw new DvError("GEN_PARAM_UNSUPPORTED", `${kind} does not accept parameter ${name}`);
    if (name === "duration" || name === "count") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new DvError("GEN_PARAM_INVALID", `${name} must be a positive integer`);
    } else if (name === "audio") {
      if (typeof value !== "boolean") throw new DvError("GEN_PARAM_INVALID", "audio must be true or false");
    } else if (typeof value !== "string" || !value) throw new DvError("GEN_PARAM_INVALID", `${name} must be non-empty text`);
  }
  if (Object.keys(refs).some((key) => !["images", "videos", "audios"].includes(key))) throw new DvError("GEN_REQUEST_INVALID", "Unknown reference category");
  const { images, videos, audios } = refs;
  if (!Array.isArray(images) || !Array.isArray(videos) || !Array.isArray(audios)) throw new DvError("GEN_REQUEST_INVALID", "Reference categories must be arrays");
  for (const [category, values, type] of [["image", images, imageType], ["video", videos, videoType], ["audio", audios, audioType]] as const) {
    for (const value of values) {
      if (isPending(value)) {
        if (value.type !== type) throw new DvError("TYPE_INVALID", `Expected Pending ${type}`);
      } else validateMedia(value, category);
    }
  }
  for (const field of ["firstFrame", "lastFrame"] as const) {
    const value = data[field];
    if (value === undefined) continue;
    if (isPending(value)) {
      if (value.type !== imageType) throw new DvError("TYPE_INVALID", `${field} must be an Image`);
    } else validateMedia(value, "image");
  }
  if (kind === "image" && (data.firstFrame !== undefined || data.lastFrame !== undefined || videos.length || audios.length)) throw new DvError("GEN_PARAM_UNSUPPORTED", "Image generation accepts only image references, not frames, video or audio");
  if (data.backend !== undefined && data.backend !== "dsivio") throw new DvError("GATEWAY_BACKEND_INVALID", `Unsupported gateway backend ${String(data.backend)}`);
  return {
    model: data.model, prompt: data.prompt!, params: { ...params }, references: { images: [...images], videos: [...videos], audios: [...audios] }, options: { ...options },
    ...(data.firstFrame === undefined ? {} : { firstFrame: data.firstFrame }),
    ...(data.lastFrame === undefined ? {} : { lastFrame: data.lastFrame }),
    ...(data.backend === undefined ? {} : { backend: data.backend }),
    ...(data.capabilities === undefined ? {} : { capabilities: data.capabilities }),
  };
}
