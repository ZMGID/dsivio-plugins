import { resolve } from "node:path";
import type { CliOptions } from "./options.ts";
import { Workspace } from "../source/workspace.ts";
import { readRun } from "../run/parse.ts";
import { compileAuthor } from "../elaborate/compile.ts";
import { planRun } from "../plan/plan.ts";
import type { Plan } from "../plan/plan.ts";
import { previewNeeds } from "../plan/preview.ts";
import type { NeedPreview } from "../plan/preview.ts";
import { ResultsRepository } from "../build/results.ts";

export interface PreparedRun { workspace: Workspace; plan: Plan; needs: NeedPreview[] }
export function openWorkspace(options: CliOptions): Workspace {
  return Workspace.open({ cwd: process.cwd(), ...(options.workspace ? { workspace: options.workspace } : {}), assetRoots: options.assetRoots });
}
export async function prepareRun(file: string, options: CliOptions): Promise<PreparedRun> {
  const workspace = openWorkspace(options);
  const run = readRun(resolve(file), workspace);
  const author = compileAuthor(run.author, workspace);
  const plan = await planRun(run, author, new ResultsRepository(workspace.stateDir), workspace);
  const needs = await previewNeeds(plan.definition, { projectRoot: workspace.root });
  return { workspace, plan, needs };
}
