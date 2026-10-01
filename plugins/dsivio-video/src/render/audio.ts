import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import { isPending, isResourceRef } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { frameToSample48k, validateClock } from "../timeline/math.ts";
import type { Bounds } from "../timeline/types.ts";
import { runTool } from "../tools/index.ts";
import { renderTypes } from "./ir.ts";
import type { AudioClip } from "./ir.ts";
import type { MixedAudio, RenderAudioRequest } from "./requests.ts";

function invalid(message: string): never { throw new DvError("RENDER_AUDIO_INVALID", message); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function integer(value: unknown, positive = false): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= (positive ? 1 : 0); }
function bounds(value: unknown): value is Bounds { return object(value) && integer(value.start) && integer(value.end) && value.end > value.start; }
export function validateAudioRequest(value: unknown): asserts value is RenderAudioRequest {
  if (!object(value) || !object(value.domain) || !object(value.domain.clock) || !object(value.domain.clock.fps)) invalid("Missing program domain and clock.");
  const domain = value.domain;
  if (typeof domain.axisKey !== "string" || !domain.axisKey || !integer(domain.totalFrames, true) || !integer(domain.totalSamples48k, true)) invalid("Invalid program domain.");
  const clock = domain.clock as RenderAudioRequest["domain"]["clock"];
  validateClock(clock);
  if (domain.totalSamples48k !== frameToSample48k(domain.totalFrames, clock) || !bounds(value.frames) || value.frames.end > domain.totalFrames) invalid("Audio range must lie in the exact program domain.");
  if (frameToSample48k(value.frames.end - value.frames.start, clock) * 4 > 16 * 1024 ** 3) throw new DvError("RENDER_OUTPUT_LIMIT", "Planned PCM audio exceeds the 16 GiB output limit.");
  if (!Array.isArray(value.tracks)) invalid("Audio tracks must be an array.");
  const sourceSizes = new Map<string, number>();
  for (const track of value.tracks) {
    if (!object(track) || track.kind !== "audio" || track.axisKey !== domain.axisKey || typeof track.trackKey !== "string" || !Array.isArray(track.clips)) invalid("Invalid audio track or axis.");
    for (const clip of track.clips) {
      if (!object(clip) || typeof clip.clipKey !== "string" || !isResourceRef(clip.source) || !integer(clip.source.bytes) || clip.source.mime !== "audio/wav" || !integer(clip.sourceTotalSamples, true)) invalid("Clip requires a canonical WAV resource.");
      if (!bounds(clip.sourceSamples) || clip.sourceSamples.end > clip.sourceTotalSamples || !bounds(clip.targetSamples) || clip.targetSamples.end > domain.totalSamples48k) invalid("Clip sample windows are invalid.");
      const previous = sourceSizes.get(clip.source.$resource);
      if (previous !== undefined && previous !== clip.sourceTotalSamples) invalid("Conflicting source sample counts for the same resource.");
      sourceSizes.set(clip.source.$resource, clip.sourceTotalSamples);
      if (!object(clip.speed) || !integer(clip.speed.numerator, true) || !integer(clip.speed.denominator, true) || clip.preservePitch !== true) invalid("Clip speed must be a positive rational with preserved pitch.");
      if (typeof clip.gain !== "number" || !Number.isFinite(clip.gain) || clip.gain < 0 || clip.gain > 64) invalid("Clip gain must be within 0..64.");
      const length = clip.targetSamples.end - clip.targetSamples.start;
      if (!integer(clip.fadeInSamples) || !integer(clip.fadeOutSamples) || clip.fadeInSamples > length || clip.fadeOutSamples > length) invalid("Clip fades exceed the target window.");
      if (clip.loop !== undefined && (!object(clip.loop) || !integer(clip.loop.phaseSamples) || clip.loop.phaseSamples >= clip.sourceSamples.end - clip.sourceSamples.start)) invalid("Loop phase must lie in the trimmed source window.");
      if (!Array.isArray(clip.gainCurve)) invalid("Clip gain curve must be an array.");
      let last = -1;
      for (const point of clip.gainCurve) {
        if (!object(point) || !integer(point.sample) || point.sample <= last || typeof point.gain !== "number" || !Number.isFinite(point.gain) || point.gain < 0 || point.gain > 64) invalid("Invalid gain curve.");
        last = point.sample;
      }
      if (clip.gainCurve.length && (clip.gainCurve[0].sample > clip.targetSamples.start || last < clip.targetSamples.end)) invalid("Gain curve must cover the complete target window.");
      if (clip.audible !== undefined) {
        if (!Array.isArray(clip.audible)) invalid("Audible windows must be an array.");
        last = clip.targetSamples.start;
        for (const window of clip.audible) {
          if (!bounds(window) || window.start < last || window.end > clip.targetSamples.end) invalid("Audible windows must be ordered, disjoint and inside target.");
          last = window.end;
        }
        const audibleLength = clip.audible.reduce((sum: number, window: Bounds) => sum + window.end - window.start, 0);
        if (clip.fadeInSamples > audibleLength || clip.fadeOutSamples > audibleLength) invalid("Fade exceeds the audible duration.");
      }
    }
  }
}

