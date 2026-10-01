import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { ProjectStore } from "../../build/resources.ts";
import type { ExecuteContext } from "../../core/capability.ts";
import { DvError } from "../../core/errors.ts";
import { prepareOutput, publishDirectory } from "../../media/publish.ts";
import { captureFrames } from "../../render/frames.ts";
import { localizeHtml } from "../../render/resources.ts";
import { validateDocument } from "../../render/validate.ts";
import type { FrameCaptureRequest } from "../../render/requests.ts";
import type { CliOptions } from "../options.ts";
import { integer, stringOption, usage } from "../options.ts";
import { result } from "../output.ts";

export function snapshotFrameList(options: CliOptions, totalFrames: number): number[] {
  const list = stringOption(options, "at-frame");
  if (list !== undefined) {
    if (["start-frame", "end-frame-exclusive", "step-frames"].some(name => options.values[name] !== undefined)) usage("--at-frame is mutually exclusive with range and step options.");
    const frames = list.split(",").map(value => integer(value, "at-frame", -1));
    if (!frames.length || frames.some((frame, index) => frame >= totalFrames || (index > 0 && frame <= frames[index - 1]!))) usage("Snapshot frames must be nonempty, strictly increasing and inside the program.");
    return frames;
  }
  if (options.values["start-frame"] === undefined || options.values["end-frame-exclusive"] === undefined) usage("Snapshot requires --at-frame or a complete frame range.");
  const start = integer(stringOption(options, "start-frame"), "start-frame", 0);
  const end = integer(stringOption(options, "end-frame-exclusive"), "end-frame-exclusive", totalFrames);
  const step = integer(stringOption(options, "step-frames"), "step-frames", 1, 1);
  if (start >= end || end > totalFrames) usage("Snapshot range must satisfy 0 <= start < end <= totalFrames.");
  const frames: number[] = [];
  for (let frame = start; frame < end; frame += step) frames.push(frame);
  return frames;
}
async function fetchBytes(url: URL, signal: AbortSignal): Promise<Buffer> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new DvError("SNAPSHOT_HTTP_FAILED", `Snapshot resource returned HTTP ${response.status}: ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (cause) { if (signal.aborted) throw new DvError("ABORTED", "Snapshot was cancelled.", { cause }); if (cause instanceof DvError) throw cause; throw new DvError("SNAPSHOT_CONNECTION_FAILED", `Cannot load snapshot resource: ${url}`, { cause }); }
}
export async function snapshotCommand(options: CliOptions): Promise<number> {
  const studio = stringOption(options, "studio"), source = options.positionals[0];
  if ((studio !== undefined) === (source !== undefined)) usage("Snapshot requires exactly one HTML input or --studio URL.");
  const to = stringOption(options, "to");
  if (!to) usage("snapshot requires --to <new directory>.");
  const grid = stringOption(options, "grid");
  if (options.values.cell !== undefined && !grid) usage("--cell requires --grid.");
  let columns = 0, rows = 0;
  if (grid) {
    const match = /^(\d+)x(\d+)$/.exec(grid);
    if (!match) usage("--grid must be COLUMNSxROWS.");
    columns = integer(match[1], "grid columns", 0, 1); rows = integer(match[2], "grid rows", 0, 1);
  }
  const cell = integer(stringOption(options, "cell"), "cell", 480, 32);
  const target = await prepareOutput(to);
  const scratch = await mkdtemp(join(dirname(target), ".dv-snapshot-"));
  const out = join(scratch, "output");
  const store = new ProjectStore(scratch);
  const abort = new AbortController();
  const cancel = (): void => { abort.abort(); };
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  const ctx: ExecuteContext = { buildId: "snapshot", commandKey: "frames", idempotencyKey: "snapshot", projectRoot: process.cwd(), store, workDir: join(scratch, "work"), signal: abort.signal, log(message) { process.stderr.write(`${message}\n`); } };
  try {
    let input: FrameCaptureRequest["input"];
    if (studio) {
      if (!/^https?:\/\//i.test(studio)) usage("--studio must be an HTTP(S) base URL.");
      const bytes = await fetchBytes(new URL("/__studio/document", studio), ctx.signal);
      let document: unknown;
      try { document = JSON.parse(bytes.toString("utf8")); } catch (cause) { throw new DvError("SNAPSHOT_DOCUMENT_INVALID", "Studio returned invalid document JSON.", { cause }); }
      validateDocument(document);
      input = { kind: "document", document };
    } else input = { kind: "html", project: await localizeHtml(source!, ctx) };
    const domain = input.kind === "document" ? input.document.domain : input.project.domain;
    const extent = input.kind === "document" ? input.document.extent : input.project.extent;
    const frames = snapshotFrameList(options, domain.totalFrames);
    if (input.kind === "document") {
      for (const usage of input.document.resources) {
        ctx.signal.throwIfAborted();
        if (usage.required === "windows" && !frames.some(frame => usage.frames.some(window => frame >= window.start && frame < window.end))) continue;
        const data = await fetchBytes(new URL(`/__studio/material/${encodeURIComponent(usage.resource.$resource)}`, studio!), ctx.signal);
        if (data.byteLength !== usage.resource.bytes) throw new DvError("RESOURCE_SIZE", "Studio material byte count differs from the document.");
        const path = join(scratch, "material");
        await writeFile(path, data);
        await store.adopt(usage.resource, path);
      }
    }
    const captured = await captureFrames({ input, frames }, ctx);
    ctx.signal.throwIfAborted();
    if (captured.frames.length !== frames.length || captured.frames.some((item, index) => item.frame !== frames[index] || item.resource.mime !== "image/png")) throw new DvError("SNAPSHOT_FRAMES_MISMATCH", "Executor returned frames different from the exact request.");
    await mkdir(out);
    const report: { frame: number; seconds: number; path: string }[] = [];
    for (const item of captured.frames) {
      ctx.signal.throwIfAborted();
      const name = `frame-${String(item.frame).padStart(9, "0")}.png`;
      const path = store.pathOf(item.resource);
      const image = await sharp(path).metadata();
      if (image.width !== extent.widthPx || image.height !== extent.heightPx || image.format !== "png") throw new DvError("SNAPSHOT_IMAGE_INVALID", "Captured PNG does not match the complete canvas.");
      await copyFile(path, join(out, name));
      ctx.signal.throwIfAborted();
      report.push({ frame: item.frame, seconds: item.frame * domain.clock.fps.denominator / domain.clock.fps.numerator, path: join(target, name) });
    }
    const grids: string[] = [];
    if (grid) {
      const aspect = extent.heightPx / extent.widthPx;
      const height = Math.max(1, Math.round(cell * aspect)), labelHeight = 30;
      for (let start = 0; start < report.length; start += columns * rows) {
        ctx.signal.throwIfAborted();
        const page = report.slice(start, start + columns * rows), overlays: OverlayOptions[] = [];
        for (const [index, item] of page.entries()) {
          ctx.signal.throwIfAborted();
          const image = await sharp(await readFile(join(out, `frame-${String(item.frame).padStart(9, "0")}.png`))).resize(cell, height).png().toBuffer();
          const left = (index % columns) * cell, top = Math.floor(index / columns) * (height + labelHeight);
          overlays.push({ input: image, left, top });
          const label = Buffer.from(`<svg width="${cell}" height="${labelHeight}"><rect width="100%" height="100%" fill="#101820"/><text x="8" y="21" font-size="16" fill="white">frame ${item.frame} · ${item.seconds.toFixed(6)} s</text></svg>`);
          overlays.push({ input: label, left, top: top + height });
        }
        const name = `grid-${String(grids.length + 1).padStart(3, "0")}.jpg`;
        await sharp({ create: { width: columns * cell, height: Math.ceil(page.length / columns) * (height + labelHeight), channels: 3, background: "#101820" } }).composite(overlays).jpeg().toFile(join(out, name));
        ctx.signal.throwIfAborted();
        grids.push(join(target, name));
      }
    }
    ctx.signal.throwIfAborted();
    await publishDirectory(out, target);
    ctx.signal.throwIfAborted();
    result(options, { schema: "dsivio-video.snapshot/1", source: studio ? { kind: "studio", url: studio } : { kind: "html", input: source }, executor: "local/render-frames", frames: report, grids, target }, [`Captured ${report.length} frames and ${grids.length} grids to ${target}.`]);
    return 0;
  } catch (cause) { if (ctx.signal.aborted) throw new DvError("ABORTED", "Snapshot was cancelled.", { cause }); if (cause instanceof DvError) throw cause; throw new DvError("SNAPSHOT_FAILED", "Snapshot failed.", { cause }); }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); await rm(scratch, { recursive: true, force: true }); }
}
