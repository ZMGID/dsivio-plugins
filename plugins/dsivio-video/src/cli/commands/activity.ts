import { setTimeout as sleep } from "node:timers/promises";
import { activity } from "../../build/observe.ts";
import type { ActivityView } from "../../build/observe.ts";
import type { CliOptions } from "../options.ts";
import { usage } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
import { buildLines, publicBuildView } from "../build-view.ts";
export async function activityCommand(options: CliOptions): Promise<number> {
  if (options.values.watch && options.json) usage("activity --watch does not support --json; use --jsonl.");
  if (options.values.jsonl && !options.values.watch) usage("--jsonl requires --watch.");
  const workspace = openWorkspace(options);
  const controller = new AbortController();
  const stop = (): void => { controller.abort(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let previous = "";
  try {
    do {
      const view: ActivityView = await activity(workspace, { limit: options.limit });
      const data = { ...view, activeBuilds: view.activeBuilds.map((build) => publicBuildView(build, options)) };
      const fingerprint = JSON.stringify({ ...data, observedAt: undefined });
      if (fingerprint !== previous) {
        if (options.values.jsonl) process.stdout.write(JSON.stringify(data) + "\n");
        else result(options, data, [`Worker: ${view.workerState.running ? `running (${view.workerState.pid})` : "stopped"}`, `Active Builds: ${view.activeBuilds.length + view.hiddenBuildTotal}; hidden: ${view.hiddenBuildTotal}`, ...view.activeBuilds.flatMap((build) => options.verbose ? buildLines(build, options) : [`  ${build.id}: ${build.work.state}; steps ${build.work.steps.done}/${build.work.steps.total}; completed needs ${build.work.needs.done} (${build.work.needs.total} discovered); result ${build.result.state}`, ...build.operationGroups.map((group) => `    ${group.backend ?? "local"}: ${group.phase} (${group.total})${group.progress ? ` — ${group.progress}` : ""}`)])]);
        previous = fingerprint;
      }
      if (!options.values.watch || controller.signal.aborted) break;
      await sleep(1000);
    } while (!controller.signal.aborted);
    return 0;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
