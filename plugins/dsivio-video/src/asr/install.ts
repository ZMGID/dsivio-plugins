import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DvError } from "../core/errors.ts";
import { locateTool, runTool } from "../tools/index.ts";
import { stopAsr } from "./service.ts";

export const ASR_PROTOCOL = "dsivio-video.asr/1";
export const ASR_SERVICE_VERSION = "0.2.0";
export const WHISPERX_VERSION = "3.8.6";
export const asrRoot = join(homedir(), ".dsivio-video", "asr");
export const asrDirectory = join(asrRoot, ASR_SERVICE_VERSION);
export const asrSources = fileURLToPath(new URL("../../services/asr/", import.meta.url));
export const asrPython = join(asrDirectory, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export interface AsrConfiguration {
  model: string;
  languages: string[];
  device: string;
  compute: string;
  batchSize: number;
  cache: string;
  serviceVersion: string;
}
export interface AsrStatus {
  ready: boolean;
  path: string;
  model?: string;
  languages?: string[];
  serviceVersion: string;
}
export async function readAsrConfiguration(): Promise<AsrConfiguration | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(asrDirectory, "config.json"), "utf8"));
    if (typeof value !== "object" || value === null || !("model" in value) || typeof value.model !== "string" || !("languages" in value) || !Array.isArray(value.languages) || value.languages.some((item) => typeof item !== "string") || !("serviceVersion" in value) || value.serviceVersion !== ASR_SERVICE_VERSION || !("device" in value) || value.device !== "cpu" || !("compute" in value) || value.compute !== "int8" || !("batchSize" in value) || value.batchSize !== 8 || !("cache" in value) || typeof value.cache !== "string") throw new DvError("ASR_CONFIG_INVALID", "ASR installation configuration is invalid", { hint: "Run dsivio-video setup asr." });
    await access(asrPython);
    return { model: value.model, languages: value.languages, serviceVersion: value.serviceVersion, device: value.device, compute: value.compute, batchSize: value.batchSize, cache: value.cache };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_CONFIG_INVALID", `Cannot read ASR installation: ${String(error)}`, { cause: error, hint: "Run dsivio-video setup asr." });
  }
}
export async function asrStatus(): Promise<AsrStatus> {
  const config = await readAsrConfiguration();
  return { ready: config !== undefined, path: asrDirectory, serviceVersion: ASR_SERVICE_VERSION, ...(config ? { model: config.model, languages: config.languages } : {}) };
}
export async function installAsr(options: { model?: string; languages?: string[]; onProgress?: (line: string) => void } = {}): Promise<AsrStatus> {
  const model = options.model ?? "small";
  const languages = [...new Set(options.languages ?? ["en", "zh"])];
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(model)) throw new DvError("CLI_USAGE", "ASR model must be a model name, not a path.");
  if (languages.length === 0 || languages.some((language) => !/^[a-z]{2,3}$/.test(language) || ["auto", "und"].includes(language))) throw new DvError("CLI_USAGE", "ASR languages must be lowercase two- or three-letter codes.");
  if (model.endsWith(".en") && languages.some((language) => language !== "en")) throw new DvError("CLI_USAGE", "English-only ASR models require languages: [en].");
  try {
    const previous = await readAsrConfiguration();
    const python = await locateTool("python");
    await mkdir(asrDirectory, { recursive: true });
    const runOptions = { timeoutMs: 30 * 60_000, maxStdoutBytes: 16 * 1024 * 1024, onStderrLine: options.onProgress, onStdoutChunk: options.onProgress ? (chunk: Buffer) => options.onProgress!(chunk.toString("utf8").trimEnd()) : undefined };
    options.onProgress?.("Creating ASR Python environment");
    await runTool(python, ["-m", "venv", join(asrDirectory, "venv")], runOptions);
    options.onProgress?.("Installing pinned WhisperX dependencies");
    await runTool(asrPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", join(asrSources, "requirements.txt")], runOptions);
    options.onProgress?.("Preparing ASR, alignment and sentence resources");
    const cache = join(asrDirectory, "cache");
    await runTool(asrPython, [join(asrSources, "prepare.py"), "--model", model, "--languages", ...languages, "--cache", cache], runOptions);
    // Verify and stop the old service while its old configuration is still authoritative.
    await stopAsr(previous);
    const config: AsrConfiguration = { model, languages, device: "cpu", compute: "int8", batchSize: 8, cache, serviceVersion: ASR_SERVICE_VERSION };
    const temporary = join(asrDirectory, `config-${process.pid}.json`);
    await writeFile(temporary, JSON.stringify(config) + "\n", { mode: 0o600 });
    await rename(temporary, join(asrDirectory, "config.json"));
    return { ready: true, path: asrDirectory, model, languages, serviceVersion: ASR_SERVICE_VERSION };
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("ASR_INSTALL_FAILED", `ASR installation failed: ${String(error)}`, { cause: error, hint: "Run dsivio-video setup asr." });
  }
}
