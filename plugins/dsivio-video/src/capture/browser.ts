import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import type { Browser as PuppeteerBrowser, ChromeReleaseChannel } from "puppeteer-core";
import { Browser, computeExecutablePath } from "@puppeteer/browsers";
import { DvError } from "../core/errors.ts";
import { CAPTURE_BROWSER_VERSION } from "../render/requests.ts";
import { locateBrowser, setupBrowser } from "../render/browser.ts";

export type CaptureBrowserOptions = {
  viewport?: { width: number; height: number }; scale?: number; headed?: boolean; timeoutMs?: number;
  browser?: string; channel?: ChromeReleaseChannel; browserVersion?: string; browserCache?: string; browserDownloadBaseUrl?: string;
};
export function validateBrowserOptions(options: CaptureBrowserOptions): void {
  const managed = options.browserVersion !== undefined || options.browserCache !== undefined || options.browserDownloadBaseUrl !== undefined;
  if ((options.browser && options.channel) || ((options.browser || options.channel) && managed)) throw new DvError("CAPTURE_OPTIONS_INVALID", "External browser/channel and managed browser settings are mutually exclusive.");
  if (options.channel && !["chrome", "chrome-beta", "chrome-canary", "chrome-dev"].includes(options.channel)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Unsupported browser channel.");
  if (options.browserVersion && !/^\d+\.\d+\.\d+\.\d+$/.test(options.browserVersion)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Browser version must be an exact four-part version.");
  if (options.viewport && (!Number.isSafeInteger(options.viewport.width) || options.viewport.width <= 0 || !Number.isSafeInteger(options.viewport.height) || options.viewport.height <= 0)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Viewport dimensions must be positive safe integers.");
  if (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale <= 0)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Device scale must be finite and positive.");
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Timeout must be a nonnegative safe integer.");
  if (options.browserDownloadBaseUrl && !/^https?:\/\//i.test(options.browserDownloadBaseUrl)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Browser mirror must be an HTTP(S) URL.");
}
export async function installCaptureBrowser(options: CaptureBrowserOptions = {}): Promise<{ kind: string; version: string; path: string }> {
  validateBrowserOptions(options);
  if (options.browser || options.channel || options.viewport || options.scale !== undefined || options.headed !== undefined || options.timeoutMs !== undefined) throw new DvError("CAPTURE_OPTIONS_INVALID", "Browser installation accepts only managed version, cache and mirror options.");
  const browsers = await setupBrowser("capture", {
    ...(options.browserVersion ? { captureVersion: options.browserVersion } : {}),
    ...(options.browserCache ? { cacheDir: resolve(options.browserCache) } : {}),
    ...(options.browserDownloadBaseUrl ? { baseUrl: options.browserDownloadBaseUrl } : {}),
  });
  if (!browsers[0]) throw new DvError("BROWSER_SETUP_FAILED", "Capture browser preparation returned no executable.");
  return browsers[0];
}
export async function launchCaptureBrowser(options: CaptureBrowserOptions = {}, startupSignal?: AbortSignal): Promise<PuppeteerBrowser> {
  validateBrowserOptions(options);
  let path: string | undefined;
  if (options.browser) path = resolve(options.browser);
  else if (!options.channel) {
    if (options.browserVersion || options.browserCache) path = computeExecutablePath({ browser: Browser.CHROME, buildId: options.browserVersion ?? CAPTURE_BROWSER_VERSION, cacheDir: resolve(options.browserCache ?? join(homedir(), ".dsivio-video/tools/browser")) });
    else path = (await locateBrowser("capture")).path;
  }
  if (path) {
    try { await access(path, constants.X_OK); }
    catch (cause) { throw new DvError("BROWSER_NOT_PREPARED", `Capture browser is not executable: ${path}`, { cause, hint: "Run dsivio-video setup browser --kind capture." }); }
  }
  try {
    return await puppeteer.launch({ ...(path ? { executablePath: path } : {}), ...(options.channel ? { channel: options.channel } : {}), headless: !options.headed, defaultViewport: { ...(options.viewport ?? { width: 1280, height: 720 }), deviceScaleFactor: options.scale ?? 1 }, ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}), ...(startupSignal ? { signal: startupSignal, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false } : {}), args: ["--autoplay-policy=no-user-gesture-required"] });
  } catch (cause) { throw new DvError(startupSignal?.aborted ? "ABORTED" : "CAPTURE_BROWSER_FAILED", startupSignal?.aborted ? "Capture browser startup was cancelled." : "Cannot launch capture browser.", { cause }); }
}
