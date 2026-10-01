import type { Browser, Page } from "puppeteer-core";
import { DvError } from "../core/errors.ts";
import { launchCaptureBrowser } from "./browser.ts";
import type { CaptureBrowserOptions } from "./browser.ts";
import { captureScreenshot } from "./screenshot.ts";
import type { ScreenshotOptions } from "./screenshot.ts";
import { startRecording } from "./record.ts";
import type { Recording, RecordOptions } from "./record.ts";

export type CaptureOutput = { kind: "image" | "video"; path: string; url: string; width: number; height: number; format: string; durationSeconds?: number; fps?: number; audioPresent?: boolean };
export type CaptureSession = {
  browser: Browser; page: Page; args: string[]; outputs: CaptureOutput[];
  screenshot(options: ScreenshotOptions): Promise<CaptureOutput>;
  record(options: RecordOptions): Promise<Recording>;
  log(message: string): void;
  close(): Promise<void>;
};
export async function createCaptureSession(options: CaptureBrowserOptions = {}, args: string[] = [], signal?: AbortSignal): Promise<CaptureSession> {
  if (signal?.aborted) throw new DvError("ABORTED", "Capture was cancelled before browser startup.");
  const startup = signal ? new AbortController() : undefined;
  const cancelStartup = () => startup?.abort();
  signal?.addEventListener("abort", cancelStartup, { once: true });
  let browser: Browser;
  try { browser = await launchCaptureBrowser(options, startup?.signal); }
  finally { signal?.removeEventListener("abort", cancelStartup); }
  if (signal?.aborted) { await browser.close(); throw new DvError("ABORTED", "Capture browser startup was cancelled."); }
  let page: Page;
  try { page = await browser.newPage(); } catch (cause) { await browser.close(); throw new DvError("CAPTURE_SESSION_FAILED", "Cannot open capture page.", { cause }); }
  if (signal?.aborted) { await browser.close(); throw new DvError("ABORTED", "Capture page startup was cancelled."); }
  if (options.timeoutMs !== undefined) { page.setDefaultTimeout(options.timeoutMs); page.setDefaultNavigationTimeout(options.timeoutMs); }
  const outputs: CaptureOutput[] = [];
  const recordings: Recording[] = [];
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  return {
    browser, page, args, outputs,
    log(message) { process.stderr.write(`${message}\n`); },
    async screenshot(options) {
      if (closing) throw new DvError("CAPTURE_SESSION_CLOSED", "Cannot capture from a closing session.");
      const capturing = captureScreenshot(page, options, signal).then(output => { outputs.push(output); return output; });
      pending.add(capturing);
      try { return await capturing; } finally { pending.delete(capturing); }
    },
    async record(options) {
      if (closing) throw new DvError("CAPTURE_SESSION_CLOSED", "Cannot record from a closing session.");
      const recordSignal = signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal;
      const creating = startRecording(page, { ...options, ...(recordSignal ? { signal: recordSignal } : {}) }).then(native => {
        let stopped: Promise<CaptureOutput> | undefined;
        const managed: Recording = { stop() {
          stopped ??= native.stop().then(output => { outputs.push(output); return output; });
          return stopped;
        } };
        recordings.push(managed);
        return managed;
      });
      pending.add(creating);
      try { return await creating; } finally { pending.delete(creating); }
    },
    close() {
      closing ??= (async () => {
        try {
          const pendingResults = await Promise.allSettled(pending);
          const results = await Promise.allSettled(recordings.map(recording => recording.stop()));
          const errors = [...pendingResults, ...results].filter(result => result.status === "rejected").map(result => result.reason);
          if (errors.length) throw new DvError("CAPTURE_FINALIZATION_FAILED", `${errors.length} capture operation(s) failed to finalize.`, { cause: new AggregateError(errors) });
        } finally { await browser.close(); }
      })();
      return closing;
    },
  };
}

/** CLI lifetime: interruption cancels active native recordings before closing Chrome. */
export async function runCaptureSession(options: CaptureBrowserOptions, args: string[], execute: (session: CaptureSession) => Promise<void>): Promise<CaptureOutput[]> {
  const controller = new AbortController();
  const interrupted = Promise.withResolvers<never>();
  const cancel = () => {
    controller.abort();
    interrupted.reject(new DvError("ABORTED", "Capture was cancelled."));
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  process.once("SIGHUP", cancel);
  const opening = createCaptureSession(options, args, controller.signal);
  let session: CaptureSession | undefined;
  let failure: unknown;
  try {
    await Promise.race([opening.then(async opened => {
      session = opened;
      if (controller.signal.aborted) throw new DvError("ABORTED", "Capture was cancelled.");
      await execute(opened);
    }), interrupted.promise]);
  } catch (cause) { failure = cause; }
  try {
    if (!session) session = await opening;
    await session.close();
  } catch (cause) { failure = failure === undefined ? cause : new AggregateError([failure, cause], "Capture and native recording finalization failed."); }
  finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGHUP", cancel);
  }
  if (controller.signal.aborted) throw new DvError("ABORTED", "Capture was cancelled.", { cause: failure });
  if (failure !== undefined) throw failure instanceof DvError ? failure : new DvError("CAPTURE_FAILED", "Capture failed.", { cause: failure });
  return session!.outputs;
}
