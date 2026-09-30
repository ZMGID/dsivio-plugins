import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ResultsRepository } from "../../build/results.ts";
import type { CliOptions } from "../options.ts";
import { stringOption } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
import { outputDescription } from "../result-view.ts";
export async function historyCommand(options: CliOptions): Promise<number> {
  const outputName = options.positionals[0]!;
  const source = stringOption(options, "source");
  let author = source === undefined ? undefined : resolve(source);
  if (author) {
    let ancestor = author;
    const suffix: string[] = [];
    while (true) {
      try { author = join(await realpath(ancestor), ...suffix); break; }
      catch (error) {
        if (!(error !== null && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) || dirname(ancestor) === ancestor) throw error;
        suffix.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
      }
    }
  }
  const repository = new ResultsRepository(openWorkspace(options).stateDir);
  const rows = await repository.history(outputName, { limit: options.limit + 1, before: stringOption(options, "before"), author });
  const shown = rows.slice(0, options.limit);
  const historyRows = await Promise.all(shown.map(async (row) => ({ buildId: row.id, title: row.title, createdAt: row.createdAt, outcome: row.outcome, author: row.author, output: await outputDescription(repository, row, outputName, row.outputs[outputName]!) })));
  const olderCursor = rows.length > options.limit ? shown.at(-1)!.id : null;
  result(options, { schema: "dsivio-video.history-view/1", outputName, authorFilter: author ?? null, historyRows, olderCursor }, [`History: ${outputName}`, ...historyRows.map((row) => `${row.buildId}: ${row.outcome}; ${row.createdAt}; ${row.output.nominalType} (${row.output.valueClass})`), ...(olderCursor ? [`More results: --before ${olderCursor}`] : []), ...(shown.length ? [] : ["No matching finished Outputs."])]);
  return 0;
}
