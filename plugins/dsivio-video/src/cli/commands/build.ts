import { DvError } from "../../core/errors.ts";
import { submitBuild } from "../../build/submit.ts";
import { buildView } from "../../build/observe.ts";
import type { CliOptions } from "../options.ts";
import { integer, stringOption, usage } from "../options.ts";
import { prepareRun } from "../project.ts";
import { planView } from "../plan-view.ts";
import { result } from "../output.ts";
import { buildLines, followBuild, publicBuildView } from "../build-view.ts";
export async function buildCommand(options: CliOptions): Promise<number> {
  if (options.values["max-wait-ms"] !== undefined && !options.values.follow) usage("--max-wait-ms requires --follow.");
  const maxWaitMs = integer(stringOption(options, "max-wait-ms"), "max-wait-ms", Number.MAX_SAFE_INTEGER);
  const prepared = await prepareRun(options.positionals[0]!, options);
  const preview = planView(prepared, options);
  if (!preview.valid) {
    const rejected = prepared.needs.find((need) => need.kind === "issue" || (need.kind === "request" && !need.resolution.ok));
    const hint = "Fix the rejected plan before submitting; nothing was queued.";
    if (rejected?.kind === "issue") throw new DvError(rejected.code, rejected.message, { hint });
    if (rejected?.kind === "request" && !rejected.resolution.ok) throw new DvError(rejected.resolution.code, rejected.resolution.reason, { hint });
  }
  const title = stringOption(options, "title");
  const id = await submitBuild({ plan: prepared.plan, workspace: prepared.workspace, ...(title ? { title } : {}) });
  const view = options.values.follow ? await followBuild(id, prepared.workspace, maxWaitMs) : await buildView(id, prepared.workspace);
  if (!view) throw new DvError("BUILD_NOT_FOUND", `Submitted Build ${id} could not be observed.`);
  const nextCommands = [`dsivio-video status ${id} --watch`, `dsivio-video cancel ${id}`, ...view.targets.map((output) => `dsivio-video get ${id} --output ${output} --to <path>`)];
  result(options, { schema: "dsivio-video.build-view/1", buildView: publicBuildView(view, options), nextCommands }, [...buildLines(view, options), "Next commands:", ...nextCommands.map((command) => `  ${command}`)]);
  return view.work.outcome === "failed" || view.work.outcome === "cancelled" ? 1 : 0;
}
