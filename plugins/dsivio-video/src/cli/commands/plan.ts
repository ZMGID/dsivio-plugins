import type { CliOptions } from "../options.ts";
import { prepareRun } from "../project.ts";
import { planView } from "../plan-view.ts";
import { result } from "../output.ts";
export async function planCommand(options: CliOptions): Promise<number> {
  const prepared = await prepareRun(options.positionals[0]!, options);
  const view = planView(prepared, options);
  result(options, view.data, view.lines);
  return view.valid ? 0 : 1;
}
