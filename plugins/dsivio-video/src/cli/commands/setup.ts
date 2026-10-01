import { installOwnedAsr, asrOwnerStatus } from "../../asr/backend.ts";
import { installRaster, rasterStatus, rasterPython } from "../../raster/install.ts";
import { DvError } from "../../core/errors.ts";
import { locateTool, toolNames, toolVersion } from "../../tools/index.ts";
import type { LocatedTool, ToolName } from "../../tools/types.ts";
import { usage } from "../options.ts";
import type { CliOptions } from "../options.ts";
import { result } from "../output.ts";
import { openWorkspace } from "../project.ts";
import { setupFonts } from "../../fonts/setup.ts";
import { setupBrowser } from "../../render/browser.ts";
import { stringOption } from "../options.ts";

export async function setupCommand(options: CliOptions): Promise<number> {
  const action = options.positionals[0];
  if (!["asr", "browser", "fonts", "raster", "status"].includes(action ?? "")) usage("setup requires asr, browser, fonts, raster or status.");
  if (action !== "browser" && (options.values.kind !== undefined || options.values["browser-download-base-url"] !== undefined)) usage("--kind and --browser-download-base-url are only valid with setup browser.");
  if (action !== "asr" && options.values.model !== undefined) usage("--model is only valid with setup asr.");
  if (action === "browser") {
    const kind = stringOption(options, "kind") ?? "all";
    if (kind !== "render" && kind !== "capture" && kind !== "all") usage("--kind must be render, capture or all.");
    const baseUrl = stringOption(options, "browser-download-base-url");
    const browsers = await setupBrowser(kind, baseUrl ? { baseUrl } : {});
    result(options, { schema: "dsivio-video.browser-setup/1", browsers }, browsers.map(browser => `${browser.kind} Chrome ${browser.version}: ${browser.path}`));
    return 0;
  }
  if (action === "fonts") {
    const fonts = await setupFonts();
    result(options, { schema: "dsivio-video.font-setup/1", ...fonts }, [`Fonts prepared: ${fonts.families.join(", ")} (${fonts.faces} faces); ${fonts.directory}`]);
    return 0;
  }
  if (action === "asr") {
    const model = typeof options.values.model === "string" ? options.values.model : undefined;
    const status = await installOwnedAsr(openWorkspace(options).root, model);
    result(options, { schema: "dsivio-video.setup/1", asr: status }, [`ASR owner: ${String(status.owner)}`, `Install state: ${String(status.state ?? (status.ready ? "installed" : "not installed"))}`, "Query setup status for actual installation/runtime readiness."]);
    return 0;
  }
  if (action === "raster") {
    const status = await installRaster({ onProgress: line => process.stderr.write(`${line}\n`) });
    result(options, { schema: "dsivio-video.raster-setup/1", raster: status }, [`Raster ready: ${status.path}`, `OpenCV ${status.opencv}; NumPy ${status.numpy}; Python ${status.python.join(".")}`]);
    return 0;
  }
  const workspace = openWorkspace(options);
  const tools: (LocatedTool & { version: string } | { name: ToolName; path: null; source: null; error: string; hint?: string })[] = [];
  for (const name of toolNames) {
    try {
      const tool = await locateTool(name, { projectRoot: workspace.root });
      tools.push({ ...tool, version: await toolVersion(name, { projectRoot: workspace.root }) });
    } catch (error) {
      if (!(error instanceof DvError)) throw error;
      tools.push({ name, path: null, source: null, error: error.message, ...(error.hint ? { hint: error.hint } : {}) });
    }
  }
  const asr = await asrOwnerStatus(workspace.root);
  let raster;
  try { raster = { ...await rasterStatus(), state: "ready" }; }
  catch (error) {
    if (!(error instanceof DvError)) throw error;
    raster = { ready: false, state: error.code === "RASTER_VERSION_MISMATCH" ? "mismatch" : "down", path: rasterPython, error: error.message };
  }
  result(options, { schema: "dsivio-video.setup-status/1", tools, asr, raster }, [
    ...tools.map((tool) => `${tool.name}: ${tool.path !== null ? `${tool.version}; ${tool.path} (source: ${tool.source})` : `${tool.error}${tool.hint ? `; ${tool.hint}` : ""}`}`),
    `ASR owner: ${String(asr.owner)}; installation: ${String(asr.state ?? (asr.ready ? "installed" : "not installed"))}; runtime: ${JSON.stringify(asr.runtime ?? null)}`,
    ...(!asr.ready && asr.state !== "ready" ? ["Run dsivio-video setup asr to prepare transcription with the selected owner."] : []),
    `Raster: ${raster.state}; ${raster.path}${"opencv" in raster ? `; OpenCV ${raster.opencv}; NumPy ${raster.numpy}` : `; ${raster.error}`}`,
    ...(raster.ready ? [] : ["Run dsivio-video setup raster to prepare local image processing."]),
  ]);
  return 0;
}
