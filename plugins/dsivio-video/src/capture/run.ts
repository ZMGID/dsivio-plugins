import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DvError } from "../core/errors.ts";
import { validateBrowserOptions } from "./browser.ts";
import type { CaptureBrowserOptions } from "./browser.ts";
import { runCaptureSession } from "./session.ts";
import type { CaptureOutput } from "./session.ts";

export async function runCaptureScript(path: string, cliOptions: CaptureBrowserOptions, args: string[]): Promise<CaptureOutput[]> {
  validateBrowserOptions(cliOptions);
  const file = resolve(path);
  let module: Record<string, unknown>;
  try {
    if (!(await stat(file)).isFile()) throw new Error("Script must be a regular file.");
    // The user selects this module at runtime; it cannot be statically imported.
    module = await import(pathToFileURL(file).href);
  } catch (cause) { throw new DvError("CAPTURE_SCRIPT_INVALID", `Cannot import capture script ${file}.`, { cause }); }
  const execute = module.default;
  if (typeof execute !== "function") throw new DvError("CAPTURE_SCRIPT_INVALID", "Capture script must export a callable default function.");
  if (module.options !== undefined && (module.options === null || typeof module.options !== "object" || Array.isArray(module.options))) throw new DvError("CAPTURE_OPTIONS_INVALID", "Capture script options must be an object.");
  const defaults = (module.options ?? {}) as CaptureBrowserOptions;
  const merged = { ...defaults, ...cliOptions };
  if (cliOptions.browser || cliOptions.channel) {
    delete merged.browserVersion; delete merged.browserCache; delete merged.browserDownloadBaseUrl;
    if (cliOptions.browser) delete merged.channel;
    if (cliOptions.channel) delete merged.browser;
  }
  validateBrowserOptions(merged);
  try { return await runCaptureSession(merged, args, async session => { await execute(session); }); }
  catch (cause) { if (cause instanceof DvError && cause.code === "ABORTED") throw cause; throw new DvError("CAPTURE_SCRIPT_FAILED", `Capture script ${file} failed.`, { cause }); }
}
