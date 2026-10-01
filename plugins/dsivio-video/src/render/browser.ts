import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Browser, computeExecutablePath, install } from "@puppeteer/browsers";
import { DvError } from "../core/errors.ts";
import { runTool } from "../tools/index.ts";
import { CAPTURE_BROWSER_VERSION, RENDER_BROWSER_VERSION } from "./requests.ts";

export type BrowserLocation = { kind: string; version: string; path: string };
export const browserCacheDir = join(homedir(), ".dsivio-video", "tools", "browser");

async function inspect(path: string, kind: string): Promise<BrowserLocation> {
  try {
    if (!(await stat(path)).isFile()) throw new DvError("BROWSER_NOT_PREPARED", `Browser is not a file: ${path}`);
    await access(path, constants.X_OK);
    const output = await runTool(resolve(path), ["--version"], { timeoutMs: 15_000, maxStdoutBytes: 65536 });
    const version = /\b(\d+\.\d+\.\d+\.\d+)\b/.exec(output.stdout.toString() + output.stderr)?.[1];
    if (!version) throw new DvError("BROWSER_NOT_PREPARED", `Browser did not report a version: ${path}`);
    return { kind, version, path: resolve(path) };
  } catch (cause) {
    if (cause instanceof DvError) throw cause;
    throw new DvError("BROWSER_NOT_PREPARED", `Browser is not executable: ${path}`, { cause });
  }
}

/** Downloads only on this explicit preparation entry point, never during rendering. */
export async function setupBrowser(
  kind: "render" | "capture" | "all",
  options: { baseUrl?: string; cacheDir?: string; captureVersion?: string } = {},
): Promise<BrowserLocation[]> {
  if (!["render", "capture", "all"].includes(kind)) throw new DvError("BROWSER_KIND_INVALID", "Browser kind must be render, capture or all");
  if (options.baseUrl && !/^https?:\/\//.test(options.baseUrl)) throw new DvError("BROWSER_MIRROR_INVALID", "Browser mirror must use HTTP(S)");
  if (options.captureVersion && !/^\d+\.\d+\.\d+\.\d+$/.test(options.captureVersion)) throw new DvError("BROWSER_VERSION_INVALID", "Capture browser requires an exact four-part version");
  const result: BrowserLocation[] = [];
  for (const item of kind === "all" ? ["render", "capture"] as const : [kind]) {
    if (item === "render" && process.platform === "linux" && process.arch === "arm64") {
      throw new DvError("BROWSER_PLATFORM_UNSUPPORTED", "Pinned render shell is unavailable on linux-arm64; configure an explicit compatible Chrome executable");
    }
    const browser = item === "render" ? Browser.CHROMEHEADLESSSHELL : Browser.CHROME;
    const version = item === "render" ? RENDER_BROWSER_VERSION : options.captureVersion ?? CAPTURE_BROWSER_VERSION;
    try {
      const installed = await install({ browser, buildId: version, cacheDir: options.cacheDir ?? browserCacheDir, ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) });
      const location = await inspect(installed.executablePath, item);
      if (location.version !== version) throw new DvError("BROWSER_VERSION_MISMATCH", "Installed browser does not match the requested exact version");
      result.push(location);
    } catch (cause) {
      if (cause instanceof DvError) throw cause;
      throw new DvError("BROWSER_SETUP_FAILED", `Cannot prepare ${item} browser: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }
  return result;
}

/** Phase 3 managed lookup: explicit environment path, then the exact managed pin. */
export async function locateBrowser(
  kind: "render" | "capture",
  options: { chromePath?: string; browserVersion?: string } = {},
): Promise<BrowserLocation> {
  if (options.chromePath && options.browserVersion) throw new DvError("BROWSER_OPTIONS_CONFLICT", "chromePath and browserVersion are mutually exclusive");
  // Capture scripts may explicitly select an external browser. Its actual version is recorded.
  if (options.chromePath) return inspect(options.chromePath, kind);
  const browser = kind === "render" ? Browser.CHROMEHEADLESSSHELL : Browser.CHROME;
  const expected = options.browserVersion ?? (kind === "render" ? RENDER_BROWSER_VERSION : CAPTURE_BROWSER_VERSION);
  const candidates = [
    ...(process.env.DSIVIO_VIDEO_CHROME ? [process.env.DSIVIO_VIDEO_CHROME] : []),
    computeExecutablePath({ browser, buildId: expected, cacheDir: browserCacheDir }),
  ];
  const diagnostics: string[] = [];
  for (const candidate of candidates) {
    try {
      const location = await inspect(candidate, kind);
      if (location.version === expected) return location;
      diagnostics.push(`${candidate}: version ${location.version}, expected ${expected}`);
    } catch (cause) {
      diagnostics.push(`${candidate}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  throw new DvError("BROWSER_NOT_PREPARED", `No executable ${kind} browser ${expected} found. ${diagnostics.join("; ")}`, { hint: `Run dsivio-video setup browser --kind ${kind}` });
}