export type ProbeStream = Record<string, unknown>;
export async function probeRenderStreams(path: string, ctx: ExecuteContext, expectedFormat?: "wav" | "mp4"): Promise<ProbeStream[]> {
  const result = await runTool("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-count_frames", "-of", "json", path], { signal: ctx.signal, cwd: ctx.projectRoot, maxStdoutBytes: 8 * 1024 * 1024 });
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout.toString("utf8")); } catch (cause) { throw new DvError("RENDER_PROBE_INVALID", "Invalid ffprobe JSON.", { cause }); }
  if (!object(parsed) || !Array.isArray(parsed.streams) || !parsed.streams.every(object)) throw new DvError("RENDER_PROBE_INVALID", "Missing probe streams.");
  if (expectedFormat && (!object(parsed.format) || typeof parsed.format.format_name !== "string" || !parsed.format.format_name.split(",").includes(expectedFormat))) throw new DvError("RENDER_CONTAINER_MISMATCH", `Expected a ${expectedFormat.toUpperCase()} container.`);
  return parsed.streams;
}
export function streamSamples48k(stream: ProbeStream): number {
  const base = typeof stream.time_base === "string" ? stream.time_base.split("/") : [];
  const ticks = String(stream.duration_ts ?? "");
  if (base.length !== 2 || !base.every(value => /^\d+$/.test(value)) || !/^\d+$/.test(ticks) || BigInt(base[1]!) === 0n) throw new DvError("RENDER_PROBE_INVALID", "Missing exact stream presentation duration.");
  const numerator = BigInt(ticks) * BigInt(base[0]!) * 48000n;
  const denominator = BigInt(base[1]!);
  if (numerator % denominator !== 0n || numerator / denominator > BigInt(Number.MAX_SAFE_INTEGER)) throw new DvError("RENDER_PROBE_INVALID", "Presentation duration is not an exact safe 48 kHz sample count.");
  return Number(numerator / denominator);
}
export async function validatePcmFile(path: string, expectedSamples: number, ctx: ExecuteContext): Promise<void> {
  const streams = await probeRenderStreams(path, ctx, "wav");
  const stream = streams[0];
  if (streams.length !== 1 || !stream || stream.codec_type !== "audio" || stream.codec_name !== "pcm_s16le" || Number(stream.sample_rate) !== 48000 || stream.channels !== 2 || streamSamples48k(stream) !== expectedSamples) throw new DvError("RENDER_PCM_MISMATCH", "Audio must be a single 48 kHz stereo PCM16 stream with the declared sample count.");
}
function tempo(speed: number): string[] {
  const result: string[] = [];
  while (speed > 2) { result.push("atempo=2"); speed /= 2; }
  while (speed < 0.5) { result.push("atempo=0.5"); speed *= 2; }
  if (speed !== 1) result.push(`atempo=${speed}`);
  return result;
}
function envelope(clip: AudioClip): string {
  const n = `(n+${clip.targetSamples.start})`;
  let expression = "1";
  if (clip.gainCurve.length) {
    expression = String(clip.gainCurve.at(-1)!.gain);
    for (let i = clip.gainCurve.length - 2; i >= 0; i--) {
      const a = clip.gainCurve[i]!, b = clip.gainCurve[i + 1]!;
      expression = `if(lt(${n},${b.sample}),${a.gain}+(${n}-${a.sample})*${(b.gain - a.gain) / (b.sample - a.sample)},${expression})`;
    }
  }
  if (clip.audible !== undefined) {
    const mask = clip.audible.map(window => `gte(${n},${window.start})*lt(${n},${window.end})`).join("+") || "0";
    expression = `(${expression})*(${mask})`;
  }
  return expression;
}
export async function mixAudio(request: RenderAudioRequest, ctx: ExecuteContext): Promise<MixedAudio> {
  validateAudioRequest(request);
  await mkdir(ctx.workDir, { recursive: true });
  const output = join(ctx.workDir, "mixed.wav");
  const start = frameToSample48k(request.frames.start, request.domain.clock), end = frameToSample48k(request.frames.end, request.domain.clock);
  const totalSamples = frameToSample48k(request.frames.end - request.frames.start, request.domain.clock);
  const clips = request.tracks.flatMap(track => track.clips).filter(clip => clip.targetSamples.start < end && clip.targetSamples.end > start && (clip.audible === undefined || clip.audible.some(window => window.start < end && window.end > start)));
  const sources = new Map<string, { index: number; clip: AudioClip }>();
  for (const clip of clips) if (!sources.has(clip.source.$resource)) sources.set(clip.source.$resource, { index: sources.size, clip });
  const args = ["-v", "error", "-nostdin", "-y"];
  for (const { clip } of sources.values()) {
    const path = ctx.store.pathOf(clip.source);
    await validatePcmFile(path, clip.sourceTotalSamples, ctx);
    args.push("-i", path);
  }
  const filters: string[] = [];
  const labels: string[] = [];
  clips.forEach((clip, index) => {
    const duration = clip.targetSamples.end - clip.targetSamples.start;
    const chain = [`atrim=start_sample=${clip.sourceSamples.start}:end_sample=${clip.sourceSamples.end}`, "asetpts=N/SR/TB"];
    if (clip.loop) chain.push(`aloop=loop=-1:size=${clip.sourceSamples.end - clip.sourceSamples.start}`, `atrim=start_sample=${clip.loop.phaseSamples}`, "asetpts=N/SR/TB");
    chain.push(...tempo(clip.speed.numerator / clip.speed.denominator), "apad", `atrim=end_sample=${duration}`, "asetpts=N/SR/TB", `volume=${clip.gain}`);
    if (clip.fadeInSamples) chain.push(`afade=t=in:ss=0:ns=${clip.fadeInSamples}`);
    if (clip.fadeOutSamples) chain.push(`afade=t=out:ss=${duration - clip.fadeOutSamples}:ns=${clip.fadeOutSamples}`);
    const gain = envelope(clip);
    chain.push(`aeval=exprs='val(0)*(${gain})|val(1)*(${gain})'`, `atrim=start_sample=${Math.max(0, start - clip.targetSamples.start)}:end_sample=${Math.min(duration, end - clip.targetSamples.start)}`, "asetpts=N/SR/TB", `adelay=${Math.max(0, clip.targetSamples.start - start)}S:all=1`);
    const label = `clip${index}`;
    filters.push(`[${sources.get(clip.source.$resource)!.index}:a]${chain.join(",")}[${label}]`);
    labels.push(`[${label}]`);
  });
  if (labels.length) filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0:dropout_transition=0,apad,atrim=end_sample=${totalSamples},asetpts=N/SR/TB[out]`);
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=end_sample=${totalSamples},asetpts=N/SR/TB[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", output);
  try {
    await runTool("ffmpeg", args, { cwd: ctx.projectRoot, signal: ctx.signal, timeoutMs: 30 * 60 * 1000 });
    const info = await stat(output);
    if (!info.size || info.size > 16 * 1024 ** 3) throw new DvError("RENDER_OUTPUT_LIMIT", "Mixed WAV is empty or exceeds 16 GiB.");
    await validatePcmFile(output, totalSamples, ctx);
    const resource = await ctx.store.putFile(output, "audio/wav");
    ctx.log(`Mixed ${clips.length} clips at source sample ${start}; ${totalSamples} rebased samples.`);
    return { resource, totalSamples };
  } finally { await rm(output, { force: true }); }
}
export const audioCapability: CapabilityDef = {
  name: "local/render-audio", returns: renderTypes.mixedAudio,
  async resolve(request) {
    try { if (!containsPending(request)) validateAudioRequest(request); }
    catch (error) { if (!(error instanceof DvError)) throw error; return { ok: false, code: error.code, reason: error.message }; }
    return { ok: true, request, backend: "local", cost: "local", summary: { operation: "48 kHz sample-exact mixing" } };
  },
  executor: { kind: "immediate", async run(request, ctx) { validateAudioRequest(request); return { type: renderTypes.mixedAudio, data: await mixAudio(request, ctx) as unknown as Json }; } },
};
function containsPending(value: Json): boolean { return isPending(value) || (Array.isArray(value) ? value.some(containsPending) : object(value) && Object.values(value).some(entry => containsPending(entry as Json))); }
