import { copyFile, mkdir, open, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { DvError } from "../core/errors.ts";
import type { AsyncExecutor, ExecuteContext } from "../core/capability.ts";
import type { Json } from "../core/value.ts";
import { canonicalJson, isResourceRef } from "../core/value.ts";
import { parseAsrReply } from "./client.ts";
import type { AsrReply } from "./client.ts";
import { asrRuntime } from "./service.ts";
import { asrStatus, installAsr } from "./install.ts";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, WHISPERX_VERSION } from "./install.ts";
import { withFactsRevision } from "../gateway/description.ts";
import type { ModelEntry } from "../gateway/description.ts";
import { object, readRequest } from "../gateway/request.ts";
import { selectBackend } from "../gateway/backend.ts";
import { runDsivio, parseReply } from "../gateway/dsivio.ts";
import { validateRequest } from "../gateway/validate.ts";
import { evidenceFromReply } from "../pipeline/capabilities.ts";
import { pipelineTypes } from "../pipeline/types.ts";
import { gatewayCapabilities } from "../gateway/index.ts";
import { StandaloneLedger } from "../gateway/standalone-ledger.ts";
import { gatewayHome } from "../gateway/standalone-config.ts";
import { gatewayConfig } from "../gateway/backend.ts";
import { standardWavSamples } from "./wav.ts";
async function asrRequestHash(request: string, audioPath: string): Promise<string> {
  const audio = createHash("sha256");
  for await (const bytes of createReadStream(audioPath)) audio.update(bytes);
  return `sha256:${createHash("sha256").update(canonicalJson({ request, audioSha256: audio.digest("hex") })).digest("hex")}`;
}
export function localAsrModel(): ModelEntry {
  const description = withFactsRevision({ descriptionVersion: 1, identity: "local/whisperx-small", operation: "transcribe", factsComplete: true, arguments: {
    audioFile: { dataType: "string" as const, required: true, resource: true, transport: { optionKey: "audioFile", encoding: "options-json" } },
    language: { dataType: "string" as const, required: true, minLength: 2, maxLength: 3, transport: { optionKey: "language", encoding: "options-json" } },
    sampleFrames: { dataType: "integer" as const, minimum: 1, maximum: Number.MAX_SAFE_INTEGER, transport: { optionKey: "sampleFrames", encoding: "options-json" } },
    timestamps: { dataType: "string" as const, allowed: ["word", "segment"], defaultValue: "word", transport: { optionKey: "timestamps", encoding: "options-json" } },
  }, constraints: [], products: { mediaKind: "json", ordered: true, countMeaning: "exact", minCount: 1, maxCount: 1, mimeTypes: ["application/json"] }, lifecycle: { submission: "synchronous", remoteCancel: "unsupported" }, billingInfo: null, adapterVersion: ASR_SERVICE_VERSION });
  return { id: description.identity, providerId: "local", providerName: "Local WhisperX", model: "whisperx-small", kind: "transcribe", default: true, known: true, capabilities: null, description };
}
export async function transcriptFromTask(task: Record<string, Json>, language: string, sampleFrames: number): Promise<AsrReply> {
  if (task.kind !== "transcribe" || task.status !== "succeeded") throw new DvError("ASR_RESPONSE_INVALID", "Expected a succeeded transcribe MediaTask");
  let result: unknown = task.result;
  if (result === null || result === undefined) {
    const output = Array.isArray(task.outputs) ? task.outputs.find(item => object(item) && item.mime === "application/json" && typeof item.path === "string") : undefined;
    if (!object(output) || typeof output.path !== "string") throw new DvError("ASR_RESPONSE_INVALID", "Transcription task has no JSON evidence");
    try { result = JSON.parse(await readFile(output.path, "utf8")); } catch (error) { throw new DvError("ASR_RESPONSE_INVALID", "Cannot read transcript evidence", { cause: error }); }
  }
  const reply = parseAsrReply(result);
  if (reply.schema !== "dsivio.media.transcript/1" || reply.language !== language || reply.sampleRate !== 16000 || reply.sampleFrames !== sampleFrames) throw new DvError("ASR_RESPONSE_INVALID", "Transcript schema/language/sample count differs from input");
  return reply;
}
export const localTranscribeExecutor: AsyncExecutor = {
  kind: "async", async submit(data, ctx) {
    const request = readRequest(data, "transcribe");
    if (request.backend !== "standalone" || !object(request.capabilitySnapshot) || request.capabilitySnapshot.factsRevision !== localAsrModel().description.factsRevision) throw new DvError("MODEL_DESCRIPTION_CHANGED", "Local ASR descriptor changed; replan");
    if (isResourceRef(request.arguments.audioFile)) request.arguments.audioFile = ctx.store.pathOf(request.arguments.audioFile);
    const resolved = validateRequest(request, true), args = resolved.arguments;
    if (typeof args.audioFile !== "string" || typeof args.language !== "string" || !/^[a-z]{2,3}$/.test(args.language) || ["auto", "und"].includes(args.language)) throw new DvError("ASR_INPUT_INVALID", "Local transcription requires standard WAV and explicit language");
    const samples = await standardWavSamples(args.audioFile);
    if (samples === undefined || (args.sampleFrames !== undefined && args.sampleFrames !== samples)) throw new DvError("ASR_INPUT_INVALID", "WAV must exactly match 16kHz mono PCM s16 sample frames");
    args.sampleFrames = samples;
    const normalized = validateRequest(resolved, true);
    const requestHash = await asrRequestHash(normalized.requestHash!, args.audioFile);
    const root = join(gatewayHome(), "gateway"), ledger = await StandaloneLedger.open(root);
    let preparedId: string | undefined;
    try {
      const task = ledger.prepare("local", ctx.idempotencyKey, requestHash, ASR_SERVICE_VERSION, { kind: "transcribe", model: request.model, arguments: args });
      preparedId = task.id;
      if (task.state === "prepared" && ledger.claim(task.id)) {
        ledger.change(task.id, current => { current.stage = "local-evidence"; });
        const evidence = join(root, "outputs", task.id);
        await mkdir(evidence, { recursive: true, mode: 0o700 });
        const audio = join(evidence, "audio.wav");
        await copyFile(args.audioFile, audio);
        if (await asrRequestHash(normalized.requestHash!, audio) !== requestHash) throw new DvError("ASR_INPUT_CHANGED", "Audio changed during adoption; replan the immutable input");
        const config = await gatewayConfig(ctx.projectRoot);
        ledger.change(task.id, current => { current.stages.audioPath = audio; current.capabilitySnapshot = request.capabilitySnapshot; current.providedArguments = resolved.providedArguments; current.stages.asrConfig = config.asr ?? {}; });
        const log = await open(join(evidence, "worker.log"), "a", 0o600);
        try {
          const env = Object.fromEntries(["HOME", "USERPROFILE", "PATH", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "DSIVIO_VIDEO_FFMPEG", "DSIVIO_VIDEO_FFPROBE"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
          const child = spawn(process.execPath, [fileURLToPath(new URL("./task-worker.ts", import.meta.url)), root, task.id], { cwd: ctx.projectRoot, env, detached: true, stdio: ["ignore", log.fd, log.fd] });
          await once(child, "spawn");
          ledger.change(task.id, current => { current.ownerPid = child.pid; current.stage = "local-starting"; });
          child.unref();
        } finally { await log.close(); }
      }
      return { handle: { taskId: task.id, root, language: args.language, sampleFrames: samples }, task: task.id };
    } catch (error) {
      if (preparedId) {
        const current = ledger.get(preparedId);
        if (current.state === "submitting" && current.ownerPid === process.pid) ledger.change(preparedId, row => { row.state = "failed"; row.error = { code: error instanceof DvError ? error.code : "ASR_START_FAILED", message: error instanceof Error ? error.message : "Local ASR task could not start" }; });
      }
      throw error;
    } finally { ledger.close(); }
  }, async recover(data, ctx) {
    const request = readRequest(data, "transcribe");
    if (request.backend !== "standalone" || !object(request.capabilitySnapshot)) return null;
    if (isResourceRef(request.arguments.audioFile)) request.arguments.audioFile = ctx.store.pathOf(request.arguments.audioFile);
    const resolved = validateRequest(request, true), root = join(gatewayHome(), "gateway"), ledger = await StandaloneLedger.openExisting(root);
    if (!ledger) return null;
    try {
      const task = ledger.find("local", ctx.idempotencyKey);
      if (!task || task.state === "prepared") return null;
      if (typeof resolved.arguments.audioFile !== "string") throw new DvError("ASR_TASK_INVALID", "Frozen ASR request has no materialized audio path");
      if (resolved.arguments.sampleFrames === undefined) { const frames = await standardWavSamples(resolved.arguments.audioFile); if (frames === undefined) throw new DvError("ASR_INPUT_INVALID", "Recovery requires the same standard WAV evidence"); resolved.arguments.sampleFrames = frames; }
      const normalized = validateRequest(resolved, true);
      if (task.requestHash !== await asrRequestHash(normalized.requestHash!, resolved.arguments.audioFile) || task.request.model !== request.model) throw new DvError("IDEMPOTENCY_CONFLICT", "Durable ASR task does not match the frozen request and materialized audio");
      const { language, sampleFrames } = task.request.arguments;
      if (typeof language !== "string" || typeof sampleFrames !== "number") throw new DvError("ASR_TASK_INVALID", "Durable ASR task has invalid evidence facts");
      return { handle: { taskId: task.id, root, language, sampleFrames }, task: task.id };
    } finally { ledger.close(); }
  }, async poll(handle) {
    if (!object(handle) || typeof handle.root !== "string" || typeof handle.taskId !== "string" || typeof handle.language !== "string" || typeof handle.sampleFrames !== "number") throw new DvError("GATEWAY_HANDLE_INVALID", "Invalid local ASR handle");
    const ledger = await StandaloneLedger.open(handle.root);
    try {
      const task = ledger.get(handle.taskId);
      if (task.state === "cancelled") return { state: "cancelled" };
      if (["failed", "uncertain", "rejected"].includes(task.state)) return { state: "failed", code: task.error?.code ?? "ASR_FAILED", message: task.error?.message ?? "Local transcription failed", charged: "no" };
      if (task.state !== "succeeded") {
        if (task.ownerPid) { try { process.kill(task.ownerPid, 0); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") { ledger.change(task.id, current => { current.state = "failed"; current.error = { code: "ASR_OWNER_EXITED", message: "Local ASR worker exited without a result" }; }); return { state: "failed", code: "ASR_OWNER_EXITED", message: "Local ASR worker exited without a result", charged: "no" }; } } }
        return { state: "pending", retryAfterMs: 500, progress: task.stage };
      }
      const reply = await transcriptFromTask({ kind: "transcribe", status: "succeeded", result: task.result ?? null, outputs: task.outputs as unknown as Json }, handle.language, handle.sampleFrames);
      return { state: "done", value: { type: pipelineTypes.evidence, data: evidenceFromReply(reply, handle.sampleFrames, handle.language, `whisperx/${reply.engine?.whisperxVersion};asr/${reply.engine?.serviceVersion}`) as unknown as Json } };
    } finally { ledger.close(); }
  }, async cancel(handle) {
    if (!object(handle) || typeof handle.root !== "string" || typeof handle.taskId !== "string") throw new DvError("GATEWAY_HANDLE_INVALID", "Invalid local ASR handle");
    const ledger = await StandaloneLedger.open(handle.root);
    try { const task = ledger.get(handle.taskId); if (task.state === "cancelled") return "confirmed"; if (["succeeded", "failed", "rejected", "uncertain"].includes(task.state)) return "too-late"; ledger.change(task.id, current => { current.stages.cancelRequestedAt = new Date().toISOString(); }); return "requested"; } finally { ledger.close(); }
  },
};
export async function transcribeAudio(audioPath: string, language: string, sampleFrames: number, projectRoot: string, workDir: string, model = "local/whisperx-small"): Promise<{ reply: AsrReply; engine: string }> {
  const capability = gatewayCapabilities.find(item => item.name === "gateway/transcribe")!;
  const resolution = await capability.resolve({ model, arguments: { audioFile: audioPath, language, sampleFrames, timestamps: "word" } }, { projectRoot });
  if (!resolution.ok) throw new DvError(resolution.code, resolution.reason);
  if (capability.executor.kind !== "async") throw new DvError("EXECUTOR_INVALID", "Transcribe requires task executor");
  const ctx: ExecuteContext = { buildId: "cli", commandKey: "transcribe", idempotencyKey: `cli/${randomUUID()}`, projectRoot, workDir, signal: AbortSignal.timeout(600_000), store: { pathOf: () => { throw new DvError("RESOURCE_INVALID", "CLI has no resource refs"); }, putFile: async () => { throw new DvError("RESOURCE_INVALID", "CLI transcribe does not import media outputs"); } }, log: line => process.stderr.write(`${line}\n`) };
  const submitted = await capability.executor.submit(resolution.request, ctx);
  const wrapper = object(submitted.handle) ? submitted.handle : {};
  if (resolution.backend === "standalone" && object(wrapper.inner) && typeof wrapper.inner.root === "string" && typeof wrapper.inner.taskId === "string") {
    for (;;) {
      const polled = await localTranscribeExecutor.poll(wrapper.inner, ctx);
      if (polled.state === "cancelled") throw new DvError("GATEWAY_CANCELLED", "Local transcription was cancelled");
      if (polled.state === "failed") throw new DvError(polled.code, polled.message);
      if (polled.state === "done") {
        const ledger = await StandaloneLedger.open(wrapper.inner.root);
        try { const task = ledger.get(wrapper.inner.taskId), reply = await transcriptFromTask({ kind: "transcribe", status: "succeeded", result: task.result ?? null, outputs: task.outputs as unknown as Json }, language, sampleFrames); return { reply, engine: `local-whisperx ${reply.engine?.model}` }; } finally { ledger.close(); }
      }
      await sleep(polled.retryAfterMs);
    }
  }
  const inner = object(wrapper.inner) ? wrapper.inner : {};
  if (typeof inner.taskId !== "string") throw new DvError("GATEWAY_HANDLE_INVALID", "Transcription has no task id");
  // Temporary audio stays alive through the terminal task. Unreachable App never causes backend fallback.
  for (;;) {
    const response = await runDsivio(["media", "status", inner.taskId, "--json"], projectRoot);
    if (response.code === 6) { await sleep(2000); continue; }
    const task = parseReply(response.stdout);
    if (task.status === "cancelled") throw new DvError("GATEWAY_CANCELLED", `Transcription task ${inner.taskId} was cancelled`);
    if (task.status === "failed") throw new DvError("GATEWAY_FAILED", typeof task.error === "string" ? task.error : `Transcription task ${inner.taskId} failed`);
    if (task.status === "succeeded") { const reply = await transcriptFromTask(task, language, sampleFrames); if (!reply.engine) throw new DvError("ASR_RESPONSE_INVALID", "Transcript has no engine identity"); return { reply, engine: `${reply.engine.backend}/${reply.engine.model};${reply.engine.protocol}${reply.engine.serviceVersion ? `;asr/${reply.engine.serviceVersion}` : ""}` }; }
    if (task.status !== "running") throw new DvError("ASR_RESPONSE_INVALID", "Invalid transcription status");
    await sleep(1000);
  }
}
export async function asrOwnerStatus(projectRoot: string): Promise<Record<string, Json>> {
  const owner = await selectBackend({ projectRoot });
  if (owner === "standalone") return { owner, ...await asrStatus(), runtime: asrRuntime() } as unknown as Record<string, Json>;
  const response = await runDsivio(["media", "asr", "status", "--json"], projectRoot);
  if (response.code !== 0) throw new DvError(response.code === 6 ? "GATEWAY_UNAVAILABLE" : "ASR_STATUS_FAILED", response.stderr || response.stdout);
  return { owner, ...parseReply(response.stdout) };
}
export async function installOwnedAsr(projectRoot: string, model = "small"): Promise<Record<string, Json>> {
  const owner = await selectBackend({ projectRoot });
  if (owner === "standalone") return { owner, ...await installAsr({ model, onProgress: line => process.stderr.write(`${line}\n`) }) } as unknown as Record<string, Json>;
  const response = await runDsivio(["media", "asr", "install", "--model", model, "--language", "en", "--language", "zh", "--json"], projectRoot);
  if (response.code !== 0) throw new DvError(response.code === 6 ? "GATEWAY_UNAVAILABLE" : "ASR_INSTALL_FAILED", response.stderr || response.stdout);
  return { owner, ...parseReply(response.stdout) };
}
