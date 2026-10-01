import { DvError } from "../core/errors.ts";
import type { AsyncExecutor, CapabilityDef } from "../core/capability.ts";
import type { Json } from "../core/value.ts";
import { imageType, videoType, audioType } from "../modules/media/index.ts";
import { pipelineTypes } from "../pipeline/types.ts";
import { dsivioExecutor } from "./dsivio.ts";
import { standaloneExecutor } from "./standalone.ts";
import { localTranscribeExecutor } from "../asr/backend.ts";
import { readRequest, object } from "./request.ts";
import type { MediaKind } from "./request.ts";
import { validateRequest } from "./validate.ts";
import { gatewayModels, selectBackend } from "./backend.ts";
function executor(kind: MediaKind): AsyncExecutor {
  const selected = (backend: Json | undefined): AsyncExecutor => backend === "dsivio" ? dsivioExecutor(kind) : backend === "standalone" ? kind === "transcribe" ? localTranscribeExecutor : standaloneExecutor(kind) : (() => { throw new DvError("GATEWAY_BACKEND_INVALID", "Build has no selected gateway backend"); })();
  return {
    kind: "async",
    async submit(data, ctx) { const request = readRequest(data, kind); const result = await selected(request.backend).submit(data, ctx); return { ...result, handle: { backend: request.backend!, inner: result.handle } }; },
    async recover(data, ctx) { const request = readRequest(data, kind); if (request.backend !== "standalone") return null; const result = await selected(request.backend).recover?.(data, ctx); return result ? { ...result, handle: { backend: request.backend, inner: result.handle } } : null; },
    async poll(handle, ctx) { if (!object(handle) || handle.inner === undefined) throw new DvError("GATEWAY_HANDLE_INVALID", "Invalid selected-backend handle"); return selected(handle.backend).poll(handle.inner, ctx); },
    async cancel(handle, ctx) { if (!object(handle) || handle.inner === undefined) throw new DvError("GATEWAY_HANDLE_INVALID", "Invalid selected-backend handle"); return selected(handle.backend).cancel?.(handle.inner, ctx) ?? "unsupported"; },
  };
}
export const gatewayCapabilities: CapabilityDef[] = (["image", "video", "speech", "transcribe"] as const).map(kind => ({
  name: `gateway/${kind}`, returns: kind === "image" ? imageType : kind === "video" ? videoType : kind === "speech" ? audioType : pipelineTypes.evidence, executor: executor(kind),
  async resolve(data, ctx) {
    try {
      let request = readRequest(data, kind);
      if (request.backend && request.capabilitySnapshot) {
        if (ctx.gatewayBackend && request.backend !== ctx.gatewayBackend) throw new DvError("GATEWAY_BACKEND_CHANGED", "Build backend cannot change");
        // Snapshots are authority for defaults. Current facts are checked at submission, never used to replan.
        request = validateRequest(request);
      } else {
        const backend = await selectBackend(ctx), models = await gatewayModels(ctx, kind);
        const model = models.find(entry => entry.id === request.model);
        if (!model) throw new DvError("GEN_MODEL_NOT_ENABLED", `${request.model} is not enabled for ${kind} on ${backend}; available: ${models.map(entry => entry.id).join(", ") || "none"}`);
        if (!model.description) throw new DvError("MODEL_DESCRIPTION_UNAVAILABLE", "Host model description unavailable; upgrade the host before using model options");
        request = validateRequest({ ...request, backend, capabilitySnapshot: model.description as unknown as Json });
      }
      return { ok: true, request: { ...request }, backend: request.backend!, cost: kind === "transcribe" && request.model.startsWith("local/") ? "local" : "paid", summary: { kind, model: request.model, backend: request.backend!, arguments: request.arguments, descriptionRevision: object(request.capabilitySnapshot) ? request.capabilitySnapshot.factsRevision ?? null : null, price: "unknown", cloudUpload: !request.model.startsWith("local/") } };
    } catch (error) { if (error instanceof DvError) return { ok: false, code: error.code, reason: error.message }; throw error; }
  },
}));
