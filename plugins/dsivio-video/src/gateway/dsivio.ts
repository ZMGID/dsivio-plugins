import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dsivioCommand } from "../tools/dsivio.ts";
import { DvError } from "../core/errors.ts";
import type { AsyncExecutor } from "../core/capability.ts";
import { isPending, isResourceRef } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { imageType, videoType, audioType } from "../modules/media/index.ts";
import { object, readRequest } from "./request.ts";
import type { MediaKind } from "./request.ts";
import { validateRequest } from "./validate.ts";
import { dsivioModels } from "./backend.ts";
import { readProbe } from "../pipeline/inspect.ts";
import { pipelineTypes } from "../pipeline/types.ts";
import { evidenceFromReply } from "../pipeline/capabilities.ts";
import { transcriptFromTask } from "../asr/backend.ts";

async function measuredMedia(path: string, declaredMime: string | undefined, signal: AbortSignal): Promise<Record<string, Json>> {
  const remote = /^https:\/\//.test(path), probe = await readProbe(path, signal);
  const streams = Array.isArray(probe.streams) ? probe.streams.filter(object) : [], video = streams.find(stream => stream.codec_type === "video"), audio = streams.filter(stream => stream.codec_type === "audio"), stream = video ?? audio[0], format = object(probe.format) ? probe.format : {};
  const formatName = typeof format.format_name === "string" ? format.format_name : "", names = formatName.split(",");
  const imageMimes: Record<string, string> = { png_pipe: "image/png", jpeg_pipe: "image/jpeg", webp_pipe: "image/webp", gif: "image/gif", apng: "image/png" };
  const audioMimes: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac" };
  const mime = imageMimes[formatName] ?? audioMimes[formatName] ?? (names.includes("mp4") ? video ? "video/mp4" : "audio/mp4" : names.includes("webm") ? video ? "video/webm" : "audio/webm" : declaredMime);
  const size = remote ? Number(format.size) : (await stat(path)).size, duration = Number(format.duration), rate = typeof stream?.avg_frame_rate === "string" ? stream.avg_frame_rate.split("/").map(Number) : [];
  return { ...(Number.isSafeInteger(size) && size >= 0 ? { bytes: size } : {}), ...(mime ? { mime } : {}), ...(typeof stream?.codec_name === "string" ? { codec: stream.codec_name } : {}), audioCodecs: audio.flatMap(stream => typeof stream.codec_name === "string" ? [stream.codec_name] : []), ...(typeof video?.width === "number" && typeof video.height === "number" ? { width: video.width, height: video.height } : {}), ...(rate.length === 2 && rate[1] && Number.isFinite(rate[0]! / rate[1]) ? { frameRate: rate[0]! / rate[1] } : {}), ...(format.duration !== undefined && Number.isFinite(duration) ? { duration } : {}) };
}

