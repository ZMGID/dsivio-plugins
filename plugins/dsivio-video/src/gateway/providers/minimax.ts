import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Json } from "../../core/value.ts";
import { providerJson, redactProviderError } from "./http.ts";
import { decodeBase64, signatureMime } from "./artifacts.ts";
import { ProviderFailure } from "./types.ts";
import type { ProviderAdapter, ProviderConnection, ProviderRequest, DurableHooks, ProviderOutcome } from "./types.ts";
import { providerDescription, scalar, mediaArgument, mediaEntries, wireObject } from "./description.ts";

const version = "minimax/phase6.1";
export function minimaxAdapter(connection: ProviderConnection): ProviderAdapter {
  async function upload(entry: Record<string, Json>, name: string, purpose: string, hooks: DurableHooks): Promise<Json> {
    if (hooks.stages[name]) return hooks.stages[name]!;
    if (typeof entry.source !== "string" || typeof entry.mime !== "string") throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Media must be materialized before upload", "rejected");
    const bytes = await readFile(entry.source); const form = new FormData(); form.set("purpose", purpose); form.set("file", new Blob([bytes], { type: entry.mime }), basename(entry.source));
    hooks.stage(`${name}-submitting`);
    const reply = await providerJson(connection, "minimax", "/v1/files/upload", form); const file = wireObject(reply.file); const id = file.file_id;
    if (!((typeof id === "number" && Number.isSafeInteger(id)) || (typeof id === "string" && /^\d+$/.test(id)))) throw new ProviderFailure("GATEWAY_RESPONSE_INVALID", "MiniMax upload did not return an exact file id", "uncertain");
    hooks.stage(name, id); hooks.stages[name] = id; return id;
  }
  return {
    version,
    describe(identity, model, kind) {
      if ((kind === "image" && model !== "image-01") || (kind === "video" && model !== "MiniMax-H3") || (kind === "speech" && model !== "speech-2.8-hd")) throw new ProviderFailure("GATEWAY_MODEL_UNSUPPORTED", "MiniMax model/kind is not implemented", "rejected");
      if (kind === "image") return providerDescription(identity, kind, version, connection, "minimax", {
        prompt: scalar("string", "prompt", { required: true, minLength: 1, maxLength: 1500, lengthUnit: "utf16CodeUnit" }),
        aspectRatio: scalar("string", "aspectRatio", { allowed: ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"], precedence: "aspectRatio overrides explicit width/height; ratio is not defaulted when dimensions are supplied" }),
        width: scalar("integer", "width", { minimum: 512, maximum: 2048, multipleOf: 8 }), height: scalar("integer", "height", { minimum: 512, maximum: 2048, multipleOf: 8 }), n: scalar("integer", "n", { minimum: 1, maximum: 9, defaultValue: 1 }), seed: scalar("integer", "seed"), promptOptimizer: scalar("boolean", "promptOptimizer", { defaultValue: false }), images: mediaArgument("images", 1, ["image/jpeg", "image/png"], 10 * 1024 * 1024),
      }, [{ ruleId: "dimensions-paired", when: { provided: "width" }, check: "require", arguments: ["height"] }, { ruleId: "dimensions-paired-reverse", when: { provided: "height" }, check: "require", arguments: ["width"] }], ["image/jpeg", "image/png"]);
      if (kind === "video") {
        const image = (key: string, count: number): Json => ({ ...wireObject(mediaArgument(key, count, ["image/jpeg", "image/png", "image/webp"], 30 * 1024 * 1024)), minWidth: 256, maxWidth: 5760, minHeight: 256, maxHeight: 5760, minAspectRatio: 0.4, maxAspectRatio: 2.5 });
        return providerDescription(identity, kind, version, connection, "minimax", { prompt: scalar("string", "prompt", { required: true, minLength: 1, maxLength: 7000, lengthUnit: "utf16CodeUnit" }), resolution: scalar("string", "resolution", { required: true, allowed: ["768P", "2K"] }), duration: scalar("integer", "duration", { required: true, minimum: 4, maximum: 15 }), aspectRatio: scalar("string", "aspectRatio", { allowed: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] }), firstFrame: image("firstFrame", 1), lastFrame: image("lastFrame", 1), referenceImages: image("referenceImages", 9), referenceVideos: { ...wireObject(mediaArgument("referenceVideos", 3, ["video/mp4", "video/quicktime"], 50 * 1024 * 1024)), minDuration: 2, maxDuration: 15, minWidth: 256, maxWidth: 5760, minHeight: 256, maxHeight: 5760, minAspectRatio: 0.4, maxAspectRatio: 2.5, minFrameRate: 23.976, maxFrameRate: 60, allowedCodecs: ["h264", "hevc"], allowedAudioCodecs: ["aac", "mp3"] }, referenceAudios: { ...wireObject(mediaArgument("referenceAudios", 3, ["audio/wav", "audio/mpeg"], 15 * 1024 * 1024)), minDuration: 2, maxDuration: 15 } }, [
          { ruleId: "frames-not-references", check: "excludeTogether", arguments: ["firstFrame", "referenceImages"] }, { ruleId: "frames-not-video", check: "excludeTogether", arguments: ["firstFrame", "referenceVideos"] }, { ruleId: "frames-not-audio", check: "excludeTogether", arguments: ["firstFrame", "referenceAudios"] }, { ruleId: "last-not-images", check: "excludeTogether", arguments: ["lastFrame", "referenceImages"] }, { ruleId: "last-not-video", check: "excludeTogether", arguments: ["lastFrame", "referenceVideos"] }, { ruleId: "last-not-audio", check: "excludeTogether", arguments: ["lastFrame", "referenceAudios"] }, { ruleId: "last-needs-first", when: { provided: "lastFrame" }, check: "require", arguments: ["firstFrame"] }, { ruleId: "video-duration-total", check: "durationTotalAtMost", arguments: ["referenceVideos"], limit: 15 }, { ruleId: "audio-duration-total", check: "durationTotalAtMost", arguments: ["referenceAudios"], limit: 15 },
          { ruleId: "text-video-ratio-required", when: { not: { any: [{ provided: "firstFrame" }, { provided: "lastFrame" }, { provided: "referenceImages" }, { provided: "referenceVideos" }, { provided: "referenceAudios" }] } }, check: "require", arguments: ["aspectRatio"] },
          { ruleId: "text-video-ratio-concrete", when: { not: { any: [{ provided: "firstFrame" }, { provided: "lastFrame" }, { provided: "referenceImages" }, { provided: "referenceVideos" }, { provided: "referenceAudios" }] } }, check: "restrictAllowed", arguments: ["aspectRatio"], allowed: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
          { ruleId: "frames-ratio-adaptive", when: { any: [{ provided: "firstFrame" }, { provided: "lastFrame" }] }, check: "restrictAllowed", arguments: ["aspectRatio"], allowed: ["adaptive"] },
        ], ["video/mp4"], true);
      }
      return providerDescription(identity, kind, version, connection, "minimax", { mode: scalar("string", "mode", { required: true, allowed: ["tts", "clone"], defaultValue: "tts" }), text: scalar("string", "text", { required: true, minLength: 1, maxLength: 9999, lengthUnit: "utf16CodeUnit" }), voice: scalar("string", "voice", { minLength: 1, maxLength: 256, systemVoices: ["Chinese (Mandarin)_Lyrical_Voice", "English_expressive_narrator"], acceptsAccountVoiceId: true }), speed: scalar("number", "speed", { minimum: 0.5, maximum: 2, defaultValue: 1 }), outputFormat: scalar("string", "outputFormat", { allowed: ["wav", "mp3", "flac", "opus"], defaultValue: "wav" }), voiceReference: { ...wireObject(mediaArgument("voiceReference", 1, ["audio/wav", "audio/mpeg", "audio/mp4"], 20 * 1024 * 1024)), minDuration: 10, maxDuration: 300 }, consentAttestation: scalar("string", "consentAttestation", { resource: true, minLength: 1 }) }, [
        { ruleId: "tts-voice", when: { equals: { argument: "mode", value: "tts" } }, check: "require", arguments: ["voice"] }, { ruleId: "tts-no-reference", when: { equals: { argument: "mode", value: "tts" } }, check: "restrictAllowed", arguments: ["voiceReference"], allowed: [] }, { ruleId: "clone-inputs", when: { equals: { argument: "mode", value: "clone" } }, check: "require", arguments: ["voiceReference", "consentAttestation"] }, { ruleId: "clone-no-voice", when: { equals: { argument: "mode", value: "clone" } }, check: "restrictAllowed", arguments: ["voice"], allowed: [] },
      ], ["audio/wav", "audio/mpeg", "audio/flac", "audio/ogg"]);
    },
    async submit(request: ProviderRequest, hooks: DurableHooks): Promise<ProviderOutcome> {
      const a = request.arguments;
      if (request.kind === "image") {
        const body: Record<string, unknown> = { model: request.model, prompt: a.prompt, response_format: "base64" };
        for (const [name, wire] of [["aspectRatio", "aspect_ratio"], ["width", "width"], ["height", "height"], ["n", "n"], ["seed", "seed"], ["promptOptimizer", "prompt_optimizer"]]) if (a[name!] !== undefined) body[wire!] = a[name!];
        const references = mediaEntries(a.images); if (references.length) body.subject_reference = await Promise.all(references.map(async e => ({ type: "character", image_file: `data:${e.mime};base64,${(await readFile(String(e.source))).toString("base64")}` })));
        hooks.stage("image-submitting"); const reply = await providerJson(connection, "minimax", "/v1/image_generation", body);
        if (typeof reply.id === "string") hooks.stage("image-accepted", { remoteId: reply.id });
        const data = wireObject(reply.data);
        if (!Array.isArray(data.image_base64) || !data.image_base64.length) throw new ProviderFailure("GATEWAY_OUTPUT_MISSING", "MiniMax image response contains no images", "uncertain");
        return { state: "succeeded", outputs: data.image_base64.map(value => { const bytes = decodeBase64(value); const mime = signatureMime(bytes); if (!mime?.startsWith("image/")) throw new ProviderFailure("GATEWAY_MIME_INVALID", "MiniMax returned invalid image bytes", "uncertain"); return { bytes, mime }; }), ...(typeof reply.id === "string" ? { receipt: reply.id } : {}), ...(reply.metadata ? { usage: reply.metadata } : {}) };
      }
      if (request.kind === "video") {
        const content: Json[] = [{ type: "text", text: a.prompt! }];
        for (const [field, type, role] of [["firstFrame", "image", "first_frame"], ["lastFrame", "image", "last_frame"], ["referenceImages", "image", "reference_image"], ["referenceVideos", "video", "reference_video"], ["referenceAudios", "audio", "reference_audio"]]) {
          const list = mediaEntries(a[field!]); for (let i = 0; i < list.length; i++) { const id = await upload(list[i]!, `uploaded-${field}-${i}`, "video_generation_input", hooks); content.push({ type: `${type}_url`, [`${type}_url`]: { url: `mm_file://${id}` }, role: role! }); }
        }
        hooks.stage("video-submitting"); const reply = await providerJson(connection, "minimax", "/v2/video_generation", { model: request.model, content, resolution: a.resolution, duration: a.duration, ratio: a.aspectRatio });
        if (typeof reply.task_id !== "string" || !reply.task_id) throw new ProviderFailure("GATEWAY_RESPONSE_INVALID", "MiniMax accepted video without task_id", "uncertain");
        hooks.stage("video-accepted", { remoteId: reply.task_id }); return { state: "accepted", receipt: reply.task_id };
      }
      let voice = a.voice;
      if (a.mode === "clone") {
        const entry = mediaEntries(a.voiceReference)[0]; if (!entry) throw new ProviderFailure("GATEWAY_CLONE_INPUT", "Authorized clone sample is required", "rejected");
        const fileId = await upload(entry, "uploaded", "voice_clone", hooks); voice = `Dv${hooks.taskId.replaceAll("-", "")}`;
        if (!hooks.stages.cloned) { hooks.stage("clone-submitting"); await providerJson(connection, "minimax", "/v1/voice_clone", { file_id: fileId, voice_id: voice }); hooks.stage("cloned", { voiceId: voice }); hooks.stages.cloned = { voiceId: voice }; }
      }
      hooks.stage("tts-submitting"); const reply = await providerJson(connection, "minimax", "/v1/t2a_v2", { model: request.model, text: a.text, stream: false, output_format: "hex", voice_setting: { voice_id: voice, speed: a.speed }, audio_setting: { format: a.outputFormat, sample_rate: 32000, channel: 1 } });
      if (typeof reply.trace_id === "string") hooks.stage("tts-accepted", { remoteId: reply.trace_id });
      const data = wireObject(reply.data); const extra = wireObject(reply.extra_info);
      if (typeof data.audio !== "string" || data.audio.length > 256 * 1024 * 1024 || !/^(?:[a-fA-F0-9]{2})+$/.test(data.audio)) throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "MiniMax TTS returned invalid hex audio", "uncertain");
      const bytes = Buffer.from(data.audio, "hex"); const mime = signatureMime(bytes);
      const formats: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", opus: "audio/ogg" };
      if (!mime || mime !== formats[String(a.outputFormat)] || (extra.audio_size !== undefined && extra.audio_size !== bytes.length) || (extra.audio_format !== undefined && extra.audio_format !== a.outputFormat)) throw new ProviderFailure("GATEWAY_MIME_INVALID", "MiniMax TTS audio disagrees with requested format or metadata", "uncertain");
      return { state: "succeeded", outputs: [{ bytes, mime }], ...(typeof reply.trace_id === "string" ? { receipt: reply.trace_id } : {}), usage: extra };
    },
    async poll(receipt, request) {
      const reply = await providerJson(connection, "minimax", `/v2/query/video_generation/${encodeURIComponent(receipt)}`); const task = wireObject(reply.task);
      if (task.id !== receipt || task.model !== request.model) throw new ProviderFailure("GATEWAY_RECEIPT_INVALID", "MiniMax returned a different video task", "query");
      if (task.status === "queued" || task.status === "running") return { state: "accepted", receipt, retryAfterMs: 10_000 };
      if (task.status === "failed" || task.status === "cancelled") {
        const error = task.error && typeof task.error === "object" && !Array.isArray(task.error) ? task.error : {};
        return { state: task.status, code: typeof error.code === "string" || typeof error.code === "number" ? `MINIMAX_${error.code}` : "MINIMAX_TASK_FAILED", message: redactProviderError(typeof error.message === "string" ? error.message : "MiniMax video task failed or was cancelled; receipt retained", connection.apiKey) };
      }
      if (task.status !== "succeeded") throw new ProviderFailure("GATEWAY_RESPONSE_INVALID", "Unknown MiniMax task status", "query");
      const content = wireObject(task.content); if (typeof content.url !== "string") throw new ProviderFailure("GATEWAY_OUTPUT_MISSING", "MiniMax task succeeded without video URL", "query"); return { state: "succeeded", outputs: [{ url: content.url, mime: "video/mp4" }], receipt, ...(task.usage ? { usage: task.usage } : {}) };
    },
    async cancel() { return "unsupported"; },
  };
}
