import { createHash } from "node:crypto";
import { DvError } from "../core/errors.ts";
import type { AuthoringElement, AuthoringRelation } from "../core/authoring.ts";
import type { Json, Value } from "../core/value.ts";
import type { CompanionInput, CompanionProjection, FieldOption, ParameterOwner, SourceSlice, StudioCompanion, StudioField, TemporalAuthority } from "./companion.ts";
import type { Instant, Window } from "../timeline/types.ts";
import type { FieldSchema } from "./protocol.ts";
import type { VisualTrack } from "../render/ir.ts";
import { validateVisualTrack } from "../render/validate.ts";
import { validateInstant, validateWindow } from "../timeline/validate.ts";
export type { FieldSchema } from "./protocol.ts";

export interface FieldSpec {
  fieldKey?: string; label: string; widget: StudioField["widget"]; schemaKey: string; authorValue: Json;
  displayScale?: number; units?: readonly string[]; options?: readonly FieldOption[]; schema?: FieldSchema;
  path?: readonly (string | number)[]; groupMembers?: readonly string[];
  children?: NonNullable<StudioField["binding"]>["children"];
}
export function emptyProjection(): CompanionProjection {
  return { entities: [], lanes: [], bands: [], materials: [], fieldGroups: [], parameterOwners: [] };
}
export function authorFor(input: CompanionInput, bindingKeyOrIdentity = input.authorKey): AuthoringElement | undefined {
  const direct = input.authoring.elements.get(bindingKeyOrIdentity);
  if (direct) return direct;
  const identityRelations = input.authoring.relations.filter(r => r.identity === bindingKeyOrIdentity);
  const outputRelations = input.authoring.relations.filter(r => r.bindingKey === bindingKeyOrIdentity && r.role === "output");
  const parameterRelations = input.authoring.relations.filter(r => r.bindingKey === bindingKeyOrIdentity && r.role === "parameter");
  const relations = identityRelations.length ? identityRelations : outputRelations.length ? outputRelations : parameterRelations;
  const keys = new Set(relations.map(r => r.authorKey));
  if (keys.size > 1) throw new DvError("STUDIO_SOURCE_AMBIGUOUS", `Multiple source owners for ${bindingKeyOrIdentity}`);
  const key = keys.values().next().value;
  return key ? input.authoring.elements.get(key) : undefined;
}
export function sourceFor(input: CompanionInput, bindingKeyOrIdentity = input.authorKey): SourceSlice | undefined {
  const owner = authorFor(input, bindingKeyOrIdentity);
  if (!owner) return undefined;
  const unit = input.authoring.units.get(owner.sourceUnit);
  return { unit: owner.sourceUnit, span: owner.elementSpan, ...(unit ? { text: unit.text.slice(owner.elementSpan.start, owner.elementSpan.end) } : {}) };
}
export function pictureParts(input: CompanionInput, identity: string): string[] {
  if (input.value.type !== "dsivio-video/visual@1#VisualTrack") return [];
  validateVisualTrack(input.value.data);
  const track: VisualTrack = input.value.data;
  return track.presents.filter(p => p.presentKey === identity || p.presentKey.startsWith(`${identity}/`)).map(p => p.presentKey);
}
function ownerForValue(input: CompanionInput, bindingKey: string, value: Value, authorKey?: string): ParameterOwner | undefined {
  const author = authorFor(input, authorKey ?? bindingKey);
  if (!author) return undefined;
  const relation = input.authoring.relations.find(r => r.bindingKey === bindingKey && r.role === "output" && r.authorKey === author.authorKey);
  const output = relation?.surfaceOutput ?? (input.authorGraph.records.has(bindingKey) ? "" : bindingKey.slice(bindingKey.lastIndexOf(".") + 1));
  return { key: author.authorKey, authorKey: author.authorKey, moduleId: author.moduleId || value.type.slice(0, value.type.lastIndexOf("#")), surface: author.surface.slice(author.surface.lastIndexOf(":") + 1), output, value, bindings: author.attributes.map(a => ({ ownerKey: author.authorKey, sourceUnit: author.sourceUnit, attribute: a.name, access: a.attribute.value.kind === "ref" ? "read" : "write", ...(a.attribute.value.kind === "ref" ? { reference: a.attribute.value.name } : {}) })) };
}
export function ownParameterOwner(input: CompanionInput): ParameterOwner | undefined {
  const owner = ownerForValue(input, input.outputKey, input.value, input.authorKey);
  if (!owner) return undefined;
  return { ...owner, output: input.output };
}
export function parameterOwner(input: CompanionInput, port: string, index = 0): ParameterOwner | undefined {
  const operation = input.authorGraph.operations.get(input.outputKey.slice(0, input.outputKey.lastIndexOf(".")));
  const visited = new Set<string>();
  const find = (key: string): { key: string; value: Value } | undefined => {
    if (visited.has(key)) return undefined;
    visited.add(key);
    const op = input.authorGraph.operations.get(key);
    if (!op) return undefined;
    const edge = input.executionEdges.find(e => e.operation === key && e.port === port && (e.index ?? 0) === index);
    if (edge) {
      const bindingKey = "record" in edge.source ? edge.source.record : `${edge.source.operation}.${edge.source.port}`;
      const value = input.values?.get(bindingKey) ?? input.authorGraph.records.get(bindingKey)?.value ?? input.inputs[port]?.[index];
      if (value) return { key: bindingKey, value };
    }
    for (const edge of input.executionEdges.filter(e => e.operation === key)) {
      if ("operation" in edge.source) { const result = find(edge.source.operation); if (result) return result; }
    }
    return undefined;
  };
  const found = find(operation?.key ?? input.outputKey);
  if (!found) return undefined;
  return ownerForValue(input, found.key, found.value);
}
/** Resolve compile-time references through the actual source public binding, not Value shapes. */
export function referenceOwner(input: CompanionInput, ownerKey: string, attribute: string): AuthoringElement | undefined {
  const owner = authorFor(input, ownerKey);
  if (!owner) return undefined;
  const reference = input.authoring.references.find(r => r.authorKey === owner.authorKey && r.attribute === attribute);
  return reference ? authorFor(input, reference.bindingKey) : undefined;
}
export function field(input: CompanionInput, ownerKey: string, attribute: string, spec: FieldSpec): StudioField {
  const owner = authorFor(input, ownerKey);
  const authored = owner?.attributes.find(a => a.name === attribute);
  const property = owner?.recipe?.properties.find(p => p.name === attribute);
  const reference = authored?.attribute.value.kind === "ref" ? authored.attribute.value.name : undefined;
  const writable = !!owner && !reference && (attribute !== "$body" || !!owner.rawBody || !!owner.pureText) && (attribute !== "$children" || !!owner.contentBody && !!spec.children);
  const key = spec.fieldKey ?? `${ownerKey}:${attribute}`;
  const endpointKey = createHash("sha256").update(`${ownerKey}\0${attribute}\0${spec.schemaKey}\0${JSON.stringify(spec.path ?? [])}`).digest("hex").slice(0, 24);
  const authorValue = spec.groupMembers || spec.path?.length ? spec.authorValue : property?.value ?? (authored?.attribute.value.kind === "literal" && typeof spec.authorValue === "string" ? authored.attribute.value.text : spec.authorValue);
  const schema: FieldSchema = spec.schema ?? (spec.options ? { type: typeof authorValue === "number" ? "number" : typeof authorValue === "boolean" ? "boolean" : "string", enum: spec.options.map(o => o.value) } : { type: typeof authorValue === "number" ? "number" : typeof authorValue === "boolean" ? "boolean" : Array.isArray(authorValue) ? "array" : authorValue !== null && typeof authorValue === "object" ? "object" : "string" });
  return { fieldKey: key, ownerKey, label: spec.label, widget: spec.widget, schemaKey: spec.schemaKey, schema, authorValue, ...(spec.displayScale !== undefined ? { displayScale: spec.displayScale } : {}), ...(spec.units ? { units: spec.units } : {}), ...(spec.options ? { options: spec.options } : {}), ...(writable ? { endpointKey } : { readonly: true }), ...(owner ? { binding: { ownerKey, sourceUnit: owner.sourceUnit, attribute, access: writable ? "write" : "read", ...(reference ? { reference } : {}), ...(writable ? { endpointKey } : {}), ...(spec.path ? { path: spec.path } : {}), ...(spec.groupMembers ? { groupMembers: spec.groupMembers } : {}), ...(spec.children ? { children: spec.children } : {}) } } : {}) };
}
function consumedByPort(input: CompanionInput, relation: AuthoringRelation, port: string): boolean {
  if (relation.consumer && relation.consumer.port !== port) return false;
  return input.executionEdges.some(edge => {
    if (edge.port !== port || relation.consumer && edge.operation !== relation.consumer.operation) return false;
    const bindingKey = "record" in edge.source ? edge.source.record : `${edge.source.operation}.${edge.source.port}`;
    if (bindingKey !== relation.bindingKey) return false;
    const operation = input.authorGraph.operations.get(edge.operation);
    return !Array.isArray(operation?.inputs[port]) || relation.consumer?.index === undefined || relation.consumer.index === edge.index;
  });
}
/** Explicit domain projection for a temporal value embedded in an authored typed plan. */
export function temporalAuthority(input: CompanionInput, temporal: Instant | Window, consumerPort = "windows"): TemporalAuthority | undefined {
  const relations = input.authoring.relations.filter(r => r.identity === temporal.consumerKey && (r.role === "window" || r.role === "instant") && consumedByPort(input, r, consumerPort));
  const owners = new Set(relations.map(r => r.authorKey));
  if (owners.size > 1) throw new DvError("STUDIO_TIME_AMBIGUOUS", `Multiple author endpoints for ${temporal.consumerKey}/${consumerPort}`);
  const ownerKey = owners.values().next().value;
  const owner = ownerKey ? input.authoring.elements.get(ownerKey) : undefined;
  if (!owner) return undefined;
  const names = owner.attributes.map(a => a.name);
  const gestures: TemporalAuthority["gestures"][number][] = names.includes("at") && names.includes("for") ? ["move", "trim-end"] : names.includes("until") && names.includes("for") ? ["move", "trim-start"] : names.includes("start") && names.includes("end") ? ["move", "trim-start", "trim-end"] : names.includes("instant") || names.includes("at") && !("frames" in temporal) ? ["move"] : [];
  return { key: `${owner.authorKey}:${consumerPort}`, originKind: gestures.length ? "parameter" : "fixed", originKey: owner.authorKey, consumerPort, ...("frames" in temporal ? { window: temporal } : { instant: temporal }), gestures, binding: { ownerKey: owner.authorKey, sourceUnit: owner.sourceUnit, access: gestures.length ? "write" : "read" } };
}
export function temporalAuthorities(input: CompanionInput, consumerKey: string, consumerPort = "windows"): TemporalAuthority[] {
  const candidates = input.authoring.relations.filter(r => r.identity === consumerKey && (r.role === "window" || r.role === "instant") && consumedByPort(input, r, consumerPort));
  const bindings = new Set(candidates.map(r => r.bindingKey));
  for (const operation of input.authorGraph.operations.values()) {
    if (!input.executionEdges.some(e => e.operation === operation.key)) continue;
    const consumer = operation.inputs.consumer;
    if (!consumer || Array.isArray(consumer) || !("record" in consumer) || input.authorGraph.records.get(consumer.record)?.value.data !== consumerKey) continue;
    for (const port of Object.keys(operation.outputs)) {
      const key = `${operation.key}.${port}`;
      if (input.executionEdges.some(edge => edge.port === consumerPort && "operation" in edge.source && edge.source.operation === operation.key && edge.source.port === port)) bindings.add(key);
    }
  }
  const results: TemporalAuthority[] = [];
  for (const bindingKey of bindings) {
    const value = input.values?.get(bindingKey);
    if (!value || !["dsivio-video/time@1#Window", "dsivio-video/time@1#Instant"].includes(value.type)) continue;
    const operationKey = bindingKey.slice(0, bindingKey.lastIndexOf("."));
    const operation = input.authorGraph.operations.get(operationKey);
    const shared = operation?.inputs.window;
    const originKey = shared && !Array.isArray(shared) ? "record" in shared ? shared.record : `${shared.operation}.${shared.port}` : bindingKey;
    const owner = authorFor(input, originKey);
    if (!owner) continue;
    const names = owner.attributes.map(a => a.name);
    const gestures: TemporalAuthority["gestures"][number][] = names.includes("at") && names.includes("for") ? ["move", "trim-end"] : names.includes("until") && names.includes("for") ? ["move", "trim-start"] : names.includes("start") && names.includes("end") ? ["move", "trim-start", "trim-end"] : names.includes("instant") || names.includes("at") && value.type.endsWith("#Instant") ? ["move"] : [];
    let temporal: { instant?: Instant; window?: Window };
    if (value.type.endsWith("#Window")) { validateWindow(value.data); temporal = { window: value.data }; }
    else { validateInstant(value.data); temporal = { instant: value.data }; }
    const explicit = temporalAuthority(input, temporal.window ?? temporal.instant!, consumerPort);
    results.push(explicit && originKey === bindingKey ? explicit : { key: `${owner.authorKey}:${consumerPort}`, originKind: gestures.length ? "parameter" : "fixed", originKey: owner.authorKey, consumerPort, ...temporal, gestures, binding: { ownerKey: owner.authorKey, sourceUnit: owner.sourceUnit, access: gestures.length ? "write" : "read" } });
  }
  const owners = new Set(results.map(r => r.originKey));
  if (owners.size > 1) throw new DvError("STUDIO_TIME_AMBIGUOUS", `Multiple temporal authors for ${consumerKey}/${consumerPort}`);
  return results.filter((r, index) => results.findIndex(other => other.key === r.key) === index);
}
export function createProjection(inputs: readonly CompanionInput[], companions: readonly StudioCompanion[]): CompanionProjection {
  const projections = inputs.map(input => {
    const matches = companions.filter(c => c.moduleId === input.moduleId && c.matches.some(m => m.surface === input.surface && m.output === input.output && m.type === input.type));
    if (matches.length > 1) throw new DvError("STUDIO_COMPANION_AMBIGUOUS", `Multiple companions match ${input.moduleId}/${input.surface}.${input.output}`);
    return matches[0]?.project(input) ?? input.fallback();
  });
  const merge = <T extends { key: string }>(items: readonly T[]): T[] => {
    const seen = new Map<string, T>();
    for (const item of items) {
      const previous = seen.get(item.key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw new DvError("STUDIO_PROJECTION_CONFLICT", `Conflicting projection key ${item.key}`);
      seen.set(item.key, item);
    }
    return [...seen.values()];
  };
  const allEntities = projections.flatMap(p => p.entities);
  const entities = allEntities.map(entity => {
    const owners = new Set(entity.parameterOwners);
    const visit = (ownerKey: string): void => {
      for (const input of inputs) {
        for (const reference of input.authoring.references.filter(r => r.authorKey === ownerKey)) {
          const owner = authorFor(input, reference.bindingKey);
          if (owner && !owners.has(owner.authorKey)) { owners.add(owner.authorKey); visit(owner.authorKey); }
        }
      }
    };
    visit(entity.authorKey);
    for (const ownerKey of [...owners]) visit(ownerKey);
    const temporal = entity.temporal.flatMap(authority => {
      if (authority.originKind === "semantic") return [authority];
      const leading = authority.window?.leading;
      if (leading?.editAuthority !== "semantic-anchor" || leading.origin.kind !== "semantic" || leading.origin.reference.kind !== "selection") return [authority];
      const selectionKey = leading.origin.reference.selectionKey;
      const storyKey = leading.origin.reference.storyKey;
      const matches = allEntities.filter(row => row.facts.selectionKey === selectionKey && row.facts.storyKey === storyKey);
      if (matches.length > 1) throw new DvError("STUDIO_TIME_AMBIGUOUS", "A shared Selection has multiple marker authors.");
      const marker = matches[0];
      if (!marker?.temporal.length) return [authority];
      return marker.temporal.map(inverse => ({ ...inverse, consumerPort: authority.consumerPort, ...(authority.window ? { window: authority.window } : {}) }));
    });
    return { ...entity, parameterOwners: [...owners], temporal };
  });
  const keys = new Set<string>();
  for (const entity of entities) { if (keys.has(entity.editorKey)) throw new DvError("STUDIO_ENTITY_DUPLICATE", `Duplicate editor key ${entity.editorKey}`); keys.add(entity.editorKey); }
  return { entities, lanes: merge(projections.flatMap(p => p.lanes)), bands: merge(projections.flatMap(p => p.bands)), materials: merge(projections.flatMap(p => p.materials)), fieldGroups: merge(projections.flatMap(p => p.fieldGroups)), parameterOwners: merge(projections.flatMap(p => p.parameterOwners)) };
}
