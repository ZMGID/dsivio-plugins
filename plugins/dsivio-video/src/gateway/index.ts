import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { CapabilityDef } from "../core/capability.ts";
import type { Json } from "../core/value.ts";
import { imageType, videoType } from "../modules/media/index.ts";
import { dsivioExecutor, runDsivio } from "./dsivio.ts";
import { object, readRequest } from "./request.ts";
import { validateCapabilities } from "./validate.ts";

export const gatewayCapabilities: CapabilityDef[] = (["image", "video"] as const).map((kind) => ({
  name: `gateway/${kind}`,
  returns: kind === "image" ? imageType : videoType,
  executor: dsivioExecutor(kind),
  async resolve(data, ctx) {
    try {
      let config: Json = {};
      const file = join(ctx.projectRoot, ".dsivio-video", "config.json");
      try { config = JSON.parse(await readFile(file, "utf8")) as Json; }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw new DvError("GATEWAY_CONFIG_INVALID", `Cannot read gateway config ${file}: ${String(error)}`, { cause: error });
      }
      if (!object(config) || (config.gateway !== undefined && config.gateway !== "auto" && config.gateway !== "dsivio")) throw new DvError("GATEWAY_BACKEND_INVALID", 'gateway must be "auto" or "dsivio"');
      const request = readRequest(data, kind);
      const result = await runDsivio(["media", "models", "--kind", kind], ctx.projectRoot, ctx.signal);
      if (result.code === 6) throw new DvError("GATEWAY_UNAVAILABLE", "Dsivio is closed; open Dsivio to resolve enabled models");
      if (result.code !== 0) throw new DvError("GATEWAY_MODELS_FAILED", `Dsivio model query exited ${result.code}: ${result.stderr || result.stdout}`);
      let models: Json;
      try { models = JSON.parse(result.stdout.trim()) as Json; }
      catch (error) { throw new DvError("GATEWAY_RESPONSE_INVALID", "Dsivio models did not return a JSON array", { cause: error }); }
      if (!Array.isArray(models) || models.some((model) => !object(model) || typeof model.id !== "string" || model.kind !== kind || typeof model.known !== "boolean")) throw new DvError("GATEWAY_RESPONSE_INVALID", "Dsivio models must contain ids, kinds and capability knowledge");
      const model = models.find((item) => object(item) && item.id === request.model);
      if (!model || !object(model)) throw new DvError("GEN_MODEL_NOT_ENABLED", `Model ${request.model} is not enabled; enabled ${kind} ids: ${models.map((entry) => object(entry) ? String(entry.id) : "").join(", ") || "none"}`);
      const capabilities = model.capabilities ?? null;
      validateCapabilities(request, kind, model.known === true, capabilities);
      // Validate default types too: catalog output is external, not trusted authored data.
      const resolved = readRequest({ ...request, backend: "dsivio", capabilities }, kind);
      validateCapabilities(resolved, kind, model.known === true, capabilities);
      return {
        ok: true, request: { ...resolved }, backend: "dsivio", cost: "paid",
        summary: { kind, model: resolved.model, backend: "dsivio", params: resolved.params, prompt: resolved.prompt, references: resolved.references, firstFrame: resolved.firstFrame ?? null, lastFrame: resolved.lastFrame ?? null, price: "unknown" },
      };
    } catch (error) {
      if (error instanceof DvError) return { ok: false, code: error.code, reason: error.message };
      throw error;
    }
  },
}));
