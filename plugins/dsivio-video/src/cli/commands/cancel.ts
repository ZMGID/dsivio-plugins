import { cancelBuild } from "../../build/observe.ts";
import type { CliOptions } from "../options.ts";
import { stringOption } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
import { buildLines, publicBuildView } from "../build-view.ts";
export async function cancelCommand(options: CliOptions): Promise<number> {
  const id = options.positionals[0]!;
  const view = await cancelBuild(id, stringOption(options, "reason") ?? "Cancelled by user", openWorkspace(options));
  result(options, { schema: "dsivio-video.cancel-view/1", cancelRequested: view.cancelRequested, buildView: publicBuildView(view.buildView, options) }, view.buildView ? [view.cancelRequested ? "Cancellation requested (remote cancellation is not guaranteed)." : "Build already stopped.", ...buildLines(view.buildView, options)] : [`Build not found: ${id}`]);
  return view.buildView ? 0 : 1;
}
