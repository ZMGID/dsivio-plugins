import { DvError } from "../../../core/errors.ts";
import { stringOption } from "../../options.ts";
import type { CliOptions } from "../../options.ts";
import { result } from "../../output.ts";
import { fetchMedia, prepareFetch } from "../../../media/fetch.ts";

export async function mediaFetchCommand(options: CliOptions): Promise<number> {
  const to = stringOption(options, "to");
  if (!to) throw new DvError("CLI_USAGE", "media fetch requires --to.", { hint: "Specify a new .mp4, .mkv, .webm, or .mov output path." });
  const report = await fetchMedia(options.positionals[0]!, to);
  result(options, report, [`Saved ${report.outputPath}`, `Source: ${report.url}`, `Video: ${report.probe.width}×${report.probe.height}; duration: ${report.probe.durationSec.toFixed(3)} s; audio: ${report.probe.hasAudio ? "yes" : "no"}`]);
  return 0;
}
export async function mediaPrepareFetchCommand(options: CliOptions): Promise<number> {
  const report = await prepareFetch();
  result(options, report, [`Downloader: ${report.path}`, `Version: ${report.version}`]);
  return 0;
}
