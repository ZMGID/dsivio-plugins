import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { DvError } from "../core/errors.ts";
import type { AuthoringElement, AuthoringIndex, AuthoringUnit } from "../core/authoring.ts";
import type { Json } from "../core/value.ts";
import { canonicalJson } from "../core/value.ts";
import type { Workspace } from "../source/workspace.ts";
import { serializeAttributeValue } from "../markup/parse.ts";
import { serializeDvsValue } from "../markup/dvs.ts";
import { sourceVersion } from "../elaborate/source-index.ts";
import type { SourcePatch, StudioField, StudioCompanion } from "./companion.ts";
import type { FieldEditRequest, FieldSchema, StudioState, ViewRevision } from "./protocol.ts";

export interface EditSession {
  state: StudioState;
  authoring: AuthoringIndex;
  workspace: Workspace;
  companions?: readonly StudioCompanion[];
  transaction(overlay: ReadonlyMap<string, string>): Promise<ViewRevision>;
}
export function readyView(session: EditSession, expected: number): ViewRevision {
  const state = session.state;
  if (!Number.isSafeInteger(expected) || expected < 0) throw new DvError("STUDIO_EDIT_REQUEST", "An edit requires a nonnegative integer view revision.");
  if (state.status !== "ready" || state.dirty || expected !== state.requestedRevision || expected !== state.publishedRevision || !state.view) throw new DvError("STUDIO_EDIT_STALE", "The current source has not published this view revision.");
  return state.view;
}
/** JSON schema from the trusted explicit Companion; compilation enforces domain cross-field invariants. */
export function validateFieldValue(value: unknown, schema: FieldSchema, path = "value"): asserts value is Json {
  if (value === null || value === undefined) throw new DvError("STUDIO_FIELD_VALUE", `${path} cannot be empty.`);
  const type = Array.isArray(value) ? "array" : typeof value;
  if (schema.type && (schema.type === "integer" ? typeof value !== "number" || !Number.isSafeInteger(value) : type !== schema.type)) throw new DvError("STUDIO_FIELD_VALUE", `${path} requires ${schema.type}.`);
  if (typeof value === "number" && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) throw new DvError("STUDIO_FIELD_VALUE", `${path} is outside its permitted range.`);
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) throw new DvError("STUDIO_FIELD_VALUE", `${path} requires a declared option.`);
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) throw new DvError("STUDIO_FIELD_VALUE", `${path} has an invalid format.`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) throw new DvError("STUDIO_FIELD_VALUE", `${path} has an invalid item count.`);
    for (const [index, item] of value.entries()) validateFieldValue(item, schema.items ?? {}, `${path}[${index}]`);
  } else if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(object, key)) throw new DvError("STUDIO_FIELD_VALUE", `${path}.${key} is required.`);
    for (const [key, item] of Object.entries(object)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {}, key)) throw new DvError("STUDIO_FIELD_VALUE", `${path}.${key} is not a declared member.`);
      validateFieldValue(item, schema.properties?.[key] ?? {}, `${path}.${key}`);
    }
  } else if (!["string", "number", "boolean"].includes(typeof value)) throw new DvError("STUDIO_FIELD_VALUE", `${path} must be JSON.`);
}
function utf16Boundary(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  const before = text.charCodeAt(offset - 1); const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
export function applySourcePatches(text: string, patches: readonly SourcePatch[]): string {
  if (!patches.length) return text;
  const ordered = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  let previous: SourcePatch | undefined;
  for (const patch of ordered) {
    if (!utf16Boundary(text, patch.start) || !utf16Boundary(text, patch.end) || patch.end < patch.start || previous && (patch.start < previous.end || patch.start === patch.end && previous.start === previous.end && patch.start === previous.start)) throw new DvError("STUDIO_PATCH_RANGE", "Source patches must have valid, non-overlapping UTF-16 boundaries.");
    if (text.slice(patch.start, patch.end) !== patch.expectedText) throw new DvError("STUDIO_EDIT_CONFLICT", "Source patch does not match the compiled source.");
    previous = patch;
  }
  const chunks: string[] = [];
  let cursor = text.length;
  for (const patch of ordered.reverse()) {
    chunks.push(text.slice(patch.end, cursor), patch.text);
    cursor = patch.start;
  }
  chunks.push(text.slice(0, cursor));
  return chunks.reverse().join("");
}
function sourcePatch(unit: AuthoringUnit, start: number, end: number, text: string): SourcePatch {
  return { unit: unit.unit, start, end, expectedText: unit.text.slice(start, end), text };
}
export function attributePatch(unit: AuthoringUnit, owner: AuthoringElement, name: string, value: Json): SourcePatch {
  const attribute = owner.attributes.find(a => a.name === name);
  if (attribute?.attribute.value.kind === "ref") throw new DvError("STUDIO_FIELD_READONLY", `The ${name} reference belongs to its referenced author.`);
  return attribute ? sourcePatch(unit, attribute.valueSpan.start, attribute.valueSpan.end, serializeAttributeValue(value, attribute.attribute.value.quote)) : sourcePatch(unit, owner.insertion.start, owner.insertion.end, ` ${name}=${serializeAttributeValue(value)}`);
}
export function fieldPatches(authoring: AuthoringIndex, field: StudioField, value: Json): readonly SourcePatch[] {
  const binding = field.binding;
  if (!binding || binding.access !== "write" || binding.reference || !field.endpointKey || binding.endpointKey !== field.endpointKey) throw new DvError("STUDIO_FIELD_READONLY", "This field has no writable source endpoint.");
  const owner = authoring.elements.get(binding.ownerKey);
  const unit = owner ? authoring.units.get(owner.sourceUnit) : undefined;
  if (!owner || !unit || unit.unit !== binding.sourceUnit) throw new DvError("STUDIO_ENDPOINT_MISSING", "The source endpoint no longer exists.");
  const name = binding.attribute;
  if (!name) throw new DvError("STUDIO_ENDPOINT_MISSING", "The endpoint has no declared author property.");
  if (name === "$body") {
    const span = owner.rawBody ?? (owner.pureText ? owner.contentBody : undefined);
    if (!span || typeof value !== "string") throw new DvError("STUDIO_FIELD_READONLY", "This source body is not plain editable text.");
    if (owner.rawBody && value.includes(`</${owner.surface}>`)) throw new DvError("STUDIO_FIELD_VALUE", "A raw body cannot contain its closing tag.");
    const encoded = owner.rawBody ? value : value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return [sourcePatch(unit, span.start, span.end, encoded)];
  }
  if (name === "$children") {
    if (!owner.contentBody || !Array.isArray(value) || !binding.children) throw new DvError("STUDIO_FIELD_READONLY", "This list has no declared child inverse.");
    const prefix = owner.surface.includes(":") ? owner.surface.slice(0, owner.surface.indexOf(":") + 1) : "";
    const lines = value.map(item => {
      if (item === null || Array.isArray(item) || typeof item !== "object") throw new DvError("STUDIO_FIELD_VALUE", "Each child must be a complete record.");
      const discriminator = item[binding.children!.discriminator];
      const variant = typeof discriminator === "string" && Object.hasOwn(binding.children!.variants, discriminator) ? binding.children!.variants[discriminator] : undefined;
      if (!variant || !/^[A-Za-z_][\w.-]*$/.test(variant.tag)) throw new DvError("STUDIO_FIELD_VALUE", "Unknown declared child kind.");
      const attrs: string[] = [];
      for (const [key, member] of Object.entries(item)) {
        if (key === binding.children!.discriminator) continue;
        const attr = Object.hasOwn(variant.attributes, key) ? variant.attributes[key] : undefined;
        if (!attr || !/^[A-Za-z_][\w.-]*$/.test(attr)) throw new DvError("STUDIO_FIELD_VALUE", `Undeclared child member ${key}.`);
        attrs.push(`${attr}=${serializeAttributeValue(member)}`);
      }
      return `  <${prefix}${variant.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""} />`;
    });
    return [sourcePatch(unit, owner.contentBody.start, owner.contentBody.end, `\n${lines.join("\n")}\n`)];
  }
  if (owner.recipe) {
    if (binding.groupMembers) {
      if (value === null || Array.isArray(value) || typeof value !== "object") throw new DvError("STUDIO_FIELD_VALUE", "A Recipe property group requires a complete record.");
      if (Object.keys(value).some(key => !binding.groupMembers!.includes(key))) throw new DvError("STUDIO_FIELD_VALUE", "The record contains an undeclared Recipe property.");
      const patches: SourcePatch[] = []; const insertions: string[] = [];
      for (const member of binding.groupMembers) {
        if (!/^[a-z][a-z0-9-]*$/.test(member)) throw new DvError("STUDIO_ENDPOINT_MISSING", "Recipe group members require canonical property names.");
        const property = owner.recipe.properties.find(p => p.name === member);
        if (Object.hasOwn(value, member)) {
          if (property) patches.push(sourcePatch(unit, property.valueSpan.start, property.valueSpan.end, serializeDvsValue(value[member]!)));
          else insertions.push(`  ${member}: ${serializeDvsValue(value[member]!)};`);
        } else if (property) patches.push(sourcePatch(unit, property.deleteSpan.start, property.deleteSpan.end, ""));
      }
      if (insertions.length) patches.push(sourcePatch(unit, owner.insertion.start, owner.insertion.end, `\n${insertions.join("\n")}\n`));
      return patches;
    }
    const property = owner.recipe.properties.find(p => p.name === name);
    let next = value;
    if (binding.path?.length && property) {
      const cloned: Json = JSON.parse(JSON.stringify(property.value));
      let cursor = cloned;
      for (const key of binding.path.slice(0, -1)) {
        if (cursor === null || typeof cursor !== "object") throw new DvError("STUDIO_ENDPOINT_MISSING", "Nested Recipe path no longer exists.");
        const next = Array.isArray(cursor) && typeof key === "number" ? cursor[key] : !Array.isArray(cursor) && typeof key === "string" ? cursor[key] : undefined;
        if (next === undefined) throw new DvError("STUDIO_ENDPOINT_MISSING", "Nested Recipe path no longer exists.");
        cursor = next;
      }
      const key = binding.path.at(-1)!;
      if (Array.isArray(cursor) && typeof key === "number" && key >= 0 && key < cursor.length) cursor[key] = value;
      else if (cursor && !Array.isArray(cursor) && typeof cursor === "object" && typeof key === "string" && Object.hasOwn(cursor, key)) cursor[key] = value;
      else throw new DvError("STUDIO_ENDPOINT_MISSING", "Nested Recipe path no longer exists.");
      next = cloned;
    }
    return property ? [sourcePatch(unit, property.valueSpan.start, property.valueSpan.end, serializeDvsValue(next))] : [sourcePatch(unit, owner.insertion.start, owner.insertion.end, `\n  ${name}: ${serializeDvsValue(next)};\n`)];
  }
  if (binding.groupMembers) {
    if (value === null || Array.isArray(value) || typeof value !== "object") throw new DvError("STUDIO_FIELD_VALUE", "An attribute group requires a complete record.");
    if (Object.keys(value).some(key => !binding.groupMembers!.includes(key))) throw new DvError("STUDIO_FIELD_VALUE", "The record contains an undeclared author property.");
    const patches: SourcePatch[] = []; const insertions: string[] = [];
    for (const member of binding.groupMembers) {
      const attr = owner.attributes.find(a => a.name === member);
      if (attr?.attribute.value.kind === "ref") throw new DvError("STUDIO_FIELD_READONLY", "A referenced group member cannot be replaced as a scalar.");
      if (Object.hasOwn(value, member)) {
        if (attr) patches.push(attributePatch(unit, owner, member, value[member]!));
        else insertions.push(` ${member}=${serializeAttributeValue(value[member]!)}`);
      } else if (attr) patches.push(sourcePatch(unit, attr.fullSpan.start, attr.fullSpan.end, ""));
    }
    if (insertions.length) patches.push(sourcePatch(unit, owner.insertion.start, owner.insertion.end, insertions.join("")));
    return patches;
  }
  return [attributePatch(unit, owner, name, value)];
}
export function sourceOverlay(session: EditSession, patches: readonly SourcePatch[]): ReadonlyMap<string, string> {
  const overlay = new Map<string, string>();
  const byUnit = new Map<string, SourcePatch[]>();
  for (const patch of patches) {
    if (!session.authoring.units.has(patch.unit)) throw new DvError("STUDIO_SOURCE_MISSING", "The source file is not in the loaded closure.");
    const group = byUnit.get(patch.unit);
    if (group) group.push(patch);
    else byUnit.set(patch.unit, [patch]);
  }
  for (const unit of session.authoring.units.values()) {
    let real: string;
    try {
      real = realpathSync(unit.file);
      const suffix = relative(session.workspace.root, real);
      if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`) || !statSync(real).isFile()) throw new DvError("STUDIO_SOURCE_FORBIDDEN", "Source write is outside the workspace or not a regular file.");
    } catch (error) { if (error instanceof DvError) throw error; throw new DvError("STUDIO_SOURCE_IO", `Cannot inspect source ${unit.file}.`, { cause: error }); }
    const disk = session.workspace.readText(real);
    if (sourceVersion(disk) !== unit.sourceVersion) throw new DvError("STUDIO_EDIT_CONFLICT", "Source changed outside this view revision.");
    const group = byUnit.get(unit.unit);
    if (!group) continue;
    const text = applySourcePatches(unit.text, group);
    if (text !== unit.text) overlay.set(unit.file, text);
  }
  return overlay;
}
export async function applyFieldEdit(session: EditSession, request: FieldEditRequest): Promise<ViewRevision> {
  if (!request || typeof request.editorKey !== "string" || typeof request.fieldKey !== "string" || !Object.hasOwn(request, "value")) throw new DvError("STUDIO_FIELD_REQUEST", "A field edit requires editorKey, fieldKey and value.");
  const view = readyView(session, request.expectedViewRevision);
  const entity = view.entities.find(e => e.editorKey === request.editorKey);
  if (!entity) throw new DvError("STUDIO_ENTITY_MISSING", "The selected author entity no longer exists.");
  const owners = new Set([entity.authorKey, ...entity.parameterOwners]);
  const declarations = view.fieldGroups.filter(group => owners.has(group.ownerKey) && (!entity.fieldGroupKeys || entity.fieldGroupKeys.includes(group.key))).flatMap(group => group.fields).filter(f => f.fieldKey === request.fieldKey);
  const fields = declarations.filter((field, index) => declarations.findIndex(other => other.endpointKey === field.endpointKey && other.schemaKey === field.schemaKey && JSON.stringify(other.binding) === JSON.stringify(field.binding) && JSON.stringify(other.schema) === JSON.stringify(field.schema)) === index);
  if (fields.length !== 1) throw new DvError(fields.length ? "STUDIO_FIELD_AMBIGUOUS" : "STUDIO_FIELD_MISSING", "The requested field has no unique declared owner.");
  const field = fields[0]!;
  if (field.readonly || !field.endpointKey) throw new DvError("STUDIO_FIELD_READONLY", "The selected field is read-only.");
  const schema = view.fieldSchemas?.[field.schemaKey] ?? field.schema;
  if (!schema) throw new DvError("STUDIO_SCHEMA_MISSING", "This field has no canonical value schema.");
  validateFieldValue(request.value, schema);
  if (canonicalJson(field.authorValue) === canonicalJson(request.value)) {
    sourceOverlay(session, []);
    return view;
  }
  const overlay = sourceOverlay(session, fieldPatches(session.authoring, field, request.value));
  return overlay.size ? session.transaction(overlay) : view;
}
