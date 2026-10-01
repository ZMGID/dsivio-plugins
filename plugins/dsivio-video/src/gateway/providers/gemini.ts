import { readFile } from "node:fs/promises";
import type { Json } from "../../core/value.ts";
import { providerJson, redactProviderError } from "./http.ts";
import { decodeBase64, signatureMime } from "./artifacts.ts";
import { ProviderFailure } from "./types.ts";
import type { ProviderAdapter, ProviderConnection, ProviderOutput } from "./types.ts";
import { providerDescription, scalar, mediaArgument, mediaEntries, wireObject } from "./description.ts";

const version = "gemini/phase6.1";
const voices = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"];
export function geminiAdapter(connection: ProviderConnection): ProviderAdapter {
  async function imageData(entry: Record<string, Json>): Promise<Json> { if (typeof entry.source !== "string" || typeof entry.mime !== "string") throw new ProviderFailure("GATEWAY_MEDIA_INVALID", "Gemini input image was not materialized", "rejected"); return { inlineData: { mimeType: entry.mime, data: (await readFile(entry.source)).toString("base64") } }; }
  return {
    version,
    describe(identity, model, kind) {
      if ((kind === "image" && model !== "gemini-3.1-flash-image") || (kind === "video" && model !== "veo-3.1-generate-preview") || (kind === "speech" && model !== "gemini-3.8-flash-tts")) throw new ProviderFailure("GATEWAY_MODEL_UNSUPPORTED", "Gemini model/kind is not implemented", "rejected");
      if (kind === "image") return providerDescription(identity, kind, version, connection, "gemini", { prompt: scalar("string", "prompt", { required: true, minLength: 1 }), aspectRatio: scalar("string", "aspectRatio", { allowed: ["1:1", "1:4", "4:1", "1:8", "8:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] }), size: scalar("string", "size", { allowed: ["1K", "2K", "4K"] }), outputFormat: scalar("string", "outputFormat", { allowed: ["png", "jpeg"], defaultValue: "png" }), images: mediaArgument("images", 14, ["image/png", "image/jpeg", "image/webp"], 20 * 1024 * 1024) }, [], ["image/png", "image/jpeg"]);
      if (kind === "video") return providerDescription(identity, kind, version, connection, "gemini", { prompt: scalar("string", "prompt", { required: true, minLength: 1 }), aspectRatio: scalar("string", "aspectRatio", { allowed: ["16:9", "9:16"], defaultValue: "16:9" }), resolution: scalar("string", "resolution", { allowed: ["720p", "1080p", "4k"], defaultValue: "720p" }), duration: scalar("integer", "duration", { allowed: [4, 6, 8], defaultValue: 8 }), negativePrompt: scalar("string", "negativePrompt"), seed: scalar("integer", "seed", { minimum: 0, maximum: 4294967295 }), personGeneration: scalar("string", "personGeneration", { allowed: ["allow_all", "allow_adult"] }), firstFrame: mediaArgument("firstFrame", 1, ["image/jpeg", "image/png"], 20 * 1024 * 1024), lastFrame: mediaArgument("lastFrame", 1, ["image/jpeg", "image/png"], 20 * 1024 * 1024), referenceImages: mediaArgument("referenceImages", 3, ["image/jpeg", "image/png"], 20 * 1024 * 1024) }, [
        { ruleId: "veo-higher-resolution-duration", when: { any: [{ equals: { argument: "resolution", value: "1080p" } }, { equals: { argument: "resolution", value: "4k" } }, { provided: "referenceImages" }] }, check: "restrictAllowed", arguments: ["duration"], allowed: [8] }, { ruleId: "veo-last-needs-first", when: { provided: "lastFrame" }, check: "require", arguments: ["firstFrame"] }, { ruleId: "veo-frames-no-references", check: "excludeTogether", arguments: ["firstFrame", "referenceImages"] }, { ruleId: "veo-image-persons", when: { any: [{ provided: "firstFrame" }, { provided: "referenceImages" }] }, check: "restrictAllowed", arguments: ["personGeneration"], allowed: ["allow_adult"] },
      ], ["video/mp4"], true);
      return providerDescription(identity, kind, version, connection, "gemini", { mode: scalar("string", "mode", { allowed: ["tts"], defaultValue: "tts" }), text: scalar("string", "text", { required: true, minLength: 1 }), voice: scalar("string", "voice", { required: true, allowed: voices }), instruction: scalar("string", "instruction", { minLength: 1 }), outputFormat: scalar("string", "outputFormat", { allowed: ["wav"], defaultValue: "wav" }) }, [], ["audio/wav"]);
    },
    async submit(request, hooks) {
      const a = request.arguments;
      if (request.kind === "image") {
        const input: Json[] = [{ type: "text", text: a.prompt! }];
        for (const entry of mediaEntries(a.images)) input.push({ type: "image", mime_type: entry.mime!, data: (await readFile(String(entry.source))).toString("base64") });
        const responseFormat: Record<string, Json> = { type: "image", mime_type: a.outputFormat === "jpeg" ? "image/jpeg" : "image/png" }; if (a.aspectRatio !== undefined) responseFormat.aspect_ratio = a.aspectRatio; if (a.size !== undefined) responseFormat.image_size = a.size;
        hooks.stage("image-submitting"); const reply = await providerJson(connection, "gemini", "/interactions", { model: request.model, input, response_format: responseFormat });
        if (typeof reply.id === "string") hooks.stage("image-accepted", { remoteId: reply.id });
        const outputs: ProviderOutput[] = [];
        // REST interactions expose model_output content in steps; SDK convenience output_image is not assumed.
        if (Array.isArray(reply.steps)) for (const value of reply.steps) { const step = wireObject(value); if (step.type !== "model_output" || !Array.isArray(step.content)) continue; for (const block of step.content) { const image = wireObject(block); if (image.type !== "image") continue; if (typeof image.mime_type !== "string") throw new ProviderFailure("GATEWAY_MIME_INVALID", "Gemini image output has no MIME metadata", "uncertain"); outputs.push({ bytes: decodeBase64(image.data), mime: image.mime_type }); } }
        if (!outputs.length) throw new ProviderFailure("GATEWAY_OUTPUT_MISSING", "Gemini interactions returned no generated image", "uncertain");
        return { state: "succeeded", outputs, ...(typeof reply.id === "string" ? { receipt: reply.id } : {}), ...(reply.usage ? { usage: reply.usage } : {}) };
      }
      if (request.kind === "video") {
        const instance: Record<string, Json> = { prompt: a.prompt! }; const first = mediaEntries(a.firstFrame)[0]; const last = mediaEntries(a.lastFrame)[0];
        if (first) instance.image = await imageData(first); if (last) instance.lastFrame = await imageData(last);
        const references = mediaEntries(a.referenceImages); if (references.length) instance.referenceImages = await Promise.all(references.map(async entry => ({ image: await imageData(entry), referenceType: "asset" })));
        const parameters: Record<string, Json> = { numberOfVideos: 1 }; for (const [key, wire] of [["aspectRatio", "aspectRatio"], ["resolution", "resolution"], ["duration", "durationSeconds"], ["negativePrompt", "negativePrompt"], ["seed", "seed"], ["personGeneration", "personGeneration"]]) if (a[key!] !== undefined) parameters[wire!] = a[key!]!;
        hooks.stage("video-submitting"); const reply = await providerJson(connection, "gemini", `/models/${request.model}:predictLongRunning`, { instances: [instance], parameters });
        if (typeof reply.name !== "string" || !/^models\/[A-Za-z0-9_.-]+\/operations\/[A-Za-z0-9_.-]+$/.test(reply.name)) throw new ProviderFailure("GATEWAY_RECEIPT_INVALID", "Gemini did not return a safe operation name", "uncertain");
        hooks.stage("video-accepted", { remoteId: reply.name }); return { state: "accepted", receipt: reply.name };
      }
      const part: Record<string, Json> = { text: a.text! }; if (a.instruction !== undefined) part.speech_metadata = { style: a.instruction };
      hooks.stage("tts-submitting"); const reply = await providerJson(connection, "gemini", `/models/${request.model}:generateContent`, { contents: [{ role: "user", parts: [part] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: a.voice } } } });
      const candidates = reply.candidates; if (!Array.isArray(candidates) || !candidates.length) throw new ProviderFailure("GATEWAY_OUTPUT_MISSING", "Gemini TTS has no candidates", "uncertain");
      const candidate = wireObject(candidates[0]); const content = wireObject(candidate.content); if (!Array.isArray(content.parts)) throw new ProviderFailure("GATEWAY_RESPONSE_INVALID", "Gemini TTS has no audio parts", "uncertain");
      const outputs: ProviderOutput[] = [];
      for (const value of content.parts) { const item = wireObject(value); if (!item.inlineData) continue; const audio = wireObject(item.inlineData); if (typeof audio.mimeType !== "string") throw new ProviderFailure("GATEWAY_MIME_INVALID", "Gemini TTS audio lacks MIME", "uncertain"); const bytes = decodeBase64(audio.data); const mime = audio.mimeType.toLowerCase();
        if (mime.split(";")[0] === "audio/wav" || mime.split(";")[0] === "audio/x-wav") { if (signatureMime(bytes) !== "audio/wav") throw new ProviderFailure("GATEWAY_MIME_INVALID", "Gemini WAV MIME contradicts bytes", "uncertain"); outputs.push({ bytes, mime: "audio/wav" }); }
        else if (/^audio\/l16;/.test(mime)) {
          const rate = /(?:^|;)\s*rate=(\d+)/.exec(mime); const channels = /(?:^|;)\s*channels=(\d+)/.exec(mime);
          // L16 specifies big-endian signed 16-bit PCM; channels must be explicit, not guessed.
          if (!rate || !channels || ![1, 2].includes(Number(channels[1])) || Number(rate[1]) < 8000 || Number(rate[1]) > 96000 || bytes.length % (2 * Number(channels[1])) !== 0) throw new ProviderFailure("GATEWAY_PCM_METADATA_REQUIRED", "Raw Gemini PCM requires explicit L16 encoding, sample rate and channels; no guessed WAV wrapping", "uncertain");
          const pcm = Buffer.from(bytes); pcm.swap16(); const wav = Buffer.alloc(44); const sampleRate = Number(rate[1]); const count = Number(channels[1]); wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(count, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * count * 2, 28); wav.writeUInt16LE(count * 2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); outputs.push({ bytes: Buffer.concat([wav, pcm]), mime: "audio/wav" });
        } else throw new ProviderFailure("GATEWAY_MIME_INVALID", "Gemini TTS output is not a supported WAV or explicit PCM format", "uncertain");
      }
      if (!outputs.length) throw new ProviderFailure("GATEWAY_OUTPUT_MISSING", "Gemini TTS returned no audio", "uncertain"); return { state: "succeeded", outputs, ...(reply.usageMetadata ? { usage: reply.usageMetadata } : {}) };
    },
    async poll(receipt) {
      if (!/^models\/[A-Za-z0-9_.-]+\/operations\/[A-Za-z0-9_.-]+$/.test(receipt)) throw new ProviderFailure("GATEWAY_RECEIPT_INVALID", "Invalid stored Gemini operation name", "query");
      const reply = await providerJson(connection, "gemini", `/${receipt}`);
      if (reply.name !== receipt) throw new ProviderFailure("GATEWAY_RECEIPT_INVALID", "Gemini returned a different operation", "query");
      if (reply.done !== true) return { state: "accepted", receipt, retryAfterMs: 10_000 };
      if (reply.error) {
        const error = wireObject(reply.error);
        return { state: "failed", code: typeof error.code === "string" || typeof error.code === "number" ? `GEMINI_${error.code}` : "GEMINI_OPERATION_FAILED", message: redactProviderError(typeof error.message === "string" ? error.message : "Gemini video operation failed; receipt retained", connection.apiKey) };
      }
      const response = wireObject(reply.response); const generation = wireObject(response.generateVideoResponse); if (!Array.isArray(generation.generatedSamples) || !generation.generatedSamples.length) throw new ProviderFailure("GATEWAY_OUTPUT_MISSING", "Gemini operation finished without video", "query");
      const outputs = generation.generatedSamples.map(sample => { const video = wireObject(wireObject(sample).video); if (typeof video.uri !== "string") throw new ProviderFailure("GATEWAY_OUTPUT_MISSING", "Gemini video lacks URI", "query"); return { url: video.uri, mime: "video/mp4" }; }); return { state: "succeeded", outputs, receipt };
    },
    async cancel() { return "unsupported"; },
  };
}
