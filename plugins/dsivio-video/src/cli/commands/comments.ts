import { resolve } from "node:path";
import { FeedbackStore } from "../../studio/feedback.ts";
import type { CommentState } from "../../studio/feedback.ts";
import { resolveStudioWorkspace } from "../../studio/session.ts";
import type { CliOptions, CommandSpec } from "../options.ts";
import { stringOption, usage } from "../options.ts";
import { result } from "../output.ts";

export const commentsSpec: CommandSpec = { usage: "comments list --run <run> [--workspace <root>] [--state open|resolved|all] [--json]", min: 1, max: 1, options: { run: "string", state: "string" } };
export async function commentsCommand(options: CliOptions): Promise<number> {
  if (options.positionals[0] !== "list") usage("Comments supports only list.");
  const run = stringOption(options, "run");
  if (!run) usage("comments list requires --run.");
  const state = stringOption(options, "state") ?? "open";
  if (state !== "open" && state !== "resolved" && state !== "all") usage("--state must be open, resolved or all.");
  const cwd = process.env.INIT_CWD || process.cwd();
  const workspace = resolveStudioWorkspace({ cwd, workspace: options.workspace, assetRoots: options.assetRoots });
  const list = await new FeedbackStore(workspace.root, resolve(cwd, run)).list(state as CommentState);
  const comments = list.comments.map((comment) => ({ ...comment.expectedComment, number: comment.number, resolved: comment.resolved }));
  result(options, { ...list, comments }, [`Comments: ${list.run}`, ...comments.flatMap((comment) => [`${comment.id} #${comment.number} ${comment.at}s [${comment.resolved ? "resolved" : "open"}]`, comment.text]), ...(comments.length ? [] : ["No matching comments."])]);
  return 0;
}
