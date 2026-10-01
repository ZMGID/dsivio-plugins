import { DvError } from "../core/errors.ts";
import { isResourceRef } from "../core/value.ts";
import type { Json, ResourceRef } from "../core/value.ts";
import { validateBuildId } from "../build/ids.ts";
import { BuildStore } from "../build/store.ts";
import { ResultsRepository } from "../build/results.ts";
import { buildView } from "../build/observe.ts";
import type { BuildWorkspace } from "../build/worker.ts";
import type { ArtifactCard, ArtifactQuery, ArtifactsPage, RenameArtifactRequest, TaskCard, TaskQuery, TasksPage } from "./protocol.ts";

interface OwnedFile { build: string; output: string; resource: ResourceRef }
function pageLimit(value: number | undefined): number {
  const limit = value ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new DvError("LIBRARY_INVALID", "Library limit must be an integer from 1 to 200.");
  return limit;
}

/** Reads the existing Build/Result stores; never submits work or discovers files by directory. */
export class StudioLibraries {
  readonly workspace: BuildWorkspace;
  readonly results: ResultsRepository;
  constructor(workspace: BuildWorkspace) { this.workspace = workspace; this.results = new ResultsRepository(workspace.stateDir); }
  private async ids(before?: string): Promise<string[]> {
    if (before !== undefined) validateBuildId(before);
    const store = new BuildStore(this.workspace.stateDir);
    try {
      const persisted = store.list({ before, limit: Number.MAX_SAFE_INTEGER }).map((row) => row.id);
      const manifests = await this.results.list({ before, includeOpen: true, limit: Number.MAX_SAFE_INTEGER });
      return [...new Set([...persisted, ...manifests.map((row) => row.id)])].sort().reverse();
    } catch (error) {
      if (error instanceof DvError) throw error;
      throw new DvError("LIBRARY_READ", "Cannot read project Build library.", { cause: error });
    } finally { store.close(); }
  }
  async tasks(query: TaskQuery = {}): Promise<TasksPage> {
    const limit = pageLimit(query.limit), filter = query.state ?? "all";
    if (!["all", "active", "ended"].includes(filter)) throw new DvError("LIBRARY_INVALID", "Task state must be all, active or ended.");
    const tasks: TaskCard[] = [];
    const store = new BuildStore(this.workspace.stateDir);
    try {
      for (const id of await this.ids(query.before)) {
        const view = await buildView(id, this.workspace);
        if (!view) continue;
        const active = view.work.state === "working" || view.work.state === "submitting" || view.result.state === "open";
        if (filter !== "all" && active !== (filter === "active")) continue;
        const build = store.read(id), manifest = await this.results.read(id);
        const state = view.failure ? "failed" : view.work.outcome === "cancelled" ? "cancelled" : view.attention.length ? "action-required" : active ? "running" : view.work.outcome;
        tasks.push({ id, state, runFile: build?.run ?? manifest?.run, title: view.title ?? undefined, error: view.failure ? `${view.failure.code}: ${view.failure.message}` : undefined,
          operations: view.operations.map((operation) => ({ ...operation })), result: { ...view.result }, work: { ...view.work, needs: { ...view.work.needs }, steps: { ...view.work.steps } }, attention: view.attention,
          plan: build?.definition as unknown as Json | undefined,
          requests: store.operations(id).map((operation) => ({ command: operation.command, request: operation.request, model: operation.summary.model ?? null, phase: operation.phase, progress: operation.progress, error: operation.error })) });
        if (tasks.length > limit) break;
      }
    } catch (error) {
      if (error instanceof DvError) throw error;
      throw new DvError("LIBRARY_READ", "Cannot read tasks.", { cause: error });
    } finally { store.close(); }
    return { tasks: tasks.slice(0, limit), ...(tasks.length > limit ? { before: tasks[limit - 1]!.id } : {}) };
  }
  private async owner(build: string, output: string, seen = new Set<string>()): Promise<OwnedFile | undefined> {
    const key = `${build}:${output}`;
    if (seen.has(key)) throw new DvError("HISTORY_CYCLE", `Artifact forwarding cycle at ${key}`);
    seen.add(key);
    const manifest = await this.results.read(build);
    if (!manifest || !Object.hasOwn(manifest.outputs, output)) throw new DvError("OUTPUT_MISSING", `Artifact Output ${key} is missing.`);
    const item = manifest.outputs[output]!;
    if ("forward" in item) return this.owner(item.forward.build, item.forward.output, seen);
    if (item.class !== "resource" || !isResourceRef(item.value)) return undefined;
    return { build, output, resource: item.value };
  }
  async artifactResource(build: string, output: string): Promise<ResourceRef> {
    const owner = await this.owner(build, output);
    if (!owner || !/^(image|video|audio)\//.test(owner.resource.mime)) throw new DvError("OUTPUT_MISSING", `Output ${build}:${output} is not a top-level media file.`);
    return owner.resource;
  }
  async artifacts(query: ArtifactQuery = {}): Promise<ArtifactsPage> {
    const limit = pageLimit(query.limit), kind = query.kind ?? "all";
    if (!["all", "image", "video", "audio"].includes(kind)) throw new DvError("LIBRARY_INVALID", "Artifact kind must be all, image, video or audio.");
    if (query.build !== undefined) validateBuildId(query.build);
    const cards = new Map<string, ArtifactCard>();
    const ids = query.build ? [query.build] : await this.ids(query.before);
    let before: string | undefined;
    for (const id of ids) {
      const versioned = await this.results.readVersioned(id);
      if (!versioned) continue;
      for (const [output, item] of Object.entries(versioned.manifest.outputs)) {
        const owner = await this.owner(id, output);
        if (!owner) continue;
        const mediaKind = owner.resource.mime.split("/")[0];
        if (mediaKind !== "image" && mediaKind !== "video" && mediaKind !== "audio") continue;
        if (kind !== "all" && mediaKind !== kind) continue;
        const key = `${owner.build}:${owner.output}`;
        const source = { build: id, output, displayName: item.displayName ?? output, manifestVersion: versioned.manifestVersion, outcome: versioned.manifest.outcome };
        const existing = cards.get(key);
        if (existing) {
          existing.sources = [...existing.sources, source];
          existing.highlight = existing.highlight || versioned.manifest.targets.includes(output);
        }
        else cards.set(key, { key, kind: mediaKind, resource: owner.resource, owner: { build: owner.build, output: owner.output }, sources: [source], highlight: versioned.manifest.targets.includes(output) });
      }
      if (!query.build && cards.size >= limit) { const index = ids.indexOf(id); if (index < ids.length - 1) before = id; break; }
    }
    return { artifacts: [...cards.values()].sort((a, b) => Number(b.highlight) - Number(a.highlight)), ...(before ? { before } : {}) };
  }
  async rename(request: RenameArtifactRequest): Promise<{ manifestVersion: string; displayName: string }> {
    if (!request || typeof request.build !== "string") throw new DvError("RESULT_RENAME_INVALID", "A Build is required.");
    const result = await this.results.renameOutput(request.build, request.output, request.expectedManifestVersion, request.displayName);
    return { manifestVersion: result.manifestVersion, displayName: result.manifest.outputs[request.output]!.displayName! };
  }
}
