import type { CliOptions } from "../../options.ts";
import { result } from "../../output.ts";
import { probeMedia } from "../../../media/probe.ts";

export async function mediaProbeCommand(options: CliOptions): Promise<number> {
  const probe = await probeMedia(options.positionals[0]!);
  result(options, probe, [probe.path, `Duration: ${probe.durationSec.toFixed(3)} s`, ...(probe.hasVideo ? [`Video: ${probe.width}×${probe.height}, ${probe.fps?.toFixed(3)} fps`] : ["Audio-only media"]), `Audio: ${probe.hasAudio ? "yes" : "no"}`]);
  return 0;
}
