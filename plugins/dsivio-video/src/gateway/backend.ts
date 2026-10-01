import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { ResolveContext } from "../core/capability.ts";
import type { Json } from "../core/value.ts";
import { object } from "./request.ts";
import type { GatewayBackend, MediaKind } from "./request.ts";
import { runDsivio } from "./dsivio.ts";
import type { ModelEntry } from "./description.ts";
import { legacyDescription } from "./description.ts";
import { standaloneModels } from "./standalone.ts";
import { localAsrModel } from "../asr/backend.ts";
export async function gatewayConfig(projectRoot: string): Promise<Record<string, Json>> {
  try { const config: unknown = JSON.parse(await readFile(join(projectRoot, ".dsivio-video", "config.json"), "utf8")); if (!object(config)) throw new Error("Expected object"); return config; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}; throw new DvError("GATEWAY_CONFIG_INVALID", `Invalid gateway config: ${String(error)}`, { cause: error }); }
}
export async function dsivioModels(projectRoot: string, kind?: MediaKind, signal?: AbortSignal): Promise<ModelEntry[]> {
  const reply = await runDsivio(["media", "models", ...(kind ? ["--kind", kind] : []), "--json"], projectRoot, signal);
  if (reply.code !== 0) throw new DvError(reply.code === 6 ? "GATEWAY_UNAVAILABLE" : "GATEWAY_MODELS_FAILED", `Models query exited ${reply.code}: ${reply.stderr || reply.stdout}`);
  let models: unknown; try { models = JSON.parse(reply.stdout); } catch (error) { throw new DvError("GATEWAY_RESPONSE_INVALID", "Models query returned invalid JSON", { cause: error }); }
  if (!Array.isArray(models) || models.some(model => !object(model) || typeof model.id !== "string" || typeof model.kind !== "string")) throw new DvError("GATEWAY_RESPONSE_INVALID", "Models must be an array of model identities");
  return (models as ModelEntry[]).map(model => !model.description && (model.kind === "image" || model.kind === "video") ? { ...model, description: legacyDescription(model) } : model);
}
export async function selectBackend(ctx: ResolveContext): Promise<GatewayBackend> {
  if (ctx.gatewayBackend) return ctx.gatewayBackend;
  const config = await gatewayConfig(ctx.projectRoot), configured = config.gateway ?? "auto";
  if (!["auto", "dsivio", "standalone"].includes(String(configured))) throw new DvError("GATEWAY_BACKEND_INVALID", "gateway must be auto, dsivio or standalone");
  if (configured !== "auto") return ctx.gatewayBackend = configured as GatewayBackend;
  try { await dsivioModels(ctx.projectRoot, undefined, ctx.signal); return ctx.gatewayBackend = "dsivio"; }
  catch (error) { if (!(error instanceof DvError) || error.code !== "GATEWAY_UNAVAILABLE") throw error; return ctx.gatewayBackend = "standalone"; }
}
export async function gatewayModels(ctx: ResolveContext, kind?: MediaKind): Promise<ModelEntry[]> {
  const backend = await selectBackend(ctx);
  if (backend === "dsivio") return dsivioModels(ctx.projectRoot, kind, ctx.signal);
  const models = kind === "transcribe" ? [] : await standaloneModels(kind);
  if (!kind || kind === "transcribe") models.push(localAsrModel());
  return models;
}
