import { DvError } from "../../../core/errors.ts";
import type { CliOptions } from "../../options.ts";
import { stringOption } from "../../options.ts";
import { result } from "../../output.ts";
import { mediaFrames } from "../../../media/frames.ts";
import type { SamplingOptions } from "../../../media/sample.ts";
import { readTranscript } from "../../../media/transcript.ts";

export function samplingOptions(options: CliOptions): SamplingOptions {
  const sampling: SamplingOptions = {};
  for (const name of ["at", "start", "end", "every", "frames", "around", "occurrence", "padding"] as const) {
    const value = stringOption(options, name);
    if (value !== undefined) sampling[name] = value;
  }
  if (options.values["every-frame"] === true) sampling.everyFrame = true;
  return sampling;
}
export async function mediaFramesCommand(options: CliOptions): Promise<number> {
  const to = stringOption(options, "to");
  if (!to) throw new DvError("CLI_USAGE", "media frames requires --to <new directory>.", { hint: "Choose a target directory that does not already exist." });
  const transcriptPath = stringOption(options, "transcript");
  const transcript = transcriptPath ? await readTranscript(transcriptPath) : undefined;
  const report = await mediaFrames(options.positionals[0]!, { ...samplingOptions(options), to, labelTime: options.values["label-time"] === true, ...(transcript ? { transcript } : {}) });
  result(options, report, [`Saved ${report.items.length} frames to ${report.outputPath}.`]);
  return 0;
}
