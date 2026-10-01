import { stringOption } from "../../options.ts";
import type { CliOptions } from "../../options.ts";
import { result } from "../../output.ts";
import { findBoundaries } from "../../../media/boundaries.ts";

export async function mediaBoundariesCommand(options: CliOptions): Promise<number> {
  const rate = stringOption(options, "rate");
  const threshold = stringOption(options, "threshold");
  const report = await findBoundaries(options.positionals[0]!, { ...(rate === undefined ? {} : { rate: Number(rate) }), ...(threshold === undefined ? {} : { threshold: Number(threshold) }) });
  result(options, report, [`${report.inputPath}: ${report.events.length} visual-change candidates (${report.rateHz} samples/s, threshold ${report.minChange})`, ...report.events.slice(0, 40).map(event => `${event.observedAtSec.toFixed(3)} s  ${event.changeMagnitude.toFixed(3)}`), ...(report.events.length > 40 ? [`${report.events.length - 40} additional candidates; use --json for all events.`] : [])]);
  return 0;
}