export async function runDsivio(args: string[], projectRoot: string, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  if (signal?.aborted) throw new DvError("ABORTED", "Dsivio command was interrupted", { cause: signal.reason });
  const command = await dsivioCommand();
  const windowsCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const quote = (arg: string): string => `"${arg.replace(/(["%^&|<>])/g, "^$1")}"`;
  const child = windowsCmd
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`], { cwd: projectRoot, signal, windowsVerbatimArguments: true })
    : spawn(command, args, { cwd: projectRoot, signal });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data: string) => { stdout += data; });
  child.stderr.on("data", (data: string) => { stderr += data; });
  try {
    const [code] = await once(child, "close");
    return { code: typeof code === "number" ? code : -1, stdout, stderr };
  } catch (error) {
    // A killed submit may already have been accepted remotely. Never classify
    // interruption as safe-to-requeue gateway unavailability.
    if (error instanceof Error && (error.name === "AbortError" || ("code" in error && error.code === "ABORT_ERR"))) throw new DvError("ABORTED", "Dsivio command was interrupted; submission may have been accepted", { cause: error });
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new DvError("GATEWAY_UNAVAILABLE", `Dsivio command was not found; open Dsivio: ${String(error)}`, { cause: error });
    throw new DvError("GATEWAY_COMMAND_FAILED", `Cannot run Dsivio: ${String(error)}`, { cause: error });
  }
}

export function parseReply(stdout: string): Record<string, Json> {
  let data: Json;
  try { data = JSON.parse(stdout.trim()) as Json; }
  catch (error) { throw new DvError("GATEWAY_RESPONSE_INVALID", "Dsivio did not return one JSON reply", { cause: error }); }
  if (!object(data)) throw new DvError("GATEWAY_RESPONSE_INVALID", "Dsivio reply must be a JSON object");
  return data;
}

export function dsivioExecutor(kind: MediaKind): AsyncExecutor {
  const retryAfterMs = kind === "image" ? 5_000 : 10_000;
  return {
    kind: "async",
    async submit(data, ctx) {
      let request = readRequest(data, kind);
      if (request.backend !== "dsivio" || !object(request.capabilitySnapshot)) throw new DvError("GATEWAY_BACKEND_INVALID", "Missing fixed Dsivio snapshot");
      const models = await dsivioModels(ctx.projectRoot, kind, ctx.signal);
      const model = models.find(entry => entry.id === request.model);
      if (!model?.description || model.description.factsRevision !== request.capabilitySnapshot.factsRevision) throw new DvError("MODEL_DESCRIPTION_CHANGED", "Model facts changed; replan before submitting");
      const wire: Record<string, Json> = {};
      const measured: Record<string, Json> = {};
      for (const [name, value] of Object.entries(request.arguments)) {
        if (isPending(value)) {
          if (model.description.arguments[name]?.derivedFrom !== undefined && !request.providedArguments?.includes(name)) { measured[name] = value; continue; }
          throw new DvError("GEN_INPUT_PENDING", `Cannot submit Pending ${name}`);
        }
        if (isResourceRef(value)) { wire[name] = ctx.store.pathOf(value); measured[name] = wire[name]!; }
        else if (Array.isArray(value)) {
          const list: Json[] = [], checks: Json[] = [];
          for (const raw of value) {
            if (!object(raw) || raw.source === undefined) throw new DvError("MODEL_ARGUMENT_INVALID", `${name} requires media entries`);
            if (isPending(raw.source)) throw new DvError("GEN_INPUT_PENDING", "Cannot submit Pending media");
            const path = isResourceRef(raw.source) ? ctx.store.pathOf(raw.source) : raw.source;
            if (typeof path !== "string") throw new DvError("MODEL_ARGUMENT_INVALID", "Invalid media source");
            list.push({ source: path, attributes: raw.attributes ?? {} });
            const metadata = model.description.arguments[name]?.opaqueSources === true ? {} : await measuredMedia(path, isResourceRef(raw.source) ? raw.source.mime : undefined, ctx.signal);
            checks.push({ source: path, attributes: raw.attributes ?? {}, ...metadata });
          }
          wire[name] = list; measured[name] = checks;
        } else { wire[name] = value; measured[name] = value; }
      }
      request = validateRequest({ ...request, arguments: measured }, true);
      await mkdir(ctx.workDir, { recursive: true });
      const options = join(ctx.workDir, "options.json");
      const canonicalWire: Record<string, Json> = {};
      const provided = new Set(request.providedArguments);
      for (const [name, value] of Object.entries(request.arguments)) {
        // Revision pins implicit values on the host; sending them would falsely mark defaults as authored.
        if (model.description.legacyPublic !== true && !provided.has(name)) continue;
        const descriptor = model.description.arguments[name]!, output = descriptor.dataType === "mediaList" || descriptor.resource === true ? wire[name] ?? value : value;
        canonicalWire[descriptor.transport?.optionKey ?? name] = output;
      }
      // Keep metadata private to validation. Public media entries contain only source and authored attributes.
      const args = ["media", kind, "--no-wait", "--model", request.model, "--idempotency-key", ctx.idempotencyKey, "--source", "dsivio-video", "--json"];
      if (model.description.legacyPublic === true) {
        const extras: Record<string, Json> = {};
        for (const [name, value] of Object.entries(canonicalWire)) {
          const descriptor = model.description.arguments[name]!, transport = descriptor.transport;
          if (transport?.optionKey) { extras[transport.optionKey] = value; continue; }
          if (!transport?.flag) throw new DvError("MODEL_DESCRIPTION_UNAVAILABLE", "Legacy host has no public transport for this parameter");
          if (descriptor.dataType === "mediaList") { for (const entry of value as Json[]) { if (!object(entry) || typeof entry.source !== "string") throw new DvError("MODEL_ARGUMENT_INVALID", "Invalid public media entry"); args.push(transport.flag, entry.source); } }
          else if (transport.encoding === "utf8-file") { const file = join(ctx.workDir, `${name}.txt`); await writeFile(file, String(value), { mode: 0o600 }); args.push(transport.flag, file); }
          else args.push(transport.flag, String(value));
        }
        if (Object.keys(extras).length) { await writeFile(options, JSON.stringify(extras), { mode: 0o600 }); args.push("--options-file", options); }
      } else { await writeFile(options, JSON.stringify(canonicalWire), { mode: 0o600 }); args.push("--options-file", options, "--description-revision", model.description.factsRevision); }
      const result = await runDsivio(args, ctx.projectRoot, ctx.signal);
      let reply: Record<string, Json> | undefined;
      let replyError: unknown;
      try { reply = parseReply(result.stdout); }
      catch (error) { replyError = error; }
      // A task identity is recoverable even when submission exits uncertain or timed out.
      // Preserve it so the worker queries that task instead of creating another paid call.
      if (reply && typeof reply.id === "string" && reply.id && reply.kind === kind) {
        return { handle: { taskId: reply.id, kind, ...(kind === "transcribe" ? { language: request.arguments.language!, sampleFrames: request.arguments.sampleFrames! } : {}) }, task: reply.id, ...(typeof reply.remoteId === "string" ? { receipt: reply.remoteId } : {}) };
      }
      if (result.code === 2 || result.code === 3) throw new DvError("GATEWAY_REJECTED", `Dsivio rejected the request without charge: ${result.stderr || result.stdout}`);
      if (result.code === 6) throw new DvError("GATEWAY_UNAVAILABLE", "Dsivio is closed; open Dsivio and retry with the same idempotency key");
      throw new DvError("GATEWAY_UNCERTAIN", `Dsivio submission exited ${result.code} without a recoverable task id; never resubmit: ${result.stderr || result.stdout}`, { cause: replyError });
    },
    async poll(handle, ctx) {
      if (!object(handle) || typeof handle.taskId !== "string" || !handle.taskId || handle.kind !== kind) throw new DvError("GATEWAY_HANDLE_INVALID", `Expected a ${kind} task handle`);
      const result = await runDsivio(["media", "status", handle.taskId], ctx.projectRoot, ctx.signal);
      if (result.code === 6) return { state: "pending", retryAfterMs, progress: "Dsivio is closed; open Dsivio to continue checking this task" };
      const reply = parseReply(result.stdout);
      if (reply.id !== handle.taskId || reply.kind !== kind) throw new DvError("GATEWAY_RESPONSE_INVALID", "Dsivio status returned a different task");
      const evidence = typeof reply.remoteId === "string" ? { receipt: reply.remoteId } : {};
      if (reply.status === "running") return { state: "pending", retryAfterMs, ...evidence, ...(typeof reply.error === "string" ? { progress: reply.error } : {}) };
      if (reply.status === "failed") return { state: "failed", code: "GATEWAY_FAILED", message: typeof reply.error === "string" ? reply.error : "Dsivio generation failed", charged: result.code !== 5 && reply.submissionState !== "uncertain" && (reply.submissionState === "rejected" || result.code === 3) ? "no" : "maybe", ...evidence };
      if (reply.status === "cancelled") return { state: "cancelled", ...evidence };
      if (result.code !== 0 || reply.status !== "succeeded" || !Array.isArray(reply.outputs)) throw new DvError("GATEWAY_RESPONSE_INVALID", `Invalid Dsivio task status (exit ${result.code})`);
      if (kind === "transcribe") {
        if (typeof handle.language !== "string" || typeof handle.sampleFrames !== "number") throw new DvError("GATEWAY_HANDLE_INVALID", "Missing transcript input identity");
        const transcript = await transcriptFromTask(reply, handle.language, handle.sampleFrames);
        return { state: "done", value: { type: pipelineTypes.evidence, data: evidenceFromReply(transcript, handle.sampleFrames, handle.language, `${transcript.engine?.backend}/${transcript.engine?.model}`) as unknown as Json }, ...evidence };
      }
      const media = kind === "speech" ? "audio" : kind;
      const resources: Json[] = [];
      for (const output of reply.outputs) {
        if (!object(output) || typeof output.path !== "string" || typeof output.mime !== "string" || !output.mime.startsWith(`${media}/`)) throw new DvError("GATEWAY_OUTPUT_MISSING", `Invalid ${media} output`);
        resources.push({ ...await ctx.store.putFile(output.path, output.mime) });
      }
      if (!resources.length) throw new DvError("GATEWAY_OUTPUT_MISSING", `Task succeeded without ${media} output`);
      await writeFile(join(ctx.workDir, "outputs.json"), JSON.stringify(resources), { mode: 0o600 });
      return { state: "done", value: { type: kind === "image" ? imageType : kind === "video" ? videoType : audioType, data: resources[0]! }, ...evidence };
    },
    async cancel(handle, ctx) {
      if (!object(handle) || typeof handle.taskId !== "string") throw new DvError("GATEWAY_HANDLE_INVALID", "Invalid cancel handle");
      const result = await runDsivio(["media", "cancel", handle.taskId, "--json"], ctx.projectRoot, ctx.signal);
      if (result.code !== 0) throw new DvError(result.code === 6 ? "GATEWAY_UNAVAILABLE" : "GATEWAY_CANCEL_FAILED", result.stderr || result.stdout);
      const reply = parseReply(result.stdout);
      if (!["confirmed", "requested", "unsupported", "too-late"].includes(String(reply.outcome))) throw new DvError("GATEWAY_RESPONSE_INVALID", "Invalid cancel outcome");
      return reply.outcome as "confirmed" | "requested" | "unsupported" | "too-late";
    },
  };
}
