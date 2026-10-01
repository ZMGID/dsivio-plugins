import { DvError } from "../../../core/errors.ts";
import { stringOption } from "../../options.ts";
import type { CliOptions } from "../../options.ts";
import { result } from "../../output.ts";
import { cutMedia } from "../../../media/cut.ts";
import type { CutInterval, CutOptions } from "../../../media/cut.ts";

export async function mediaCutCommand(options: CliOptions): Promise<number> {
  const to = stringOption(options, "to");
  if (!to) throw new DvError("CLI_USAGE", "media cut requires --to.", { hint: "Specify a new output path." });
  const cut: CutOptions = { labelTime: options.values["label-time"] === true };
  for (const key of ["start", "end"] as const) {
    const value = stringOption(options, key);
    if (value !== undefined) {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0) throw new DvError("CLI_USAGE", `--${key} must be finite non-negative seconds.`, { hint: "Use a number such as 1.5." });
      if (key === "start") cut.startSec = seconds;
      else cut.endSec = seconds;
    }
  }
  const keeps = options.values.keep;
  if (Array.isArray(keeps)) cut.keep = keeps.map((value): CutInterval => {
    const parts = value.split(":");
    if (parts.length !== 2 || parts.some(part => part.trim() === "")) throw new DvError("CLI_USAGE", `Invalid --keep ${value}.`, { hint: "Use --keep start:end with two finite non-negative seconds." });
    return { startSec: Number(parts[0]), endSec: Number(parts[1]) };
  });
  const report = await cutMedia(options.positionals[0]!, to, cut);
  result(options, report, [`Saved ${report.outputPath}`, `Intervals: ${report.inputIntervals.map(interval => `${interval.startSec}:${interval.endSec}`).join(", ")}`, `Requested: ${report.requestedDuration.toFixed(3)} s; measured: ${report.measuredDuration.toFixed(3)} s`, `Video: ${report.videoPresent ? "yes" : "no"}; audio: ${report.audioPresent ? "yes" : "no"}; source-time label: ${report.timeLabelled ? "yes" : "no"}`]);
  return 0;
}
