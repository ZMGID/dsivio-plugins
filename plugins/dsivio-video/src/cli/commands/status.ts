import { buildView } from "../../build/observe.ts";
import type { CliOptions } from "../options.ts";
import { integer, stringOption, usage } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
import { buildLines, followBuild, publicBuildView } from "../build-view.ts";
export async function statusCommand(options: CliOptions): Promise<number> {
  if (options.values["max-wait-ms"] !== undefined && !options.values.watch) usage("--max-wait-ms requires --watch.");
  const wait = integer(stringOption(options, "max-wait-ms"), "max-wait-ms", Number.MAX_SAFE_INTEGER);
  const workspace = openWorkspace(options);
  const id = options.positionals[0]!;
  const view = options.values.watch ? await followBuild(id, workspace, wait) : await buildView(id, workspace);
  result(options, { schema: "dsivio-video.build-view/1", buildView: publicBuildView(view, options) }, view ? buildLines(view, options) : [`Build not found: ${id}`]);
  return !view || view.work.outcome === "failed" || view.work.outcome === "cancelled" ? 1 : 0;
}
