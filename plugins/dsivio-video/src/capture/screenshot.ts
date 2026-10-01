import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";
import sharp from "sharp";
import type { Page } from "puppeteer-core";
import { DvError } from "../core/errors.ts";
import { prepareOutput, publishFile } from "../media/publish.ts";
import type { CaptureOutput } from "./session.ts";

export type ScreenshotOptions = { to: string; fullPage?: boolean; selector?: string; clip?: { x: number; y: number; width: number; height: number }; transparent?: boolean; waitFor?: string; waitMs?: number };
export async function navigateCapture(page: Page, input: string): Promise<void> {
  let url: string;
  if (/^(https?|file):/i.test(input)) url = new URL(input).href;
  else {
    const path = resolve(input);
    try { if (!(await stat(path)).isFile()) throw new Error("Not a regular file."); }
    catch (cause) { throw new DvError("CAPTURE_INPUT_INVALID", `Cannot read capture HTML: ${path}`, { cause }); }
    url = pathToFileURL(path).href;
  }
  try {
    const response = await page.goto(url, { waitUntil: "load" });
    if (response && !response.ok()) throw new DvError("CAPTURE_HTTP_FAILED", `Capture navigation returned HTTP ${response.status()}: ${url}`);
  } catch (cause) { if (cause instanceof DvError) throw cause; throw new DvError("CAPTURE_NAVIGATION_FAILED", `Cannot load capture URL: ${url}`, { cause }); }
}
export async function captureScreenshot(page: Page, options: ScreenshotOptions, signal?: AbortSignal): Promise<CaptureOutput> {
  if (signal?.aborted) throw new DvError("ABORTED", "Screenshot was cancelled.");
  if ([options.fullPage === true, options.selector !== undefined, options.clip !== undefined].filter(Boolean).length > 1) throw new DvError("CAPTURE_OPTIONS_INVALID", "Full-page, selector and clip are mutually exclusive.");
  if (options.clip && (!Object.values(options.clip).every(Number.isFinite) || options.clip.x < 0 || options.clip.y < 0 || options.clip.width <= 0 || options.clip.height <= 0)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Clip coordinates must be nonnegative and its size positive.");
  if (options.waitMs !== undefined && (!Number.isSafeInteger(options.waitMs) || options.waitMs < 0)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Wait milliseconds must be a nonnegative safe integer.");
  const target = await prepareOutput(options.to);
  const extension = extname(target).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw new DvError("CAPTURE_OPTIONS_INVALID", "Screenshot output must be PNG, JPEG or WebP.");
  const scratch = await mkdtemp(join(dirname(target), ".dv-capture-"));
  const path = join(scratch, `image${extension}`);
  try {
    if (options.waitFor) await page.waitForSelector(options.waitFor, { visible: true, ...(signal ? { signal } : {}) });
    if (options.waitMs) await setTimeout(options.waitMs, undefined, { signal });
    if (signal?.aborted) throw new DvError("ABORTED", "Screenshot was cancelled.");
    const screenshotOptions = { type: extension === ".png" ? "png" as const : extension === ".webp" ? "webp" as const : "jpeg" as const, omitBackground: options.transparent ?? false };
    let data: Uint8Array;
    if (options.selector) {
      const element = await page.waitForSelector(options.selector, { visible: true, ...(signal ? { signal } : {}) });
      if (!element) throw new DvError("CAPTURE_SELECTOR_MISSING", `Selector not found: ${options.selector}`);
      try { data = await element.screenshot(screenshotOptions); } finally { await element.dispose(); }
    } else data = await page.screenshot({ ...screenshotOptions, fullPage: options.fullPage ?? false, ...(options.clip ? { clip: options.clip } : {}) });
    await writeFile(path, data);
    const metadata = await sharp(path).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) throw new DvError("CAPTURE_IMAGE_INVALID", "Screenshot has no decodable image dimensions.");
    if (signal?.aborted) throw new DvError("ABORTED", "Screenshot was cancelled.");
    await publishFile(path, target);
    return { kind: "image", path: target, url: page.url(), width: metadata.width, height: metadata.height, format: metadata.format };
  } catch (cause) { if (signal?.aborted) throw new DvError("ABORTED", "Screenshot was cancelled.", { cause }); if (cause instanceof DvError) throw cause; throw new DvError("CAPTURE_SCREENSHOT_FAILED", "Screenshot failed.", { cause }); }
  finally { await rm(scratch, { recursive: true, force: true }); }
}
