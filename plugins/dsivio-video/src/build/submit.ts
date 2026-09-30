import { spawn } from "node:child_process";
import { open, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExecutionDefinition } from "../core/graph.ts";
import type { ResourceRef } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import { buildId } from "./ids.ts";
import { ProjectStore } from "./resources.ts";
import { ResultsRepository } from "./results.ts";
import { BuildStore, WORKER_LEASE_MS } from "./store.ts";
import { workerWorkspace } from "./worker.ts";
import type { BuildWorkspace } from "./worker.ts";

export interface SubmitOptions { launcherPath?: string; startTimeoutMs?: number }
export interface SubmitInput {
  plan: { definition: ExecutionDefinition; assets: Map<string, { ref: ResourceRef; path: string }> };
  workspace: BuildWorkspace;
  title?: string;
}

export async function submitBuild({ plan, workspace, title }: SubmitInput, options: SubmitOptions = {}): Promise<string> {
  const project = workerWorkspace(workspace);
  const resources = new ProjectStore(project.stateDir);
  for (const asset of plan.assets.values()) await resources.adopt(asset.ref, asset.path);
  const id = buildId();
  const created = new Date().toISOString();
  const results = new ResultsRepository(project.stateDir);
  const store = new BuildStore(project.stateDir);
  let inserted = false;
  try {
    store.insert({ id, definition: plan.definition, title: title ?? null, author: plan.definition.author, run: plan.definition.run, created, state: "staged", outcome: "open", stopReason: null, cancelRequested: false });
    inserted = true;
    await results.write({ id, title: title ?? null, author: plan.definition.author, run: plan.definition.run, targets: plan.definition.targets, createdAt: created, completedAt: null, outcome: "open", failure: null, outputs: Object.fromEntries(Object.entries(plan.definition.forwarded).map(([name, forward]) => [name, { forward }])), operations: [] });
    const deadline = Date.now() + (options.startTimeoutMs ?? 5000);
    do {
      await ensureWorker(project, { ...options, startTimeoutMs: Math.max(0, deadline - Date.now()) });
      if (store.activate(id)) return id;
    } while (Date.now() < deadline);
    throw new DvError("WORKER_START_FAILED", "Worker retired before the Build could be activated");
  } catch (error) {
    const removed = inserted && store.removeStaged(id);
    if (removed) await rm(dirname(results.pathOf(id)), { recursive: true, force: true });
    if (inserted && !removed) {
      throw new DvError(error instanceof DvError ? error.code : "BUILD_SUBMISSION_FAILED", `Build ${id} remains queued; submission reporting failed`, { cause: error, hint: `Inspect ${id}; do not submit a duplicate Build.` });
    }
    if (error instanceof DvError && error.code !== "WORKER_START_FAILED") throw error;
    throw new DvError("WORKER_START_FAILED", "Worker could not start; no Build was queued", { cause: error });
  } finally { store.close(); }
}

export async function ensureWorker(workspace: BuildWorkspace | string, options: SubmitOptions = {}): Promise<void> {
  const project = workerWorkspace(workspace);
  const runtime = join(project.stateDir, "runtime");
  const store = new BuildStore(project.stateDir);
  const deadline = Date.now() + (options.startTimeoutMs ?? 5000);
  let launched = false;
  let startupError: Error | undefined;
  try {
    do {
      const owner = store.workerOwner();
      const fresh = owner && owner.heartbeatAt >= Date.now() - WORKER_LEASE_MS;
      if (fresh && !owner.stopRequested) return;
      if (!fresh && !launched) {
        await mkdir(runtime, { recursive: true });
        const log = await open(join(runtime, "worker.log"), "a");
        try {
          const launcher = options.launcherPath ?? fileURLToPath(new URL("../../bin/dsivio-video.mjs", import.meta.url));
          const child = spawn(process.execPath, [launcher, "_worker", "--workspace", project.root], { detached: true, stdio: ["ignore", log.fd, log.fd], cwd: project.root });
          child.on("error", (error: Error) => { startupError = error; });
          child.unref();
          launched = true;
        } finally { await log.close(); }
      }
      if (startupError) throw startupError;
      await sleep(20);
    } while (Date.now() < deadline);
    throw new DvError("WORKER_START_FAILED", "Worker did not acquire a fresh execution lease");
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("WORKER_START_FAILED", "Worker could not start", { cause: error });
  } finally { store.close(); }
}
