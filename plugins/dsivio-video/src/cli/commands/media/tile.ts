import { DvError } from "../../../core/errors.ts";
import type { CliOptions } from "../../options.ts";
import { stringOption } from "../../options.ts";
import { result } from "../../output.ts";
import { mediaTile, mediaTiles } from "../../../media/grid.ts";
import type { TileOptions } from "../../../media/grid.ts";
import { readTranscript } from "../../../media/transcript.ts";
import { samplingOptions } from "./frames.ts";

async function gridOptions(options: CliOptions): Promise<TileOptions> {
  const to = stringOption(options, "to");
  if (!to) throw new DvError("CLI_USAGE", "media tile/tiles requires --to <new image/directory>.", { hint: "Choose an explicit target that does not already exist." });
  const parsed: TileOptions = { ...samplingOptions(options), to };
  for (const name of ["cell", "columns", "rows", "ranges"] as const) {
    const value = stringOption(options, name);
    if (value !== undefined) parsed[name] = value;
  }
  const transcript = stringOption(options, "transcript");
  if (transcript) parsed.transcript = await readTranscript(transcript);
  return parsed;
}
export async function mediaTileCommand(options: CliOptions): Promise<number> {
  const report = await mediaTile(options.positionals[0]!, await gridOptions(options));
  result(options, report, [`Saved ${report.items.length} frames in ${report.gridColumns} columns × ${report.usedRows} rows to ${report.outputPath}.`]);
  return 0;
}
export async function mediaTilesCommand(options: CliOptions): Promise<number> {
  const report = await mediaTiles(options.positionals[0]!, await gridOptions(options));
  result(options, report, [`Saved ${report.pages.length} grids to ${report.outputPath}.`]);
  return 0;
}
