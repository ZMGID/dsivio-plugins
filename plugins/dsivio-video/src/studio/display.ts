import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AuthoringIndex } from "../core/authoring.ts";
import type { AuthorGraph, AuthorOperation, InputSource, RunIntent } from "../core/graph.ts";
import { DvError } from "../core/errors.ts";
import { BuildMachine } from "../core/machine.ts";
import { resourcesIn } from "../core/value.ts";
import type { Json, ResourceRef, Value } from "../core/value.ts";
import { compileAuthorDetailed } from "../elaborate/compile.ts";
import { readRun } from "../run/parse.ts";
import { SourceIndexBuilder } from "../elaborate/source-index.ts";
import { ResultsRepository } from "../build/results.ts";
import { ProjectStore } from "../build/resources.ts";
import { executeCommand, studioExecutionPolicy } from "../build/execute.ts";
import { planRun } from "../plan/plan.ts";
import { planDisplayRun } from "../plan/display.ts";
import type { DisplayPlan } from "../plan/display.ts";
import { compileDocument } from "../render/document.ts";
import { validateComposition } from "../render/composition.ts";
import { renderTypes } from "../render/ir.ts";
import { validateAudioTrack, validateVisualTrack } from "../render/validate.ts";
import { validateTimeline } from "../timeline/validate.ts";
import type { Timeline } from "../timeline/types.ts";
import * as registry from "../modules/index.ts";
import type { Workspace } from "../source/workspace.ts";
import { StudioCache } from "./cache.ts";
import type { CompanionInput, CompanionProjection, FilmFacet, StudioCompanion } from "./companion.ts";
import type { FieldSchema, ViewRevision } from "./protocol.ts";
import { createProjection } from "./projection.ts";

