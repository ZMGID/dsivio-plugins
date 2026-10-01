import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { DvError } from "../core/errors.ts";
import { locateTool, runTool } from "../tools/index.ts";
import { probeMedia } from "./probe.ts";
import type { MediaProbe } from "./probe.ts";
import { prepareOutput, publishFile } from "./publish.ts";

export interface FetchPreparation { path: string; version: string }
export interface FetchReport { outputPath: string; url: string; probe: MediaProbe }
export async function prepareFetch(): Promise<FetchPreparation> {
  const tool = await locateTool("yt-dlp");
  const result = await runTool(tool, ["--ignore-config", "--version"], { timeoutMs: 15000, maxStdoutBytes: 65536 });
  const version = result.stdout.toString("utf8").trim();
  if (!version) throw new DvError("MEDIA_FETCH_UNAVAILABLE", `Downloader returned no version: ${tool.path}`, { hint: "Install a working yt-dlp binary or set DSIVIO_VIDEO_YT_DLP." });
  return { path: tool.path, version };
}
export async function fetchMedia(url: string, to: string, options: { signal?: AbortSignal } = {}): Promise<FetchReport> {
  let address: URL;
  try { address = new URL(url); }
  catch (error) { throw new DvError("CLI_USAGE", `Invalid fetch URL: ${url}`, { cause: error, hint: "Use a complete HTTP(S) URL." }); }
  if (!["http:", "https:"].includes(address.protocol)) throw new DvError("CLI_USAGE", `Fetch requires HTTP(S), not ${address.protocol}`, { hint: "Use a complete HTTP(S) URL." });
  const format = extname(to).toLowerCase().slice(1);
  if (!["mp4", "mkv", "webm", "mov"].includes(format)) throw new DvError("CLI_USAGE", `Unsupported fetch target: ${to}`, { hint: "Choose a new .mp4, .mkv, .webm, or .mov target." });
  const target = await prepareOutput(to);
  const downloader = await prepareFetch();
  const ffmpeg = await locateTool("ffmpeg");
  await runTool(ffmpeg, ["-version"], { timeoutMs: 15000, maxStdoutBytes: 65536, signal: options.signal });
  let temp: string | undefined;
  try {
    temp = await mkdtemp(join(tmpdir(), "dv-fetch-"));
    await runTool(downloader.path, ["--ignore-config", "--no-update", "--no-remote-components", "--no-plugin-dirs", "--no-js-runtimes", "--js-runtimes", `node:${process.execPath}`, "--no-playlist", "--no-progress", "--quiet", "--format", "bestvideo+bestaudio/best", "--format-sort", "res:1080,vcodec:h264", "--merge-output-format", format, "--ffmpeg-location", ffmpeg.path, "--output", join(temp, "product.%(ext)s"), "--", url], { timeoutMs: 15 * 60 * 1000, maxStdoutBytes: 10 * 1024 * 1024, signal: options.signal });
    const products = (await readdir(temp, { withFileTypes: true })).filter(entry => entry.isFile() && !entry.name.endsWith(".part")).map(entry => entry.name).sort();
    if (!products[0]) throw new DvError("MEDIA_FETCH_EMPTY", `Downloader produced no media for ${url}.`, { hint: "Check that the URL exposes a downloadable video." });
    const product = join(temp, products[0]);
    const probe = await probeMedia(product);
    if (!probe.hasVideo) throw new DvError("MEDIA_VIDEO_REQUIRED", `Downloaded product has no non-cover video: ${url}`, { hint: "Use a URL containing video." });
    await publishFile(product, target);
    return { outputPath: target, url, probe: { ...probe, path: target } };
  } catch (error) {
    if (options.signal?.aborted || error instanceof DvError && ["TOOL_ABORTED", "TOOL_CANCELLED", "MEDIA_OUTPUT_EXISTS"].includes(error.code)) throw error;
    throw new DvError("MEDIA_FETCH_FAILED", `Cannot fetch ${url}: ${(error instanceof Error ? error.message : String(error)).slice(-2000)}`, { cause: error, hint: "Check the URL and downloader installation with media prepare-fetch." });
  } finally { if (temp) await rm(temp, { recursive: true, force: true }); }
}
