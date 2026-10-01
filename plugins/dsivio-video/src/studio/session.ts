import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DvError } from "../core/errors.ts";
import type { AuthoringIndex } from "../core/authoring.ts";
import type { ResourceRef } from "../core/value.ts";
import { Workspace } from "../source/workspace.ts";
import type { WorkspaceOptions } from "../source/workspace.ts";
import { ProjectStore } from "../build/resources.ts";
import { StudioCache } from "./cache.ts";
import * as registry from "../modules/index.ts";
import { loadDisplay, studioCompanions } from "./display.ts";
import type { DisplayResult } from "./display.ts";
import { assertSourceWrite } from "./security.ts";
import { StudioWatcher } from "./watch.ts";
import type { SourceEditRequest, SourceResponse, StudioDiagnostic, StudioState, ViewRevision } from "./protocol.ts";

export function resolveStudioWorkspace(options: WorkspaceOptions): Workspace {
  const cwd = realpathSync(resolve(options.cwd));
  let root = options.workspace ? resolve(cwd, options.workspace) : cwd;
  if (!options.workspace) for (let candidate = cwd; ; candidate = dirname(candidate)) {
    if (existsSync(join(candidate, "package.json")) && statSync(join(candidate, "package.json")).isFile()) { root = candidate; break; }
    if (dirname(candidate) === candidate) break;
  }
  return Workspace.open({ ...options, cwd, workspace: root });
}
export function sourceHash(text: string): string { return createHash("sha256").update(text).digest("hex"); }
export function studioError(error: unknown): DvError { return error instanceof DvError ? error : new DvError("STUDIO_FAILED", error instanceof Error ? error.message : String(error), { cause: error }); }
function diagnostic(error: unknown, revision: number): StudioDiagnostic {
  const failure = studioError(error);
  return { code: failure.code, message: failure.message, viewRevision: revision, ...(failure.span ? { span: failure.span } : {}) };
}
export class StudioSession extends EventEmitter {
  readonly workspace: Workspace;
  readonly runFile: string;
  readonly sessionId = randomUUID();
  readonly resources: ProjectStore;
  readonly cache: StudioCache;
  readonly companions = studioCompanions();
  state: StudioState = { requestedRevision: 0, publishedRevision: 0, dirty: true, status: "compiling" };
  authoring: AuthoringIndex = { units: new Map(), elements: new Map(), relations: [], references: [], inputs: [] };
  private readonly stopped = new AbortController();
  private readonly prepared = new WeakMap<ViewRevision, DisplayResult>();
  private readonly registered = new Map<string, { ref: ResourceRef; path: string }>();
  private generation = 0;
  private busy = false;
  private watcher?: StudioWatcher;
  private closed = false;
  private readonly discovered = new Set<string>();
  private readonly ownedWrites = new Map<string, string>();
  private readonly loader: typeof loadDisplay;
  constructor(workspace: Workspace, runFile: string, options: { loader?: typeof loadDisplay } = {}) {
    super(); this.workspace = workspace; this.runFile = runFile; this.loader = options.loader ?? loadDisplay;
    this.resources = new ProjectStore(workspace.stateDir);
    this.cache = new StudioCache({ stateDir: workspace.stateDir, registry, resources: this.resources });
    this.discovered.add(runFile);
  }
  async start(): Promise<void> {
    this.watcher = new StudioWatcher({ files: [this.runFile], feedbackFile: join(this.workspace.root, "FEEDBACK.json"), onDirty: files => { if (files.some(file => !this.ownedWrites.has(file) || this.ownedWrites.get(file) !== this.workspace.readText(file))) this.markDirty(); }, onCompile: () => { if (this.state.dirty) void this.compile(); }, onComments: () => this.emit("comments-changed"), onError: error => { this.state = { ...this.state, dirty: false, status: "error", error: diagnostic(error, this.state.requestedRevision) }; this.emit("compile-error", this.state); } });
    void this.compile();
  }
  markDirty(): void {
    this.generation++; this.state = { ...this.state, dirty: true, status: "compiling", error: undefined };
    this.emit("compiling", this.state);
  }
  async loadView(revision: number, overlay?: ReadonlyMap<string, string>): Promise<ViewRevision> {
    const result = await this.loader({ workspace: this.workspace, runFile: this.runFile, sessionId: this.sessionId, cache: this.cache, resources: this.resources, signal: this.stopped.signal, log: message => this.emit("preparing", message), onSources: (authoring, files) => {
      for (const file of files) this.discovered.add(file);
      this.watcher?.addFiles(this.discovered);
      if (revision === this.state.requestedRevision) {
        this.authoring = authoring;
        this.state = { ...this.state, sourceUnits: [...authoring.units.values()].map(({ unit, fileName, language, sourceVersion }) => ({ unit, fileName, language, sourceVersion })) };
        this.emit("compiling", this.state);
      }
    } }, revision, overlay);
    this.prepared.set(result.view, result);
    for (const file of result.files) this.discovered.add(file);
    this.watcher?.addFiles(this.discovered);
    return result.view;
  }
  private publish(view: ViewRevision): void {
    const result = this.prepared.get(view);
    if (!result) throw new DvError("STUDIO_PUBLICATION_INVALID", "View did not originate from this session");
    this.authoring = result.authoring;
    for (const ref of result.resources) this.registerResource(ref);
    this.state = { requestedRevision: view.viewRevision, publishedRevision: view.viewRevision, dirty: false, status: "ready", view };
    this.emit("view", this.state);
  }
  async compile(): Promise<void> {
    if (this.closed || this.busy) return;
    const generation = this.generation;
    const revision = this.state.requestedRevision + 1;
    this.state = { ...this.state, requestedRevision: revision, dirty: true, status: "compiling", error: undefined };
    this.emit("compiling", this.state);
    try {
      const view = await this.loadView(revision);
      if (this.closed || revision !== this.state.requestedRevision || generation !== this.generation) return;
      const result = this.prepared.get(view)!;
      for (const unit of result.authoring.units.values()) if (sourceHash(this.workspace.readText(unit.file)) !== unit.sourceVersion) { this.markDirty(); void this.compile(); return; }
      this.publish(view);
    } catch (error) {
      const failure = studioError(error);
      // Keep all discovered source paths watched even when an import fails before an index exists.
      if (failure.span?.file) { this.discovered.add(failure.span.file); this.watcher?.addFiles(this.discovered); }
      if (this.closed || revision !== this.state.requestedRevision || generation !== this.generation) return;
      if (failure.code === "STUDIO_SOURCE_CHANGED") { this.markDirty(); void this.compile(); return; }
      this.state = { ...this.state, dirty: false, status: "error", error: diagnostic(failure, revision) };
      this.emit("compile-error", this.state);
    }
  }
  currentView(): ViewRevision {
    if (this.state.status === "error") throw new DvError("STUDIO_COMPILE_FAILED", this.state.error?.message ?? "Studio compilation failed");
    if (this.busy || this.state.dirty || this.state.status !== "ready" || this.state.requestedRevision !== this.state.publishedRevision || !this.state.view) throw new DvError("STUDIO_NOT_READY", "Studio is compiling a newer view");
    return this.state.view;
  }
  source(unitKey: string): SourceResponse {
    const unit = this.authoring.units.get(unitKey);
    if (!unit) throw new DvError("STUDIO_SOURCE_NOT_FOUND", "Unknown source unit");
    const text = this.workspace.readText(unit.file);
    return { unit: unit.unit, fileName: unit.fileName, text, sourceVersion: sourceHash(text), viewRevision: this.state.requestedRevision };
  }
  async saveSource(request: SourceEditRequest): Promise<StudioState> {
    if (this.busy || request.expectedViewRevision !== this.state.requestedRevision) throw new DvError("STUDIO_CONFLICT", "Source view version is stale");
    const unit = this.authoring.units.get(request.unit);
    if (!unit) throw new DvError("STUDIO_SOURCE_NOT_FOUND", "Unknown source unit");
    const path = assertSourceWrite(this.workspace.root, unit.file, [...this.authoring.units.values()].map(row => row.file));
    const original = this.workspace.readText(path);
    if (sourceHash(original) !== request.expectedSourceVersion) throw new DvError("STUDIO_CONFLICT", "Source changed on disk");
    if (original === request.text) return this.state;
    this.busy = true;
    try {
      const temporary = `${path}.studio-${randomUUID()}`;
      await writeFile(temporary, request.text, { flag: "wx" });
      this.ownedWrites.set(path, request.text);
      try { if (this.workspace.readText(path) !== original) throw new DvError("STUDIO_CONFLICT", "Source changed before save"); assertSourceWrite(this.workspace.root, path, [path]); await rename(temporary, path); }
      finally { await rm(temporary, { force: true }); }
      this.watcher?.acknowledgeFiles([path]);
      this.markDirty();
    } finally { this.ownedWrites.delete(path); this.busy = false; }
    await this.compile();
    return this.state;
  }
  async transaction(overlay: ReadonlyMap<string, string>): Promise<ViewRevision> {
    const oldView = this.currentView();
    if (this.busy) throw new DvError("STUDIO_CONFLICT", "An edit transaction is already running");
    const originals = new Map<string, string>();
    const closure = [...this.authoring.units.values()].map(unit => unit.file);
    for (const unit of this.authoring.units.values()) { const text = this.workspace.readText(unit.file); if (sourceHash(text) !== unit.sourceVersion) throw new DvError("STUDIO_CONFLICT", "Author source changed on disk"); originals.set(unit.file, text); }
    const changes = [...overlay].filter(([file, text]) => originals.get(file) !== text);
    if (!changes.length) return oldView;
    for (const [file] of changes) assertSourceWrite(this.workspace.root, file, closure);
    this.busy = true;
    const generation = this.generation;
    const revision = this.state.requestedRevision + 1;
    const prior = this.state;
    this.state = { ...prior, dirty: true, status: "compiling" };
    this.emit("compiling", this.state);
    const published: string[] = [];
    const temporary = new Map<string, string>();
    try {
      let view: ViewRevision;
      try { view = await this.loadView(revision, overlay); }
      catch (error) { const failure = studioError(error); throw new DvError("STUDIO_EDIT_INVALID", failure.message, { span: failure.span, cause: failure }); }
      if (generation !== this.generation) throw new DvError("STUDIO_CONFLICT", "Author source changed during validation");
      for (const [file, text] of originals) if (this.workspace.readText(file) !== text) throw new DvError("STUDIO_CONFLICT", "Author source changed during validation");
      for (const [file, text] of changes) { const path = `${file}.studio-${randomUUID()}`; temporary.set(file, path); await writeFile(path, text, { flag: "wx" }); }
      for (const [file, text] of changes) this.ownedWrites.set(file, text);
      for (const [file] of changes) { assertSourceWrite(this.workspace.root, file, closure); if (this.workspace.readText(file) !== originals.get(file)) throw new DvError("STUDIO_CONFLICT", "Author source changed before publication"); await rename(temporary.get(file)!, file); published.push(file); }
      for (const [file, original] of originals) if (this.workspace.readText(file) !== (overlay.get(file) ?? original)) throw new DvError("STUDIO_CONFLICT", "Author source changed while publishing the transaction");
      this.watcher?.acknowledgeFiles(changes.map(([file]) => file));
      this.publish(view);
      return view;
    } catch (error) {
      let restoreConflict = false;
      for (const file of published) {
        if (this.workspace.readText(file) !== overlay.get(file)) { restoreConflict = true; continue; }
        const path = `${file}.studio-${randomUUID()}`; await writeFile(path, originals.get(file)!, { flag: "wx" }); await rename(path, file);
      }
      this.watcher?.acknowledgeFiles(published);
      if (restoreConflict) { this.state = { ...this.state, status: "error", dirty: true, error: diagnostic(new DvError("STUDIO_CONFLICT", "Concurrent edit prevented safe transaction restoration"), revision) }; this.emit("compile-error", this.state); }
      else if (generation === this.generation) { this.state = prior; this.emit("view", this.state); }
      throw studioError(error);
    } finally {
      for (const path of temporary.values()) await rm(path, { force: true });
      for (const [file] of changes) this.ownedWrites.delete(file);
      this.busy = false;
      if (this.state.dirty && generation !== this.generation) void this.compile();
    }
  }
  registerResource(ref: ResourceRef): void {
    const previous = this.registered.get(ref.$resource);
    if (previous && (previous.ref.bytes !== ref.bytes || previous.ref.mime !== ref.mime)) throw new DvError("STUDIO_RESOURCE_CONFLICT", "Resource identity changed");
    if (!previous) this.registered.set(ref.$resource, { ref, path: this.resources.pathOf(ref) });
  }
  material(id: string): { ref: ResourceRef; path: string } {
    const material = this.registered.get(id);
    if (!material) throw new DvError("STUDIO_MATERIAL_NOT_FOUND", "Unknown material");
    return material;
  }
  async close(): Promise<void> {
    this.closed = true; this.stopped.abort(); this.watcher?.close(); this.emit("close");
    await rm(join(this.workspace.stateDir, "studio", "scratch", this.sessionId), { recursive: true, force: true });
    this.removeAllListeners();
  }
}
