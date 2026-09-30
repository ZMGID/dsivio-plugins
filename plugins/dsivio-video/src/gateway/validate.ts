import { DvError } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
import { object } from "./request.ts";
import type { GenerationRequest, MediaKind } from "./request.ts";

export function validateCapabilities(request: GenerationRequest, kind: MediaKind, known: boolean, capabilities: Json): void {
  if (Object.keys(request.options).length) throw new DvError("GEN_OPTION_UNSUPPORTED", "Dsivio does not accept model-specific parameters yet");
  const refs = request.references;
  const hasFrames = request.firstFrame !== undefined || request.lastFrame !== undefined;
  const hasReferences = refs.images.length + refs.videos.length + refs.audios.length > 0;
  if (!known) {
    if (Object.keys(request.params).length || hasFrames || hasReferences) throw new DvError("GEN_CAPABILITIES_UNKNOWN", `${request.model} has unknown capabilities; only a prompt is allowed`);
    return;
  }
  if (!object(capabilities)) throw new DvError("GATEWAY_RESPONSE_INVALID", `${request.model} is known but lacks a capability object`);
  const caps = capabilities;
  if (kind === "video") {
    // Dsivio prioritizes ordinary references over tail frames, then opening frames.
    const mode = hasReferences ? "reference" : request.lastFrame !== undefined ? "frames" : request.firstFrame !== undefined ? "image" : "text";
    if (!Array.isArray(caps.modes) || !caps.modes.includes(mode)) throw new DvError("GEN_MODE_UNSUPPORTED", `${request.model} does not support ${mode} mode; allowed: ${Array.isArray(caps.modes) ? caps.modes.join(", ") : "none"}`);
  }
  const params = request.params;
  for (const [param, field] of [["duration", "durations"], ["resolution", "resolutions"], ["ratio", "ratios"], ["size", "sizes"], ["quality", "qualities"]] as const) {
    const value = params[param];
    if (value === undefined) continue;
    const allowed = caps[field];
    const pixels = kind === "image" && param === "size" && caps.customPixelSize === true && typeof value === "string" && /^[1-9]\d*x[1-9]\d*$/.test(value);
    if (!pixels && (!Array.isArray(allowed) || !allowed.includes(value))) throw new DvError(`GEN_${param.toUpperCase()}_UNSUPPORTED`, `${request.model} does not support ${param} ${String(value)}; allowed: ${Array.isArray(allowed) ? allowed.join(", ") : "none"}`);
  }
  if (params.audio !== undefined && caps.audioToggle !== true) throw new DvError("GEN_AUDIO_UNSUPPORTED", `${request.model} does not support the audio toggle (including false)`);
  if (request.firstFrame !== undefined && caps.firstFrame !== true) throw new DvError("GEN_FIRST_FRAME_UNSUPPORTED", `${request.model} does not support a first frame`);
  if (request.lastFrame !== undefined && caps.lastFrame !== true) throw new DvError("GEN_LAST_FRAME_UNSUPPORTED", `${request.model} does not support a last frame`);
  if (request.lastFrame !== undefined && request.firstFrame === undefined && caps.lastFrameNeedsFirst === true) throw new DvError("GEN_LAST_FRAME_NEEDS_FIRST", `${request.model} requires a first frame with a last frame`);
  for (const [name, values, field] of [["images", refs.images, "maxReferenceImages"], ["videos", refs.videos, "maxReferenceVideos"], ["audios", refs.audios, "maxReferenceAudios"]] as const) {
    const limit = typeof caps[field] === "number" ? caps[field] : 0;
    if (values.length > limit) throw new DvError(`GEN_REFERENCE_${name.toUpperCase()}_LIMIT`, `${request.model} accepts at most ${limit} reference ${name}; received ${values.length}`);
  }
  if (refs.audios.length && !refs.images.length && !refs.videos.length && caps.referenceAudioNeedsVisual === true) throw new DvError("GEN_REFERENCE_AUDIO_NEEDS_VISUAL", `${request.model} requires reference images or videos alongside reference audio`);
  if (hasFrames && hasReferences && caps.framesExcludeReferences === true) throw new DvError("GEN_FRAMES_EXCLUDE_REFERENCES", `${request.model} cannot combine frames and references`);
  if ((refs.videos.length || refs.audios.length) && caps.localReferenceMedia !== true) throw new DvError("GEN_LOCAL_REFERENCE_UNSUPPORTED", `${request.model} does not accept local reference videos or audio; Dsivio requires HTTP(S) links`);
  if (typeof request.prompt === "string" && typeof caps.maxPromptLength === "number" && caps.maxPromptLength > 0) {
    // The CLI trims prompt-file text before protocol validation. Runway counts
    // UTF-16 units; other Dsivio protocols count Unicode scalar values.
    const prompt = request.prompt.trim();
    let length = caps.protocol === "runway" ? prompt.length : 0;
    if (caps.protocol !== "runway") for (const character of prompt) length++;
    if (length > caps.maxPromptLength) throw new DvError("GEN_PROMPT_TOO_LONG", `${request.model} prompt length ${length} exceeds ${caps.maxPromptLength}`);
  }
  if (params.count !== undefined && (typeof params.count !== "number" || typeof caps.maxCount !== "number" || params.count > caps.maxCount)) throw new DvError("GEN_COUNT_UNSUPPORTED", `${request.model} count ${String(params.count)} exceeds maximum ${String(caps.maxCount ?? 0)}`);
  const defaults = caps.defaults;
  if (defaults !== undefined && !object(defaults)) throw new DvError("GATEWAY_RESPONSE_INVALID", "Capability defaults must be an object");
  if (defaults && object(defaults)) {
    // Only public defaults are applied; absent capability facts are not guesses.
    for (const name of kind === "image" ? ["ratio", "size", "quality", "count"] : ["duration", "resolution", "ratio", "audio"]) {
      if (params[name] !== undefined || defaults[name] === undefined) continue;
      params[name] = defaults[name];
    }
  }
}
