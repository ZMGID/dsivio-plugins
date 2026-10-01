import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { probeMedia } from "./probe.ts";
import { prepareOutput, publishFile, publishDirectory } from "./publish.ts";
import { sampleRange, readRanges, sampleInteger, timeSlug } from "./sample.ts";
import type { SamplingOptions, SampleRange } from "./sample.ts";
import { extractFrame, extractRawFrames } from "./frames.ts";
import type { FrameEvidence, ExtractedFrame } from "./frames.ts";
import { transcriptContext } from "./transcript.ts";
import type { TranscriptDocument } from "./transcript-types.ts";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { DvError } from "../core/errors.ts";
import type { TranscriptContext } from "./transcript.ts";
import { formatTime, renderTimeLabel } from "./time-label.ts";

export interface GridFrame { image: Buffer; observedSec: number; context?: TranscriptContext }
export interface GridImage { image: Buffer; width: number; height: number; usedRows: number }
export async function labelTimeBitmap(image: Buffer, time: number): Promise<Buffer> {
  try {
    const { width, height, rgba } = renderTimeLabel(time);
    const source = await sharp(image).metadata();
    if (!source.width || !source.height) throw new Error("Missing image dimensions.");
    const label = await sharp(rgba, { raw: { width, height, channels: 4 } }).extract({ left: 0, top: 0, width: Math.min(width, source.width - 8), height: Math.min(height, source.height - 8) }).png().toBuffer();
    return await sharp(image).composite([{ input: label, left: 8, top: 8 }]).jpeg({ quality: 95 }).toBuffer();
  } catch (error) {
    throw new DvError("MEDIA_LABEL", `Cannot draw time label: ${error instanceof Error ? error.message : String(error)}`, { hint: "Use a decodable image with room for an 8-pixel label margin.", cause: error });
  }
}
export async function renderGrid(frames: GridFrame[], cellPixels: number, gridColumns: number): Promise<GridImage> {
  try {
    if (!frames.length) throw new Error("No frames available for the grid.");
    const fontSize = Math.max(12, Math.round(cellPixels / 28));
    const cells = await Promise.all(frames.map(async frame => {
      const image = await sharp(frame.image).resize({ width: cellPixels }).png().toBuffer({ resolveWithObject: true });
      const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const lines = [formatTime(frame.observedSec)];
      if (frame.context) {
        const { activeTokens, contextTokens } = frame.context;
        lines.push(activeTokens.length ? activeTokens.map(token => `<b>${escape(token.text)}</b> ${token.startSec!.toFixed(3)}–${token.endSec!.toFixed(3)}`).join(" · ") : "No timed words at this frame.");
        if (contextTokens.length) lines.push(contextTokens.map(token => activeTokens.includes(token) ? `<span foreground="#ffdd55"><b>${escape(token.text)}</b></span>` : escape(token.text)).join(" "));
      }
      const label = await sharp({ text: { text: `<span foreground="#f2f2f2">${lines.join("\n")}</span>`, font: `sans ${fontSize}`, width: cellPixels - 16, wrap: "word-char", rgba: true } }).png().toBuffer({ resolveWithObject: true });
      return { image, label };
    }));
    const imageHeight = Math.max(...cells.map(cell => cell.image.info.height));
    const labelHeight = Math.max(...cells.map(cell => cell.label.info.height)) + 16;
    const usedRows = Math.ceil(frames.length / gridColumns);
    const width = gridColumns * (cellPixels + 8) + 8;
    const height = usedRows * (imageHeight + labelHeight + 8) + 8;
    const overlays: OverlayOptions[] = [];
    cells.forEach((cell, index) => {
      const left = 8 + index % gridColumns * (cellPixels + 8);
      const top = 8 + Math.floor(index / gridColumns) * (imageHeight + labelHeight + 8);
      overlays.push({ input: cell.image.data, left, top }, { input: cell.label.data, left: left + 8, top: top + imageHeight + 8 });
    });
    const image = await sharp({ create: { width, height, channels: 3, background: "#111111" } }).composite(overlays).png().toBuffer();
    return { image, width, height, usedRows };
  } catch (error) {
    throw new DvError("MEDIA_GRID", `Cannot render grid: ${error instanceof Error ? error.message : String(error)}`, { hint: "Check image dimensions and text-rendering support in sharp.", cause: error });
  }
}

export interface TileOptions extends SamplingOptions {
  to: string; cell?: string; columns?: string; rows?: string; ranges?: string; transcript?: TranscriptDocument;
}
export interface GridPage {
  outputPath: string; items: FrameEvidence[]; requestedTimes?: number[];
  rangeId?: string; startSec?: number; endSec?: number;
}
export interface TileReport {
  outputPath: string; requestedTimes: number[]; gridColumns: number; usedRows: number; cellPixels: number; items: FrameEvidence[];
}
export interface TilesReport { outputPath: string; pages: GridPage[]; gridColumns?: number; pageLimitRows?: number; cellPixels?: number }