export interface DisplayResult { view: ViewRevision; authoring: AuthoringIndex; graph: AuthorGraph; plan: DisplayPlan; resources: readonly ResourceRef[]; files: readonly string[] }
export interface DisplayOptions { workspace: Workspace; runFile: string; sessionId: string; cache: StudioCache; resources: ProjectStore; signal: AbortSignal; log(message: string): void; onSources?(authoring: AuthoringIndex, files: readonly string[]): void }
export function studioCompanions(): readonly StudioCompanion[] {
  const companions = registry.modules.flatMap(module => [...(module.studio ?? [])]);
  const keys = new Set<string>(); const matches = new Set<string>();
  for (const companion of companions) {
    if (companion.protocol !== "dsivio-video.studio-companion/1" || keys.has(companion.key)) throw new DvError("STUDIO_COMPANION_INVALID", `Duplicate or incompatible Companion ${companion.key}`);
    keys.add(companion.key);
    const module = registry.findModule(companion.moduleId);
    if (!module) throw new DvError("STUDIO_COMPANION_INVALID", `Unknown Companion module ${companion.moduleId}`);
    for (const match of companion.matches) {
      const key = `${companion.moduleId}:${match.surface}:${match.output}:${match.type}`;
      const hash = match.type.lastIndexOf("#");
      if (matches.has(key) || !Object.hasOwn(module.surfaces, match.surface) || !registry.findModule(match.type.slice(0, hash))?.types[match.type.slice(hash + 1)]) throw new DvError("STUDIO_COMPANION_INVALID", `Invalid or duplicate Companion match ${key}`);
      matches.add(key);
    }
  }
  return Object.freeze(companions);
}
async function selectFilm(run: RunIntent, graph: AuthorGraph, workspace: Workspace, companions: readonly StudioCompanion[]): Promise<{ operation: AuthorOperation; facet: FilmFacet }> {
  if (!run.targets.length) throw new DvError("STUDIO_FILM_REQUIRED", "Studio requires a Run target that selects one Film");
  const fullPlan = await planRun(run, graph, new ResultsRepository(workspace.stateDir), workspace);
  const selected = new Map<string, { operation: AuthorOperation; facet: FilmFacet }>();
  const candidates = [...fullPlan.definition.steps.map(step => graph.operations.get(step.key)!), ...Object.keys(fullPlan.definition.outputs).map(name => graph.outputs.get(name)!).filter(output => output && companions.some(c => c.film?.composition.type === output.type)).map(output => graph.operations.get(output.operation)!)];
  for (const operation of candidates) for (const companion of companions) {
    const facet = companion.film;
    if (facet && operation.outputs[facet.composition.output] === facet.composition.type) selected.set(operation.key, { operation, facet });
  }
  if (selected.size !== 1) throw new DvError("STUDIO_FILM_REQUIRED", `Run must select exactly one Film; found ${selected.size}`);
  return [...selected.values()][0]!;
}
export async function preflightStudio(runFile: string, workspace: Workspace): Promise<void> {
  const run = readRun(runFile, workspace);
  const { graph } = compileAuthorDetailed(run.author, workspace);
  const film = await selectFilm(run, graph, workspace, studioCompanions());
  const timeline = film.operation.inputs[film.facet.timeline.input];
  if (!timeline || Array.isArray(timeline)) throw new DvError("STUDIO_TIMELINE_REQUIRED", "Film requires exactly one Timeline input");
}
export async function loadDisplay(options: DisplayOptions, requestedRevision: number, overlay?: ReadonlyMap<string, string>): Promise<DisplayResult> {
  const { workspace, runFile, sessionId, cache, signal } = options;
  const snapshot = new Map<string, string>();
  const sourceWorkspace = new Proxy(workspace, { get(target, property, receiver) {
    if (property === "readText") return (file: string, settings?: { asset?: boolean }) => {
      const existing = overlay?.get(file) ?? snapshot.get(file);
      if (existing !== undefined) return existing;
      const text = target.readText(file, settings); snapshot.set(file, text); return text;
    };
    return Reflect.get(target, property, receiver);
  } });
  const run = readRun(runFile, sourceWorkspace);
  const { graph, authoring } = compileAuthorDetailed(run.author, sourceWorkspace, registry, { overlay });
  const runSources = new SourceIndexBuilder(workspace.root);
  runSources.addUnit(runFile, sourceWorkspace.readText(runFile), "dvrun");
  const combinedUnits = new Map([...runSources.units, ...authoring.units]);
  Object.assign(authoring, { units: combinedUnits });
  if (!overlay) options.onSources?.(authoring, [runFile, ...graph.sources, ...[...graph.assets.values()].map(asset => asset.path)]);
  const companions = studioCompanions();
  const { operation: film, facet } = await selectFilm(run, graph, sourceWorkspace, companions);
  const timelineSource = film.inputs[facet.timeline.input];
  if (!timelineSource || Array.isArray(timelineSource)) throw new DvError("STUDIO_TIMELINE_REQUIRED", "Film requires exactly one Timeline input");
  const roots: InputSource[] = [{ operation: film.key, port: facet.composition.output }, timelineSource];
  const selectedComposition = [...graph.outputs.values()].some(output => output.operation === film.key && output.port === facet.composition.output && run.satisfy.has(output.name));
  // A historical Composition is a transparent terminal value, but its bypassed author Tracks have no executed lineage.
  if (!selectedComposition) for (const track of facet.tracks) { const input = film.inputs[track.input]; if (input) roots.push(...(Array.isArray(input) ? input : [input])); }
  // Companion support outputs are explicit public siblings, never inferred by JSON shape.
  const rootKeys = new Set(roots.map(source => "record" in source ? source.record : `${source.operation}.${source.port}`));
  const addSupports = (source: InputSource): void => {
    if ("record" in source) return;
    const relation = authoring.relations.find(row => row.bindingKey === `${source.operation}.${source.port}`);
    const element = relation && authoring.elements.get(relation.authorKey);
    if (!element) return;
    for (const companion of companions) if (companion.moduleId === element.moduleId && companion.matches.some(match => match.surface === element.surface.slice(element.surface.lastIndexOf(":") + 1) && match.output === source.port)) {
      for (const support of companion.supports ?? []) {
        const output = [...graph.outputs.values()].find(row => row.port === support.output && row.type === support.type && authoring.relations.some(relation => relation.bindingKey === `${row.operation}.${row.port}` && relation.authorKey === element.authorKey));
        if (output && !rootKeys.has(`${output.operation}.${support.output}`)) { roots.push({ operation: output.operation, port: support.output }); rootKeys.add(`${output.operation}.${support.output}`); }
      }
    }
  };
  for (let index = 0; index < roots.length; index++) addSupports(roots[index]!);
  const plan = await planDisplayRun(run, graph, new ResultsRepository(workspace.stateDir), sourceWorkspace, roots);
  const replacements = new Map<string, ResourceRef>();
  for (const [id, asset] of plan.assets) replacements.set(id, await cache.ingestSource(asset.ref, asset.path));
  const replace = (data: Json): Json => {
    if (data && typeof data === "object" && !Array.isArray(data) && typeof data.$resource === "string") { const ref = replacements.get(data.$resource); if (ref) return { ...ref }; }
    if (Array.isArray(data)) return data.map(replace);
    if (data && typeof data === "object") return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, replace(value)]));
    return data;
  };
  for (const seed of Object.values(plan.definition.seeds)) seed.data = replace(seed.data);
  const machine = new BuildMachine(plan.definition);
  while (machine.state === "running") {
    if (signal.aborted) throw new DvError("STUDIO_ABORTED", "Studio compilation cancelled");
    const commands = machine.ready();
    if (!commands.length) throw new DvError("STUDIO_GRAPH_BLOCKED", "Display graph has no ready command");
    for (const command of commands) {
      const workDir = join(workspace.stateDir, "studio", "scratch", sessionId, String(requestedRevision), createHash("sha256").update(command.key).digest("hex"));
      await mkdir(workDir, { recursive: true });
      const fact = await executeCommand(machine, command, { registry, resolveContext: { projectRoot: workspace.root, signal }, executeContext: { buildId: sessionId, commandKey: command.key, idempotencyKey: `${sessionId}:${command.key}`, projectRoot: workspace.root, store: options.resources, workDir, signal, log: options.log }, policy: studioExecutionPolicy, cache });
      machine.accept(fact);
      if (fact.kind === "failed") throw new DvError(fact.code, fact.message);
    }
  }
  const composition = machine.valueOf(plan.rootRecords[0]!)!;
  validateComposition(composition.data);
  const timelineValue = machine.valueOf(plan.rootRecords[1]!)!;
  validateTimeline(timelineValue.data);
  const timeline: Timeline = timelineValue.data;
  if (timelineValue.type !== facet.timeline.type || composition.type !== facet.composition.type) throw new DvError("STUDIO_FILM_TYPE", "Film outputs do not match its declared facet");
  if (composition.data.domain.axisKey !== timeline.axisKey || composition.data.domain.totalFrames !== timeline.totalFrames || composition.data.domain.clock.fps.numerator !== timeline.clock.fps.numerator || composition.data.domain.clock.fps.denominator !== timeline.clock.fps.denominator) throw new DvError("STUDIO_FILM_DOMAIN", "Selected Composition and Timeline belong to different Program domains");
  const document = compileDocument(composition.data);
  const values = new Map<string, Value>();
  for (const record of [...Object.keys(plan.definition.seeds), ...plan.definition.steps.flatMap(step => Object.values(step.results))]) { const value = machine.valueOf(record); if (value) values.set(record, value); }
  const inputs: CompanionInput[] = [];
  for (const [record, value] of values) {
    const logical = [...graph.outputs.values()].find(row => plan.definition.outputs[row.name]?.record === record);
    const relation = authoring.relations.find(row => row.bindingKey === record) ?? (logical && authoring.relations.find(row => row.bindingKey === `${logical.operation}.${logical.port}`));
    const element = relation && authoring.elements.get(relation.authorKey);
    if (!element) continue;
    const step = plan.definition.steps.find(row => Object.values(row.results).includes(record));
    const surface = element.surface.slice(element.surface.lastIndexOf(":") + 1);
    const producerPort = step ? Object.entries(step.results).find(([, key]) => key === record)![0] : logical?.port ?? "";
    const publicOutputs = registry.findModule(element.moduleId)?.surfaces[surface]?.doc.outputs.filter(row => row.type === value.type) ?? [];
    const output = publicOutputs.find(row => row.name === producerPort)?.name ?? (publicOutputs.length === 1 ? publicOutputs[0]!.name : producerPort);
    const candidate = plan.overrides.find(row => plan.definition.outputs[row.output]?.record === record);
    const supports: Record<string, Value> = {};
    if (step) for (const [port, key] of Object.entries(step.results)) { const sibling = values.get(key); if (sibling) supports[port] = sibling; }
    for (const [key, supported] of values) if (authoring.relations.some(row => row.bindingKey === key && row.authorKey === element.authorKey)) {
      const sibling = [...graph.outputs.values()].find(row => `${row.operation}.${row.port}` === key);
      if (sibling) supports[sibling.port] = supported;
    }
    const inputValues: Record<string, Value[]> = {};
    const traversed = new Set<string>();
    const collectInputs = (current: NonNullable<typeof step>): void => {
      if (traversed.has(current.key)) return; traversed.add(current.key);
      for (const [port, keys] of Object.entries(current.inputs)) {
        const records = Array.isArray(keys) ? keys : [keys];
        if (!inputValues[port]) inputValues[port] = records.map(key => values.get(key)!).filter(Boolean);
        for (const key of records) { const ancestor = plan.definition.steps.find(row => Object.values(row.results).includes(key)); if (ancestor) collectInputs(ancestor); }
      }
    };
    if (step) collectInputs(step);
    const fallback = (): CompanionProjection => {
      const base: CompanionProjection = { entities: [], lanes: [], bands: [], materials: [], fieldGroups: [], parameterOwners: [] };
      if (value.type !== renderTypes.visual && value.type !== renderTypes.audio) return base;
      const laneKey = `${element.authorKey}/${value.type}`;
      let intervals: { start: number; end: number }[];
      let pictureParts: string[] = [];
      if (value.type === renderTypes.visual) {
        validateVisualTrack(value.data);
        intervals = value.data.presents.map(present => present.lifetime);
        pictureParts = value.data.presents.map(present => present.presentKey);
      } else {
        validateAudioTrack(value.data);
        intervals = value.data.clips.map(clip => ({ start: Math.floor(clip.targetSamples.start * timeline.clock.fps.numerator / (48000 * timeline.clock.fps.denominator)), end: Math.ceil(clip.targetSamples.end * timeline.clock.fps.numerator / (48000 * timeline.clock.fps.denominator)) }));
      }
      const materials = resourcesIn(value.data).map(({ ref }) => ({ key: `${laneKey}/${ref.$resource}`, resource: ref, kind: ref.mime.startsWith("audio/") ? "audio" as const : ref.mime.startsWith("video/") ? "video" as const : "image" as const }));
      return { ...base, lanes: [{ key: laneKey, title: element.authorKey, height: value.type === renderTypes.audio ? 48 : 76, order: 0 }], materials, entities: [{ editorKey: laneKey, authorKey: element.authorKey, title: element.authorKey, paintRank: 0, intervals, laneKey, pictureParts, materials: materials.map(material => material.key), sourceSlice: { unit: element.sourceUnit, span: element.elementSpan }, parameterOwners: [], facts: { type: value.type }, temporal: [] }] };
    };
    inputs.push({ value, type: value.type, moduleId: element.moduleId, surface: element.surface.slice(element.surface.lastIndexOf(":") + 1), output, outputKey: record, authorKey: element.authorKey, authorGraph: graph, authoring, values, sourceSlice: { unit: element.sourceUnit, span: element.elementSpan }, provenance: candidate ? { kind: "candidate", candidate: candidate.candidate } : { kind: "author" }, inputs: inputValues, executionEdges: plan.executionEdges, supports, timeline, document, fallback });
  }
  const projection = createProjection(inputs, companions);
  const audioPlayback: NonNullable<ViewRevision["audioPlayback"]>[number][] = [];
  const audioCapability = registry.findCapability("local/prepare-audio-playback");
  for (const track of composition.data.audioTracks) for (const clip of track.clips) if (clip.speed.numerator !== clip.speed.denominator) {
    if (!audioCapability || audioCapability.executor.kind !== "immediate") throw new DvError("STUDIO_CAPABILITY_MISSING", "Missing local/prepare-audio-playback");
    const request: Json = { source: { ...clip.source }, sourceTotalSamples: clip.sourceTotalSamples, sourceSamples: { ...clip.sourceSamples }, targetSamples: { ...clip.targetSamples }, speed: { ...clip.speed }, preservePitch: true, ...(clip.loop ? { loop: { ...clip.loop } } : {}) };
    const context = { buildId: sessionId, commandKey: clip.clipKey, idempotencyKey: `${sessionId}:${clip.clipKey}`, projectRoot: workspace.root, store: options.resources, workDir: join(workspace.stateDir, "studio", "scratch", sessionId, "playback"), signal, log: options.log };
    const resolution = await audioCapability.resolve(request, { projectRoot: workspace.root, signal });
    if (!resolution.ok) throw new DvError(resolution.code, resolution.reason);
    if (resolution.cost !== "local") throw new DvError("STUDIO_CAPABILITY_MISSING", "Audio playback preparation is not local");
    const executor = audioCapability.executor;
    const prepared = await cache.execute(audioCapability, resolution.request, context, value => { const hash = value.type.lastIndexOf("#"); registry.findModule(value.type.slice(0, hash))!.types[value.type.slice(hash + 1)]!.validate(value.data); }, sharedContext => executor.run(resolution.request, sharedContext));
    const data = prepared.data;
    if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.totalSamples !== "number" || !data.resource || typeof data.resource !== "object" || Array.isArray(data.resource) || typeof data.resource.$resource !== "string" || typeof data.resource.bytes !== "number" || typeof data.resource.mime !== "string") throw new DvError("STUDIO_AUDIO_INVALID", "Invalid prepared playback audio");
    audioPlayback.push({ clipKey: clip.clipKey, resource: { $resource: data.resource.$resource, bytes: data.resource.bytes, mime: data.resource.mime }, totalSamples: data.totalSamples });
  }
  const resources = new Map<string, ResourceRef>();
  for (const { ref } of resourcesIn(composition.data as unknown as Json)) resources.set(ref.$resource, ref);
  for (const playback of audioPlayback) resources.set(playback.resource.$resource, playback.resource);
  for (const value of values.values()) for (const { ref } of resourcesIn(value.data)) resources.set(ref.$resource, ref);
  for (const ref of resources.values()) { const info = await stat(options.resources.pathOf(ref)); if (!info.isFile() || info.size !== ref.bytes) throw new DvError("STUDIO_RESOURCE_UNREADABLE", `Unreadable resource ${ref.$resource}`); }
  if (!overlay) for (const [file, text] of snapshot) if (workspace.readText(file, { asset: true }) !== text) throw new DvError("STUDIO_SOURCE_CHANGED", "Source closure changed while preparing the display");
  const fieldSchemas: Record<string, FieldSchema> = {};
  for (const group of projection.fieldGroups) for (const field of group.fields) if (field.schema) fieldSchemas[field.schemaKey] = field.schema;
  const sourceUnits = [...authoring.units.values()].map(({ unit, fileName, language, sourceVersion }) => ({ unit, fileName, language, sourceVersion }));
  const view: ViewRevision = { protocol: "dsivio-video.studio/1", sessionId, viewRevision: requestedRevision, runFile: relative(workspace.root, runFile).split("\\").join("/"), projectRoot: workspace.root, sourceUnits, clock: timeline.clock, totalFrames: timeline.totalFrames, timeline, document, audioTracks: composition.data.audioTracks, audioPlayback, fieldSchemas, ...projection, targets: run.targets, candidateCount: run.candidates.size };
  return { view, authoring, graph, plan, resources: [...resources.values()], files: [runFile, ...graph.sources, ...[...plan.assets.values()].map(asset => asset.path)] };
}
