import { ResultsRepository } from "../../build/results.ts";
import type { CliOptions } from "../options.ts";
import { stringOption } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
export async function buildsCommand(options: CliOptions): Promise<number> {
  const repository = new ResultsRepository(openWorkspace(options).stateDir);
  const rows = await repository.list({ limit: options.limit + 1, before: stringOption(options, "before") });
  const shown = rows.slice(0, options.limit);
  const buildRows = shown.map((row) => ({ id: row.id, title: row.title, outcome: row.outcome, createdAt: row.createdAt, completedAt: row.completedAt, runSource: row.run, targetTotal: row.targets.length, outputTotal: Object.keys(row.outputs).length, ...(options.verbose ? { targets: row.targets.slice(0, options.limit), omittedTargets: Math.max(0, row.targets.length - options.limit) } : {}) }));
  const olderCursor = rows.length > options.limit ? shown.at(-1)!.id : null;
  result(options, { schema: "dsivio-video.builds-view/1", buildRows, olderCursor }, [...shown.map((row) => `${row.id}${row.title ? ` — ${row.title}` : ""}: ${row.outcome}; ${row.createdAt}; ${row.run}; ${row.targets.length} targets${options.verbose ? ` [${row.targets.slice(0, options.limit).join(", ")}]` : ""}`), ...(olderCursor ? [`More results: --before ${olderCursor}`] : []), ...(shown.length ? [] : ["No finished Builds."])]);
  return 0;
}
