import type { ChromeReleaseChannel } from "puppeteer-core";
import { installCaptureBrowser } from "../../capture/browser.ts";
import type { CaptureBrowserOptions } from "../../capture/browser.ts";
import { runCaptureScript } from "../../capture/run.ts";
import { runCaptureSession } from "../../capture/session.ts";
import { navigateCapture } from "../../capture/screenshot.ts";
import type { ScreenshotOptions } from "../../capture/screenshot.ts";
import type { CliOptions } from "../options.ts";
import { integer, stringOption, usage } from "../options.ts";
import { result } from "../output.ts";

export function captureBrowserOptions(options: CliOptions): CaptureBrowserOptions {
  const config: CaptureBrowserOptions = {};
  const viewport = stringOption(options, "viewport");
  if (viewport) {
    const match = /^(\d+)x(\d+)$/.exec(viewport);
    if (!match) usage("--viewport must be WIDTHxHEIGHT.");
    config.viewport = { width: integer(match[1], "viewport width", 1280, 1), height: integer(match[2], "viewport height", 720, 1) };
  }
  const scale = stringOption(options, "scale");
  if (scale !== undefined) { config.scale = Number(scale); if (!Number.isFinite(config.scale) || config.scale <= 0) usage("--scale must be finite and positive."); }
  if (options.values.headed !== undefined) config.headed = options.values.headed === true;
  if (options.values["timeout-ms"] !== undefined) config.timeoutMs = integer(stringOption(options, "timeout-ms"), "timeout-ms", 0);
  const channel = stringOption(options, "channel");
  if (channel) { if (!["chrome", "chrome-beta", "chrome-canary", "chrome-dev"].includes(channel)) usage("Unsupported --channel."); config.channel = channel as ChromeReleaseChannel; }
  const names = { browser: "browser", "browser-version": "browserVersion", "browser-cache": "browserCache", "browser-download-base-url": "browserDownloadBaseUrl" } as const;
  for (const [name, field] of Object.entries(names)) { const value = stringOption(options, name); if (value !== undefined) config[field] = value; }
  return config;
}
export async function captureScreenshotCommand(options: CliOptions): Promise<number> {
  const to = stringOption(options, "to");
  if (!to) usage("capture screenshot requires --to <new image path>.");
  const screenshot: ScreenshotOptions = { to };
  if (options.values["full-page"] === true) screenshot.fullPage = true;
  if (options.values.transparent === true) screenshot.transparent = true;
  const selector = stringOption(options, "selector"), waitFor = stringOption(options, "wait-for");
  if (selector !== undefined) screenshot.selector = selector;
  if (waitFor !== undefined) screenshot.waitFor = waitFor;
  if (options.values["wait-ms"] !== undefined) screenshot.waitMs = integer(stringOption(options, "wait-ms"), "wait-ms", 0);
  const clip = stringOption(options, "clip");
  if (clip !== undefined) {
    const values = clip.split(",").map(Number);
    if (values.length !== 4 || !values.every(Number.isFinite)) usage("--clip must be x,y,width,height.");
    screenshot.clip = { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! };
  }
  const outputs = await runCaptureSession(captureBrowserOptions(options), [], async session => {
    await navigateCapture(session.page, options.positionals[0]!);
    await session.screenshot(screenshot);
  });
  result(options, { schema: "dsivio-video.capture/1", outputs }, outputs.map(output => `Saved ${output.path} (${output.width}x${output.height}).`));
  return 0;
}
export async function captureRunCommand(options: CliOptions): Promise<number> {
  const outputs = await runCaptureScript(options.positionals[0]!, captureBrowserOptions(options), options.positionals.slice(1));
  result(options, { schema: "dsivio-video.capture/1", outputs }, [...outputs.map(output => `Saved ${output.path} (${output.width}x${output.height}).`), `${outputs.length} outputs saved.`]);
  return 0;
}
export async function captureInstallCommand(options: CliOptions): Promise<number> {
  const browser = await installCaptureBrowser(captureBrowserOptions(options));
  result(options, { schema: "dsivio-video.browser-setup/1", browsers: [browser] }, [`Capture Chrome ${browser.version}: ${browser.path}`]);
  return 0;
}
