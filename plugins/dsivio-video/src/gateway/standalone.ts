import { createHash } from "node:crypto";
import { readFile, open, copyFile, lstat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { AsyncExecutor, ExecuteContext } from "../core/capability.ts";
import { DvError } from "../core/errors.ts";
import { canonicalJson, isPending, isResourceRef } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { imageType, videoType, audioType } from "../modules/media/index.ts";
import { validateAndResolve, withFactsRevision, projectCapabilities } from "./description.ts";
import type { ModelDescription, ModelEntry } from "./description.ts";
import { readRequest, object } from "./request.ts";
import { gatewayHome, readStandaloneConfiguration, privateDirectory } from "./standalone-config.ts";
import type { ProviderConfiguration } from "./standalone-config.ts";
import { StandaloneLedger } from "./standalone-ledger.ts";
import type { StandaloneTask } from "./standalone-ledger.ts";
import { minimaxAdapter } from "./providers/minimax.ts";
import { geminiAdapter } from "./providers/gemini.ts";
import { ProviderFailure } from "./providers/types.ts";
import type { ProviderAdapter, ProviderOutcome, ProviderRequest, StandaloneKind } from "./providers/types.ts";
import { downloadArtifact, redactProviderError } from "./providers/http.ts";
import { saveProviderArtifact, verifySavedOutputs, probeProviderMedia, signatureMime } from "./providers/artifacts.ts";
import type { SavedOutput } from "./providers/artifacts.ts";
import { mediaEntries } from "./providers/description.ts";

export interface StandaloneOptions { home?: string; environment?: NodeJS.ProcessEnv }
const active = new Set<string>();
function adapterFor(configuration: ProviderConfiguration): ProviderAdapter { return configuration.adapter === "minimax" ? minimaxAdapter(configuration) : geminiAdapter(configuration); }
function modelKind(model: string): StandaloneKind { return ["image-01", "gemini-3.1-flash-image"].includes(model) ? "image" : ["MiniMax-H3", "veo-3.1-generate-preview"].includes(model) ? "video" : "speech"; }
export async function standaloneModels(kind?: StandaloneKind, options: StandaloneOptions = {}): Promise<ModelEntry[]> {
  const configurations = await readStandaloneConfiguration(options.home, options.environment); const models: ModelEntry[] = [];
  for (const config of configurations) {
    const adapter = adapterFor(config);
    for (const model of config.enabledModels) {
      const operation = modelKind(model); if (kind && kind !== operation) continue;
      const id = `${config.id}/${model}`; const description = adapter.describe(id, model, operation);
      models.push({ id, providerId: config.id, providerName: config.adapter === "minimax" ? "MiniMax" : "Google Gemini", model, kind: operation, default: !models.some(m => m.kind === operation), known: true, capabilities: projectCapabilities(description), description: withFactsRevision({ ...description, availability: "configured" }) });
    }
  }
  return models;
}
async function select(model: string, kind: StandaloneKind, options: StandaloneOptions): Promise<{ configuration: ProviderConfiguration; adapter: ProviderAdapter; description: ModelDescription }> {
  const slash = model.indexOf("/"); const providerId = model.slice(0, slash); const modelId = model.slice(slash + 1);
  const configurations = await readStandaloneConfiguration(options.home, options.environment); const configuration = configurations.find(c => c.id === providerId);
  if (slash < 1 || !configuration) throw new DvError("GATEWAY_CREDENTIAL_MISSING", `Standalone connection ${providerId || model} is not configured; set its intended env key or private ~/.dsivio-video/gateway.json`);
  if (!configuration.enabledModels.includes(modelId) || modelKind(modelId) !== kind) throw new DvError("GATEWAY_MODEL_DISABLED", `Standalone model ${model} is not explicitly enabled for ${kind}`);
  const adapter = adapterFor(configuration); const description = withFactsRevision({ ...adapter.describe(model, modelId, kind), availability: "configured" }); return { configuration, adapter, description };
}
async function materialize(argumentsMap: Record<string, Json>, description: ModelDescription, ctx: ExecuteContext, providedArguments?: string[]): Promise<Record<string, Json>> {
  const args = structuredClone(argumentsMap);
  for (const [name, descriptor] of Object.entries(description.arguments)) {
    const value = args[name]; if (value === undefined) continue;
    if (descriptor.dataType === "mediaList") {
      const entries = mediaEntries(value);
      for (const entry of entries) {
        if (isPending(entry.source)) throw new DvError("GEN_INPUT_PENDING", "Cannot submit Pending standalone media");
        if (!isResourceRef(entry.source)) throw new DvError("TYPE_INVALID", "Standalone media source must be a ResourceRef, not an authored path or URL");
        const ref = entry.source; const path = ctx.store.pathOf(ref); const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || !isAbsolute(path) || info.size > (descriptor.maxBytes ?? 512 * 1024 * 1024)) throw new DvError("GATEWAY_MEDIA_INVALID", "Standalone media source violates file or byte limits");
        const bytes = await readFile(path); const metadata = await probeProviderMedia(path, ref.mime);
        const signature = signatureMime(bytes);
        if (signature !== ref.mime && !((ref.mime === "audio/mp4" || ref.mime === "video/quicktime") && signature === "video/mp4")) throw new DvError("GATEWAY_MIME_INVALID", "Input bytes contradict the ResourceRef MIME; no provider submission was sent");
        entry.source = path; entry.mime = ref.mime; entry.bytes = bytes.length; entry.sha256 = createHash("sha256").update(bytes).digest("hex");
        for (const [field, measured] of Object.entries(metadata)) if (["width", "height", "duration", "frameRate", "codec", "audioCodecs", "sampleRate", "channels"].includes(field)) entry[field] = measured;
      }
      args[name] = entries;
    } else if (descriptor.resource === true) {
      if (!isResourceRef(value)) throw new DvError("GATEWAY_CONSENT_REQUIRED", "consentAttestation must be an explicitly imported user authorization file");
      const path = ctx.store.pathOf(value); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new DvError("GATEWAY_CONSENT_REQUIRED", "Authorization attestation must be a regular UTF-8 text file at most 1 MiB");
      const bytes = await readFile(path); let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new DvError("GATEWAY_CONSENT_REQUIRED", "Authorization attestation is not valid UTF-8"); }
      if (!text.trim() || text.includes("\0")) throw new DvError("GATEWAY_CONSENT_REQUIRED", "Authorization attestation must contain an explicit nonempty user statement");
      args[name] = path;
    }
  }
  return validateAndResolve(description, args, { materialized: true, providedArguments });
}
async function immutableHash(request: ProviderRequest, snapshot: ModelDescription): Promise<string> {
  const a = structuredClone(request.arguments);
  for (const [name, descriptor] of Object.entries(snapshot.arguments)) {
    if (descriptor.dataType === "mediaList") { for (const entry of mediaEntries(a[name])) entry.source = `sha256:${entry.sha256}`; }
    if (descriptor.resource === true && typeof a[name] === "string") a[name] = `sha256:${createHash("sha256").update(await readFile(a[name])).digest("hex")}`;
  }
  return `sha256:${createHash("sha256").update(canonicalJson({ kind: request.kind, model: request.model, arguments: a, capabilitySnapshot: snapshot as unknown as Json })).digest("hex")}`;
}
async function preserveInputs(task: StandaloneTask, ledger: StandaloneLedger, description: ModelDescription): Promise<void> {
  const inputs = join(ledger.root, task.id, "inputs"); await privateDirectory(inputs); const request = structuredClone(task.request);
  for (const [name, descriptor] of Object.entries(description.arguments)) {
    if (descriptor.dataType === "mediaList") for (const [index, entry] of mediaEntries(request.arguments[name]).entries()) {
      const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "audio/mp4": "m4a", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/ogg": "opus" };
      const source = String(entry.source); const destination = join(inputs, `${name}-${index}.${extensions[String(entry.mime)] ?? "bin"}`);
      if (source !== destination) { await copyFile(source, destination); const file = await open(destination, "r+"); try { await file.chmod(0o600); await file.sync(); } finally { await file.close(); } }
      const bytes = await readFile(destination); if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new DvError("GATEWAY_INPUT_CHANGED", "Input changed after authorization; no provider submission was sent"); entry.source = destination;
    }
    if (descriptor.resource === true && typeof request.arguments[name] === "string") { const destination = join(inputs, `${name}.txt`); if (request.arguments[name] !== destination) { await copyFile(request.arguments[name], destination); const file = await open(destination, "r+"); try { await file.chmod(0o600); await file.sync(); } finally { await file.close(); } } request.arguments[name] = destination; }
  }
  if (request.kind === "transcribe") throw new DvError("GATEWAY_KIND_INVALID", "Cloud executor cannot own local transcription");
  if (await immutableHash({ ...request, kind: request.kind }, description) !== task.requestHash) throw new DvError("GATEWAY_INPUT_CHANGED", "Input or consent changed after plan; no provider submission was sent");
  ledger.change(task.id, current => { current.request = request; });
}
async function finishOutcome(task: StandaloneTask, outcome: ProviderOutcome, ledger: StandaloneLedger, config: ProviderConfiguration, queryToken?: string): Promise<void> {
  const transition = (fn: (current: StandaloneTask) => void, release = false): boolean => {
    const update = (current: StandaloneTask): void => { fn(current); if (release && queryToken) delete current.queryClaim; };
    if (queryToken) return ledger.changeQuery(task.id, queryToken, update);
    let changed = false;
    ledger.change(task.id, current => {
      if (["succeeded", "failed", "rejected", "uncertain", "cancelled"].includes(current.state) || current.queryClaim) return;
      update(current); changed = true;
    });
    return changed;
  };
  if (outcome.state === "accepted") {
    transition(current => {
      if (current.receipt && current.receipt !== outcome.receipt) throw new DvError("GATEWAY_RECEIPT_CHANGED", "Provider returned a different immutable receipt");
      current.state = "accepted"; current.receipt = outcome.receipt; current.acceptedAt ??= new Date().toISOString();
      current.nextPollAt = Date.now() + (outcome.retryAfterMs ?? 10_000); current.queryFailures = 0; delete current.ownerPid; delete current.error;
    }, true);
    return;
  }
  if (outcome.state === "failed" || outcome.state === "cancelled") {
    transition(current => { current.state = outcome.state; current.error = { code: outcome.code, message: outcome.message }; delete current.ownerPid; }, true);
    return;
  }
  if (outcome.state !== "succeeded") throw new DvError("GATEWAY_STATE_INVALID", "Unknown provider completion state");
  if (task.request.kind === "transcribe") throw new DvError("GATEWAY_KIND_INVALID", "Cloud executor cannot download local transcription");
  const mediaKind = task.request.kind === "speech" ? "audio" : task.request.kind;
  const usage: Record<string, Json> = {};
  if (object(outcome.usage)) for (const field of ["success_count", "failed_count", "usage_characters", "usage_voice_count", "word_count", "audio_length", "audio_size", "audio_sample_rate", "audio_channel", "bitrate", "total_seconds", "input_seconds", "output_seconds", "input_image_count", "input_audio_seconds", "total_tokens", "prompt_tokens", "completion_tokens", "totalTokenCount", "promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "cachedContentTokenCount"]) {
    const value = outcome.usage[field]; if (typeof value === "number" && Number.isFinite(value) && value >= 0) usage[field] = value;
  }
  if (!transition(current => {
    if (outcome.receipt) { if (current.receipt && current.receipt !== outcome.receipt) throw new DvError("GATEWAY_RECEIPT_CHANGED", "Provider completion changed the saved receipt"); current.receipt = outcome.receipt; }
    current.acceptedAt ??= new Date().toISOString(); if (Object.keys(usage).length) current.usage = usage;
  })) return;
  const outputs: SavedOutput[] = [];
  for (let i = 0; i < outcome.outputs.length; i++) {
    const output = outcome.outputs[i]!; const media = "bytes" in output ? output : await downloadArtifact(config, config.adapter, output.url, mediaKind);
    const directory = queryToken ? join(ledger.root, task.id, "outputs", queryToken) : join(ledger.root, task.id, "outputs");
    outputs.push(await saveProviderArtifact(directory, i, media.bytes, media.mime, mediaKind));
  }
  if (!outputs.length) throw new DvError("GATEWAY_OUTPUT_MISSING", "Provider returned no outputs");
  if (!transition(current => { current.outputs = outputs; current.stage = "synthesized"; })) return;
  if (task.request.arguments.mode === "clone") ledger.voice(task.providerId, `Dv${task.id.replaceAll("-", "")}`, task.id, createHash("sha256").update(await readFile(String(task.request.arguments.consentAttestation))).digest("hex"), true);
  transition(current => { current.state = "succeeded"; current.stage = "downloaded"; delete current.ownerPid; delete current.error; }, true);
}
async function submitClaimed(task: StandaloneTask, ledger: StandaloneLedger, configuration: ProviderConfiguration, adapter: ProviderAdapter, description: ModelDescription): Promise<void> {
  active.add(task.id);
  try {
    await preserveInputs(task, ledger, description); task = ledger.get(task.id);
    if (task.request.kind === "transcribe") throw new DvError("GATEWAY_KIND_INVALID", "Cloud adapter cannot submit transcription");
    const providerRequest: ProviderRequest = { ...task.request, kind: task.request.kind };
    const authorizationHash = task.request.arguments.mode === "clone" ? createHash("sha256").update(await readFile(String(task.request.arguments.consentAttestation))).digest("hex") : undefined;
    if (typeof task.request.arguments.voice === "string") ledger.checkVoice(task.providerId, task.request.arguments.voice);
    const outcome = await adapter.submit(providerRequest, { taskId: task.id, stages: { ...task.stages }, stage(name, receipt) {
      ledger.stage(task.id, name, receipt);
      if (name === "cloned" && authorizationHash) ledger.voice(task.providerId, `Dv${task.id.replaceAll("-", "")}`, task.id, authorizationHash);
    } });
    await finishOutcome(task, outcome, ledger, configuration);
  } catch (error) {
    const current = ledger.get(task.id); const wasSent = current.stage.endsWith("-submitting") || current.acceptedAt !== undefined || Object.keys(current.stages).some(name => name.startsWith("uploaded") || name === "cloned");
    if (["succeeded", "failed", "rejected", "uncertain", "cancelled"].includes(current.state) || current.queryClaim) return;
    const code = error instanceof DvError || error instanceof ProviderFailure ? error.code : "GATEWAY_PROVIDER_FAILED";
    const message = redactProviderError(error instanceof Error ? error.message : "Standalone provider failed", configuration.apiKey);
    ledger.change(task.id, value => { if (["succeeded", "failed", "rejected", "uncertain", "cancelled"].includes(value.state) || value.queryClaim) return; value.state = error instanceof ProviderFailure ? error.disposition === "rejected" ? "rejected" : error.disposition === "query" ? "failed" : "uncertain" : wasSent ? "uncertain" : "rejected"; value.error = { code, message }; delete value.ownerPid; });
  } finally { active.delete(task.id); }
}
export interface StandaloneSubmissionLink { handle: Json; task: string; receipt?: string }
export async function recoverStandaloneSubmission(kind: StandaloneKind, data: Json, ctx: ExecuteContext, options: StandaloneOptions = {}): Promise<StandaloneSubmissionLink | null> {
  const request = readRequest(data, kind);
  if (request.backend !== "standalone") return null;
  const providerId = request.model.split("/")[0]!;
  const ledger = await StandaloneLedger.openExisting(join(options.home ?? gatewayHome(), "gateway"));
  if (!ledger) return null;
  try {
    const task = ledger.find(providerId, ctx.idempotencyKey); if (!task) return null;
    if (task.request.kind !== kind || `${task.providerId}/${task.request.model}` !== request.model) throw new DvError("IDEMPOTENCY_CONFLICT", "Recovery key belongs to another immutable operation");
    if (!object(request.capabilitySnapshot)) throw new DvError("GATEWAY_SNAPSHOT_REQUIRED", "Recovery requires the Build's frozen description");
    const snapshot = request.capabilitySnapshot as unknown as ModelDescription;
    const argumentsMap = await materialize(request.arguments, snapshot, ctx, request.providedArguments);
    const hash = await immutableHash({ kind, model: task.request.model, arguments: argumentsMap }, snapshot);
    if (hash !== task.requestHash) throw new DvError("IDEMPOTENCY_CONFLICT", "Recovered account task has a different immutable request hash");
    return { handle: { taskId: task.id, providerId: task.providerId, kind }, task: task.id, ...(task.receipt ? { receipt: task.receipt } : {}) };
  } finally { ledger.close(); }
}

export function standaloneExecutor(kind: StandaloneKind, options: StandaloneOptions = {}): AsyncExecutor & { recover(data: Json, ctx: ExecuteContext): Promise<StandaloneSubmissionLink | null> } {
  const home = options.home ?? gatewayHome();
  return {
    kind: "async",
    async recover(data, ctx) { return recoverStandaloneSubmission(kind, data, ctx, options); },
    async submit(data, ctx) {
      if (ctx.signal.aborted) throw new DvError("ABORTED", "Standalone submission was cancelled before acceptance");
      const request = readRequest(data, kind); if (request.backend !== "standalone") throw new DvError("GATEWAY_BACKEND_CHANGED", "A Build must explicitly retain the standalone backend chosen during plan");
      const selected = await select(request.model, kind, options); const snapshot = request.capabilitySnapshot as unknown as ModelDescription | undefined;
      if (!snapshot || snapshot.factsRevision !== selected.description.factsRevision) throw new DvError("MODEL_DESCRIPTION_CHANGED", "Standalone adapter, connection or model facts changed; replan before spending");
      const args = await materialize(request.arguments, selected.description, ctx, request.providedArguments); const providerRequest: ProviderRequest = { kind, model: request.model.split("/").slice(1).join("/"), arguments: args }; const hash = await immutableHash(providerRequest, selected.description);
      const ledger = await StandaloneLedger.open(join(home, "gateway"));
      try { const task = ledger.prepare(selected.configuration.id, ctx.idempotencyKey, hash, selected.adapter.version, providerRequest); ledger.change(task.id, current => { current.capabilitySnapshot ??= selected.description as unknown as Json; current.providedArguments ??= request.providedArguments; }); if (ledger.claim(task.id)) await submitClaimed(task, ledger, selected.configuration, selected.adapter, selected.description); const current = ledger.get(task.id); return { handle: { taskId: task.id, kind, providerId: task.providerId }, task: task.id, ...(current.receipt ? { receipt: current.receipt } : {}) }; }
      finally { ledger.close(); }
    },
    async poll(handle, ctx) {
      if (!object(handle) || typeof handle.taskId !== "string" || handle.kind !== kind || typeof handle.providerId !== "string") throw new DvError("GATEWAY_HANDLE_INVALID", "Invalid standalone task handle");
      const ledger = await StandaloneLedger.open(join(home, "gateway"));
      try {
        let task = ledger.get(handle.taskId); if (task.providerId !== handle.providerId || task.request.kind !== kind) throw new DvError("GATEWAY_HANDLE_INVALID", "Standalone handle does not match ledger task");
        if (!active.has(task.id) && ["submitting", "accepted"].includes(task.state) && task.stage === "synthesized" && task.outputs.length) {
          await verifySavedOutputs(task.outputs);
          if (task.request.arguments.mode === "clone") ledger.voice(task.providerId, `Dv${task.id.replaceAll("-", "")}`, task.id, createHash("sha256").update(await readFile(String(task.request.arguments.consentAttestation))).digest("hex"), true);
          task = ledger.change(task.id, current => { if (!["submitting", "accepted"].includes(current.state) || current.stage !== "synthesized") return; current.state = "succeeded"; current.stage = "downloaded"; delete current.ownerPid; delete current.queryClaim; delete current.error; });
        }
        if (!active.has(task.id) && (task.state === "prepared" || task.state === "submitting")) {
          const selected = await select(`${task.providerId}/${task.request.model}`, kind, options);
          if (selected.adapter.version !== task.adapterVersion || object(task.capabilitySnapshot) && task.capabilitySnapshot.factsRevision !== selected.description.factsRevision) throw new DvError("MODEL_DESCRIPTION_CHANGED", "Saved task adapter or connection facts changed; no resubmission is permitted");
          if (ledger.claim(task.id)) await submitClaimed(task, ledger, selected.configuration, selected.adapter, selected.description); task = ledger.get(task.id);
        }
        if (task.state === "accepted") {
          const selected = await select(`${task.providerId}/${task.request.model}`, kind, options);
          if (selected.adapter.version !== task.adapterVersion || object(task.capabilitySnapshot) && task.capabilitySnapshot.factsRevision !== selected.description.factsRevision) throw new DvError("MODEL_DESCRIPTION_CHANGED", "Stored receipt requires the immutable adapter and connection");
          if (selected.configuration.adapter === "minimax" && Date.now() - Date.parse(task.acceptedAt ?? task.createdAt) > 7 * 86400_000) { ledger.change(task.id, current => { if (current.state !== "accepted") return; current.state = "failed"; delete current.queryClaim; current.error = { code: "GATEWAY_RECEIPT_EXPIRED", message: "MiniMax 7-day query window expired; receipt retained, no regeneration" }; }); }
          else if ((task.nextPollAt ?? 0) <= Date.now()) {
            const queryToken = ledger.claimQuery(task.id);
            if (queryToken) try {
              if (!task.receipt) throw new DvError("GATEWAY_RECEIPT_INVALID", "Accepted video task lacks a receipt");
              const outcome = await selected.adapter.poll(task.receipt, { ...task.request, kind });
              await finishOutcome(task, outcome, ledger, selected.configuration, queryToken);
            } catch (error) {
              ledger.changeQuery(task.id, queryToken, current => {
                current.queryFailures++; const transient = error instanceof ProviderFailure && (/HTTP_(429|5\d\d)/.test(error.code) || error.code === "GATEWAY_TRANSPORT_FAILED");
                current.error = { code: error instanceof ProviderFailure || error instanceof DvError ? error.code : "GATEWAY_QUERY_FAILED", message: redactProviderError(error instanceof Error ? error.message : "Provider query failed", selected.configuration.apiKey) };
                if (!transient || current.queryFailures >= 4) current.state = "failed"; else current.nextPollAt = Date.now() + Math.max(error.retryAfterMs ?? 10_000, 10_000 * 2 ** current.queryFailures);
                delete current.queryClaim;
              });
            }
          }
          task = ledger.get(task.id);
        }
        const receipt = task.receipt ? { receipt: task.receipt } : {};
        if (task.state === "succeeded") { await verifySavedOutputs(task.outputs); const output = task.outputs[0]; if (!output) throw new DvError("GATEWAY_OUTPUT_MISSING", "Successful task has no primary artifact"); const resource = await ctx.store.putFile(output.path, output.mime); return { state: "done", value: { type: kind === "image" ? imageType : kind === "video" ? videoType : audioType, data: { ...resource } }, ...receipt }; }
        if (["rejected", "uncertain", "failed", "cancelled"].includes(task.state)) return { state: "failed", code: task.error?.code ?? "GATEWAY_CANCELLED", message: task.error?.message ?? "Standalone task was cancelled", charged: task.state === "rejected" || task.state === "cancelled" && task.cancellation?.charged === "no" ? "no" : "maybe", ...receipt };
        return { state: "pending", retryAfterMs: Math.max(10_000, (task.nextPollAt ?? 0) - Date.now()), progress: task.stage, ...receipt };
      } finally { ledger.close(); }
    },
    async cancel(handle) {
      if (!object(handle) || typeof handle.taskId !== "string" || handle.kind !== kind) throw new DvError("GATEWAY_HANDLE_INVALID", "Invalid standalone cancellation handle");
      const ledger = await StandaloneLedger.open(join(home, "gateway"));
      try { const task = ledger.change(handle.taskId, current => { if (current.request.kind !== kind || current.providerId !== handle.providerId) throw new DvError("GATEWAY_HANDLE_INVALID", "Cancellation handle does not match account task"); if (current.cancellation) return; const beforeSubmit = ["prepared", "submitting"].includes(current.state) && current.stage === "prepared"; const late = ["succeeded", "failed", "rejected", "cancelled"].includes(current.state); current.cancellation = { requestedAt: new Date().toISOString(), outcome: beforeSubmit ? "confirmed" : late ? "too-late" : "unsupported", scope: beforeSubmit ? "local" : "none", charged: beforeSubmit ? "no" : "unknown" }; if (beforeSubmit) { current.state = "cancelled"; current.stage = "cancelled"; delete current.ownerPid; } }); return task.cancellation!.outcome; }
      finally { ledger.close(); }
    },
  };
}
