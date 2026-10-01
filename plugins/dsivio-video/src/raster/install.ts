import { mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DvError } from "../core/errors.ts";
import { locateTool, runTool } from "../tools/index.ts";
export const RASTER_VERSION = "1.0.0";
export const NUMPY_VERSION = "2.2.6";
export const OPENCV_VERSION = "4.12.0";
export const rasterDirectory = join(homedir(), ".dsivio-video", "raster", RASTER_VERSION);
export const rasterSources = fileURLToPath(new URL("../../services/raster/", import.meta.url));
export const rasterPython = join(rasterDirectory, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export interface RasterStatus { ready: boolean; path: string; serviceVersion: string; opencv: string; numpy: string; python: number[] }
export async function rasterStatus(): Promise<RasterStatus> {
  try {
    await access(rasterPython);
    const output = await runTool(rasterPython, [join(rasterSources, "raster.py"), "--self-test"], { timeoutMs: 15_000, maxStdoutBytes: 64 * 1024 });
    const data: unknown = JSON.parse(output.stdout.toString("utf8"));
    if (!data || typeof data !== "object" || !("serviceVersion" in data) || data.serviceVersion !== RASTER_VERSION || !("opencv" in data) || data.opencv !== OPENCV_VERSION || !("numpy" in data) || data.numpy !== NUMPY_VERSION || !("python" in data) || !Array.isArray(data.python) || data.python.length !== 3 || data.python.some(value => !Number.isSafeInteger(value)) || data.python[0] !== 3 || data.python[1] !== 12) throw new DvError("RASTER_VERSION_MISMATCH", "Raster requires Python 3.12, OpenCV 4.12.0 and NumPy 2.2.6.", { hint: "Run dsivio-video setup raster." });
    return { ready: true, path: rasterPython, serviceVersion: RASTER_VERSION, opencv: data.opencv, numpy: data.numpy, python: data.python as number[] };
  } catch (error) {
    if (error instanceof DvError && error.code === "RASTER_VERSION_MISMATCH") throw error;
    throw new DvError("RASTER_NOT_PREPARED", `Raster environment is unavailable: ${String(error)}`, { cause: error, hint: "Run dsivio-video setup raster." });
  }
}
export async function installRaster(options: { onProgress?: (line: string) => void } = {}): Promise<RasterStatus> {
  try {
    const python = await locateTool("python");
    const version = await runTool(python, ["-c", "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))"], { timeoutMs: 15_000, maxStdoutBytes: 1024 });
    if (version.stdout.toString("utf8").trim() !== "3.12") throw new DvError("RASTER_PYTHON_VERSION", `Raster setup requires Python 3.12; located ${python.path} returned ${version.stdout.toString("utf8").trim()}.`);
    await mkdir(rasterDirectory, { recursive: true });
    options.onProgress?.("Creating raster Python 3.12 environment");
    await runTool(python, ["-m", "venv", join(rasterDirectory, "venv")], { timeoutMs: 60_000, maxStdoutBytes: 1024 * 1024 });
    options.onProgress?.("Installing pinned NumPy and OpenCV wheels");
    await runTool(rasterPython, ["-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", "--no-deps", "-r", join(rasterSources, "requirements.txt")], { timeoutMs: 5 * 60_000, maxStdoutBytes: 8 * 1024 * 1024, ...(options.onProgress ? { onStderrLine: options.onProgress, onStdoutChunk: (chunk: Buffer) => options.onProgress!(chunk.toString("utf8").trimEnd()) } : {}) });
    return await rasterStatus();
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("RASTER_INSTALL_FAILED", `Raster setup failed: ${String(error)}`, { cause: error });
  }
}
