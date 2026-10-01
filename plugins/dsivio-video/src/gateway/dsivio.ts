import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dsivioCommand } from "../tools/dsivio.ts";
import { DvError } from "../core/errors.ts";
import type { AsyncExecutor } from "../core/capability.ts";
import { isPending, isResourceRef } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { imageType, videoType } from "../modules/media/index.ts";
import { object, readRequest } from "./request.ts";
import type { MediaKind } from "./request.ts";


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
      const request = readRequest(data, kind);
      if (Object.keys(request.options).length) throw new DvError("GEN_OPTION_UNSUPPORTED", "Dsivio does not accept model-specific parameters yet");
      if (typeof request.prompt !== "string") throw new DvError("GEN_INPUT_PENDING", "Cannot submit a Pending prompt");
      const path = (value: Json): string => {
        if (isPending(value)) throw new DvError("GEN_INPUT_PENDING", "Cannot submit Pending media");
        if (!isResourceRef(value)) throw new DvError("TYPE_INVALID", "Expected a ResourceRef");
        return ctx.store.pathOf(value);
      };
      try { await mkdir(ctx.workDir, { recursive: true }); await writeFile(join(ctx.workDir, "prompt.txt"), request.prompt, "utf8"); }
      catch (error) { throw new DvError("GATEWAY_PROMPT_WRITE", `Cannot write prompt file: ${String(error)}`, { cause: error }); }
      const args = ["media", kind, "--no-wait", "--model", request.model, "--prompt-file", join(ctx.workDir, "prompt.txt"), "--idempotency-key", ctx.idempotencyKey, "--source", "dsivio-video"];
      for (const [param, value] of Object.entries(request.params)) {
        if (param === "audio") {
          if (value === true) args.push("--audio");
          else args.push("--options-json", '{"generateAudio":false}');
        } else args.push(`--${param === "count" ? "n" : param}`, String(value));
      }
      for (const [field, flag] of [["firstFrame", "--first-frame"], ["lastFrame", "--last-frame"]] as const) if (request[field] !== undefined) args.push(flag, path(request[field]));
      for (const [values, flag] of [[request.references.images, "--ref"], [request.references.videos, "--ref-video"], [request.references.audios, "--ref-audio"]] as const) for (const value of values) args.push(flag, path(value));
      const result = await runDsivio(args, ctx.projectRoot, ctx.signal);
      let reply: Record<string, Json> | undefined;
      let replyError: unknown;
      try { reply = parseReply(result.stdout); }
      catch (error) { replyError = error; }
      // A task identity is recoverable even when submission exits uncertain or timed out.
      // Preserve it so the worker queries that task instead of creating another paid call.
      if (reply && typeof reply.id === "string" && reply.id && reply.kind === kind) {
        return { handle: { taskId: reply.id, kind }, task: reply.id, ...(typeof reply.remoteId === "string" ? { receipt: reply.remoteId } : {}) };
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
      if (result.code !== 0 || reply.status !== "succeeded" || !Array.isArray(reply.outputs)) throw new DvError("GATEWAY_RESPONSE_INVALID", `Invalid Dsivio task status (exit ${result.code})`);
      const output = reply.outputs.find((item) => object(item) && typeof item.path === "string" && typeof item.mime === "string" && item.mime.startsWith(`${kind}/`));
      if (!output || !object(output) || typeof output.path !== "string" || typeof output.mime !== "string") throw new DvError("GATEWAY_OUTPUT_MISSING", `Dsivio succeeded without a ${kind} output`);
      const resource = await ctx.store.putFile(output.path, output.mime);
      return { state: "done", value: { type: kind === "image" ? imageType : videoType, data: { ...resource } }, ...evidence };
    },
  };
}