export async function mediaTile(source: string, options: TileOptions): Promise<TileReport> {
  if (options.everyFrame || options.rows !== undefined || options.ranges !== undefined) throw new DvError("MEDIA_SAMPLE", "tile does not accept every-frame, rows or ranges.", { hint: "Use tiles for pagination and raw frames." });
  const report = await createGrids(source, options, false);
  const page = report.pages[0]!;
  return { outputPath: report.outputPath, requestedTimes: page.requestedTimes!, gridColumns: report.gridColumns!, usedRows: Math.ceil(page.items.length / report.gridColumns!), cellPixels: report.cellPixels!, items: page.items };
}
export async function mediaTiles(source: string, options: TileOptions): Promise<TilesReport> {
  if (options.everyFrame && (options.at !== undefined || options.every !== undefined || options.frames !== undefined)) throw new DvError("MEDIA_SAMPLE", "--every-frame cannot be combined with --at, --every or --frames.", { hint: "Choose either original frames or sampled frames." });
  if (options.every !== undefined && options.frames !== undefined) throw new DvError("MEDIA_SAMPLE", "--every and --frames are mutually exclusive.", { hint: "Choose one default sampling mode for the ranges." });
  return await createGrids(source, options, true);
}
async function createGrids(source: string, options: TileOptions, paginate: boolean): Promise<TilesReport> {
  const probe = await probeMedia(source);
  if (!probe.hasVideo || probe.videoStreamIndex === undefined || !probe.width) throw new DvError("MEDIA_VIDEO_REQUIRED", `Grids require video: ${probe.path}.`, { hint: "Use an input with a non-cover video stream." });
  const gridColumns = sampleInteger(options.columns, "columns", 3, 1);
  const pageLimitRows = sampleInteger(options.rows, "rows", 3, 1);
  const cellPixels = sampleInteger(options.cell, "cell", Math.max(80, Math.min(480, probe.width)), 80);
  if (!Number.isSafeInteger(gridColumns * pageLimitRows)) throw new DvError("MEDIA_SAMPLE", "Grid page capacity exceeds the safe integer range.", { hint: "Use smaller columns and rows." });
  const ranges: SampleRange[] = options.ranges ? await readRanges(options.ranges, probe.durationSec, options) : [sampleRange(probe.durationSec, options, options.transcript)];
  const outputPath = await prepareOutput(options.to);
  let workDir: string | undefined;
  let outputDir: string | undefined;
  try {
    workDir = await mkdtemp(join(dirname(outputPath), ".dv-grid-"));
    outputDir = await mkdtemp(join(dirname(outputPath), ".dv-grid-output-"));
    const pages: GridPage[] = [];
    for (const [rangeIndex, range] of ranges.entries()) {
      const extracted: ExtractedFrame[] = [];
      if (options.everyFrame) extracted.push(...await extractRawFrames(probe.path, probe.videoStreamIndex, range.startSec, range.endSec, workDir));
      else for (const [index, time] of range.requestedTimes.entries()) extracted.push(await extractFrame(probe.path, probe.videoStreamIndex, time, workDir, index));
      const capacity = paginate ? gridColumns * pageLimitRows : extracted.length;
      const pageCount = Math.ceil(extracted.length / capacity);
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const frames = extracted.slice(pageIndex * capacity, (pageIndex + 1) * capacity);
        const cells = frames.map(frame => ({ image: frame.image, observedSec: frame.observedSec, ...(options.transcript ? { context: transcriptContext(options.transcript, frame.observedSec) } : {}) }));
        const grid = await renderGrid(cells, cellPixels, gridColumns);
        const rangeName = range.id ?? (options.everyFrame && !options.ranges ? "frames" : `${timeSlug(range.startSec)}-${timeSlug(range.endSec)}`);
        const name = paginate ? `${String(rangeIndex + 1).padStart(3, "0")}-${rangeName}${pageCount > 1 || options.everyFrame ? `-p${String(pageIndex + 1).padStart(3, "0")}` : ""}.jpg` : `tile${extname(outputPath)}`;
        const filePath = paginate ? join(outputPath, name) : outputPath;
        const temporaryPath = join(outputDir, name);
        await sharp(grid.image).toFile(temporaryPath);
        const items: FrameEvidence[] = frames.map((frame, index) => ({
          filePath, observedSec: frame.observedSec,
          ...(options.everyFrame ? {} : { wantedSec: frame.wantedSec, ...(cells[index]!.context ?? {}) }),
        }));
        pages.push({ outputPath: filePath, items, ...(options.everyFrame ? {} : {
          requestedTimes: frames.map(frame => frame.wantedSec!), startSec: range.startSec, endSec: range.endSec, ...(range.id ? { rangeId: range.id } : {}),
        }) });
      }
    }
    if (paginate) await publishDirectory(outputDir, outputPath);
    else await publishFile(join(outputDir, `tile${extname(outputPath)}`), outputPath);
    return { outputPath, pages, ...(options.everyFrame ? {} : { gridColumns, pageLimitRows, cellPixels }) };
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("MEDIA_GRID", `Cannot export grids to ${outputPath}: ${error instanceof Error ? error.message : String(error)}`, { hint: "Check output image extension, target permissions and available disk space.", cause: error });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
  }
}
