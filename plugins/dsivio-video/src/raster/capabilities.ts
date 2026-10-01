import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import type { Json, ResourceRef, Value } from "../core/value.ts";
import { isPending } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import { exact, object, validateCanvas, validateFrame } from "../space/validate.ts";
import { validateImageProgram } from "../components/image-transform/validate.ts";
import { validateComposePlan } from "../components/image-compose/validate.ts";
import { rasterPython, rasterSources, rasterStatus } from "./install.ts";
export const RASTER_LIMITS = { timeoutMs: 5 * 60_000, inputBytes: 128 * 1024 * 1024, outputBytes: 256 * 1024 * 1024, stderrBytes: 256 * 1024 };
const imageType = "dsivio-video/media@1#Image";
function image(value: unknown, pending: boolean): asserts value is ResourceRef {
  if (pending && isPending(value) && value.type === imageType) return;
  const ref = object(value); exact(ref, ["$resource", "bytes", "mime"]);
  if (typeof ref.$resource !== "string" || !ref.$resource.trim() || typeof ref.bytes !== "number" || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || typeof ref.mime !== "string" || !ref.mime.startsWith("image/")) throw new DvError("RASTER_INPUT_INVALID", "Raster requires an image resource with a nonnegative byte count.");
}
export function validateRasterRequest(raw: unknown, pending = false): void {
  const request = object(raw);
  if (request.action === "edit") {
    exact(request, ["action", "source", "orderedSteps"]); image(request.source, pending); validateImageProgram({ orderedSteps: request.orderedSteps });
  } else if (request.action === "compose") {
    exact(request, ["action", "canvas", "plan", "sources", "frames"]);
    const plan = request.plan; validateComposePlan(plan);
    if (!Array.isArray(request.sources) || !Array.isArray(request.frames) || request.sources.length !== plan.layers.length || request.frames.length !== plan.layers.length) throw new DvError("RASTER_INVALID", "Compose sources, frames and options must have identical layer counts.");
    const canvasPending = pending && isPending(request.canvas) && request.canvas.type === "dsivio-video/space@1#Canvas";
    if (!canvasPending) validateCanvas(request.canvas);
    for (let i = 0; i < plan.layers.length; i++) {
      image(request.sources[i], pending);
      const frame = request.frames[i];
      if (pending && isPending(frame) && frame.type === "dsivio-video/space@1#Frame") continue;
      validateFrame(frame);
      if (!canvasPending) { const canvas = request.canvas; validateCanvas(canvas); if (frame.canvasKey !== canvas.canvasKey) throw new DvError("RASTER_CANVAS_MISMATCH", "Layer frame must belong to the selected canvas."); }
    }
  } else throw new DvError("RASTER_INVALID", "Raster action must be edit or compose.");
}
// The local renderer and raster use independent single-flight gates.
let gate: Promise<void> = Promise.resolve();
async function serial<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const previous = gate;
  const { promise, resolve: release } = Promise.withResolvers<void>();
  gate = promise;
  await previous;
  try { if (signal.aborted) throw new DvError("RASTER_CANCELLED", "Raster request was cancelled."); return await work(); }
  finally { release(); }
}
function runRaster(requestPath: string, outputPath: string, signal: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "" };
    if (process.platform === "win32") for (const key of ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"]) if (process.env[key] !== undefined) env[key] = process.env[key];
    const child = spawn(rasterPython, [join(rasterSources, "raster.py"), requestPath, outputPath], { shell: false, env, stdio: ["ignore", "ignore", "pipe"] });
    let failure: DvError | undefined;
    let stderr = "", bytes = 0;
    const stop = (error: DvError): void => { if (!failure) { failure = error; child.kill("SIGKILL"); } };
    const abort = (): void => stop(new DvError("RASTER_CANCELLED", "Raster request was cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => stop(new DvError("RASTER_TIMEOUT", `Raster exceeded ${RASTER_LIMITS.timeoutMs}ms.`)), RASTER_LIMITS.timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; stderr = (stderr + chunk.toString("utf8")).slice(-8000); if (bytes > RASTER_LIMITS.stderrBytes) stop(new DvError("RASTER_STDERR_LIMIT", `Raster stderr exceeded ${RASTER_LIMITS.stderrBytes} bytes.`)); });
    child.on("error", error => { failure ??= new DvError("RASTER_PROCESS_FAILED", `Cannot start raster: ${error.message}`, { cause: error }); });
    child.on("close", code => { clearTimeout(timer); signal.removeEventListener("abort", abort); if (failure) reject(failure); else if (code !== 0) reject(new DvError("RASTER_PROCESS_FAILED", `Raster exited ${code}: ${stderr}`)); else resolve(); });
  return promise;
}
async function execute(raw: Json, ctx: ExecuteContext): Promise<Value> {
  validateRasterRequest(raw);
  const request = object(raw);
  await rasterStatus();
  await mkdir(ctx.workDir, { recursive: true });
  const scratch = await mkdtemp(join(ctx.workDir, "raster-"));
  try {
    const refs = request.action === "edit" ? [request.source] : request.sources;
    if (!Array.isArray(refs)) throw new DvError("RASTER_INVALID", "Raster sources must be an array.");
    const paths = new Map<string, { ref: ResourceRef; path: string }>();
    let total = 0;
    for (const ref of refs) {
      image(ref, false);
      const previous = paths.get(ref.$resource);
      if (previous) { if (previous.ref.bytes !== ref.bytes || previous.ref.mime !== ref.mime) throw new DvError("RASTER_INPUT_INVALID", "Conflicting metadata for the same image resource."); continue; }
      total += ref.bytes;
      if (total > RASTER_LIMITS.inputBytes) throw new DvError("RASTER_INPUT_LIMIT", `Raster inputs exceed ${RASTER_LIMITS.inputBytes} bytes.`);
      const source = ctx.store.pathOf(ref);
      const stat = await lstat(source);
      if (!stat.isFile() || stat.size !== ref.bytes) throw new DvError("RASTER_INPUT_INVALID", `Image ${ref.$resource} is not a regular file of ${ref.bytes} bytes.`);
      const path = join(scratch, `input-${paths.size}`); await copyFile(source, path);
      if ((await lstat(path)).size !== ref.bytes) throw new DvError("RASTER_INPUT_INVALID", `Image ${ref.$resource} changed while staging.`);
      paths.set(ref.$resource, { ref, path });
    }
    const pathFor = (value: unknown): string => { image(value, false); const staged = paths.get(value.$resource); if (!staged) throw new DvError("RASTER_INPUT_INVALID", `Missing staged image ${value.$resource}.`); return staged.path; };
    let job: Json;
    let mime = "image/png";
    if (request.action === "edit") {
      const program = { orderedSteps: request.orderedSteps }; validateImageProgram(program);
      const last = program.orderedSteps.at(-1)!;
      if (last.kind === "encode") mime = `image/${last.format}`;
      job = { action: "edit", source: pathFor(request.source), orderedSteps: program.orderedSteps as unknown as Json };
    } else {
      const canvas = request.canvas, plan = request.plan; validateCanvas(canvas); validateComposePlan(plan);
      const frames = request.frames; if (!Array.isArray(frames)) throw new DvError("RASTER_INVALID", "Missing layer frames.");
      job = { action: "compose", canvasPixels: [canvas.extent.widthPx, canvas.extent.heightPx], backdrop: plan.background, layerStack: plan.layers.map((options, index) => { const frame = frames[index]; validateFrame(frame); return { ...options, source: pathFor(refs[index]), rect: { ...frame.rect } }; }) };
    }
    const requestPath = join(scratch, "request.json"), outputPath = join(scratch, "output");
    await writeFile(requestPath, JSON.stringify(job), { flag: "wx" });
    await runRaster(requestPath, outputPath, ctx.signal);
    const output = await lstat(outputPath);
    if (!output.isFile() || output.size === 0 || output.size > RASTER_LIMITS.outputBytes) throw new DvError("RASTER_OUTPUT_INVALID", `Raster output must be a nonempty regular file <= ${RASTER_LIMITS.outputBytes} bytes.`);
    const resource = await ctx.store.putFile(outputPath, mime);
    ctx.log(`Raster ${String(request.action)}: ${resource.bytes} bytes (${mime})`);
    return { type: imageType, data: resource as unknown as Json };
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("RASTER_EXECUTION_FAILED", `Raster execution failed: ${String(error)}`, { cause: error });
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
export const rasterCapability: CapabilityDef = {
  name: "local/raster", returns: imageType,
  async resolve(request) {
    try { validateRasterRequest(request, true); }
    catch (error) { if (error instanceof DvError) return { ok: false, code: error.code, reason: error.message }; throw error; }
    return { ok: true, request, backend: "local", summary: { operation: "raster", action: object(request).action as Json }, cost: "local" };
  },
  executor: { kind: "immediate", run: (request, ctx) => serial(ctx.signal, () => execute(request, ctx)) },
};
