import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, OperationSpec } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import type { SoundProgram, UsePlan } from "../../components/types.ts";
import { trackTypes } from "../../components/types.ts";
import { renderTypes } from "../../render/ir.ts";
import type { CompanionInput, CompanionProjection, FieldGroup, ParameterOwner, StudioCompanion, StudioEntity } from "../../studio/companion.ts";
import { authorFor, sourceFor, referenceOwner, parameterOwner, field, temporalAuthorities } from "../../studio/projection.ts";
export interface AuthorItem { identity: string; windowIndex?: number; styleIndex?: number }
/** Attribute child declarations to the exact plan and typed list consumer edges. */
export function elaborateTrack(node: ElementNode | RawElement, ctx: ElaborationContext, decode: (node: ElementNode | RawElement, ctx: ElaborationContext) => void, items: (value: Json) => readonly AuthorItem[]): void {
  decode(node, { ...ctx, operation(spec: OperationSpec) {
    const result = ctx.operation(spec);
    if (node.kind !== "element" || !spec.inputs.plan || Array.isArray(spec.inputs.plan) || spec.inputs.plan.kind !== "record") return result;
    const declarations = node.children.filter((child): child is ElementNode => child.kind === "element");
    const output = Object.values(result)[0];
    if (!output || output.kind !== "output") return result;
    for (const [index, item] of items(spec.inputs.plan.value.data).entries()) {
      const element = declarations[index]; if (!element) throw new DvError("STUDIO_AUTHORING_CHILD", "Plan child has no author declaration");
      ctx.authoring({ binding: spec.inputs.plan, element, role: "plan", identity: item.identity, consumer: { operation: output.operation, port: "plan" } });
      for (const [port, position, role] of [["windows", item.windowIndex, "window"], ["styles", item.styleIndex, "parameter"]] as const) {
        const list = spec.inputs[port]; if (position === undefined || !Array.isArray(list)) continue;
        const binding: Binding | undefined = list[position]; if (!binding) throw new DvError("STUDIO_AUTHORING_PORT", "Plan index has no typed input");
        ctx.authoring({ binding, element, role, identity: item.identity, consumer: { operation: output.operation, port, index: position }, ...(port === "styles" ? { attribute: "style" } : {}) });
      }
    }
    return result;
  } });
}

export function baseEntity(input: CompanionInput, identity: string, title: string, intervals: StudioEntity["intervals"], laneKey: string, paintRank: number): StudioEntity {
  const author = authorFor(input, identity); const sourceSlice = sourceFor(input, identity);
  return { editorKey: author?.authorKey ?? `${input.authorKey}/${identity}`, authorKey: author?.authorKey ?? input.authorKey, title, paintRank, intervals, laneKey, pictureParts: [], parameterOwners: [], facts: {}, temporal: temporalAuthorities(input, identity), ...(sourceSlice ? { sourceSlice } : {}) };
}

export interface RecipeFieldDefinition { key: string; domain: FieldGroup["domain"]; section: string; value: Json; options?: readonly string[] }
export function recipeFields(input: CompanionInput, owner: ParameterOwner, property: string, definitions: readonly RecipeFieldDefinition[]): FieldGroup[] {
  const recipeOwner = referenceOwner(input, owner.authorKey, property);
  if (!recipeOwner?.recipe) return [];
  const groups = new Map<string, FieldGroup>();
  for (const definition of definitions) {
    const value = recipeOwner.recipe.properties.find(item => item.name === definition.key)?.value ?? definition.value;
    const groupKey = `${recipeOwner.authorKey}/${definition.domain}/${definition.section}`;
    const group = groups.get(groupKey) ?? { key: groupKey, ownerKey: recipeOwner.authorKey, domain: definition.domain, pageKey: definition.domain, sectionKey: definition.section, fields: [] };
    const widget = definition.options ? "select" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : definition.key.includes("color") || definition.key === "fill" ? "color" : "text";
    const control = field(input, recipeOwner.authorKey, definition.key, { label: definition.key, widget, schemaKey: `${owner.moduleId}/${definition.key}`, authorValue: value, ...(definition.options ? { options: definition.options.map(value => ({ value, label: value })) } : {}) });
    groups.set(groupKey, { ...group, fields: [...group.fields, control] });
  }
  return [...groups.values()];
}

export const soundStyleStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/sound@1/style", moduleId: "dsivio-video/sound@1", matches: [{ surface: "Style", output: "", type: trackTypes.soundStyle }], family: "sound-style", icon: "audio", tone: "green",
  project(input) {
    const style = input.value.data as unknown as SoundProgram["uses"][number]["style"];
    return { entities: [], lanes: [], bands: [], materials: [], parameterOwners: [], fieldGroups: [{ key: `${input.authorKey}/Sound`, ownerKey: input.authorKey, domain: "How", pageKey: "Sound", sectionKey: "Sound", fields: [field(input, input.authorKey, "gain", { label: "gain", widget: "number", schemaKey: "sound/gain", authorValue: style.gain, displayScale: 100, schema: { type: "number", minimum: 0, maximum: 64 } }), field(input, input.authorKey, "end-gain", { label: "end-gain", widget: "number", schemaKey: "sound/gain", authorValue: style.endGain, displayScale: 100, schema: { type: "number", minimum: 0, maximum: 64 } })] }] };
  },
};

export const soundStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/sound@1/track", moduleId: "dsivio-video/sound@1", matches: [{ surface: "Track", output: "audio", type: renderTypes.audio }], family: "sound", icon: "audio", tone: "green", supports: [{ output: "program", type: trackTypes.soundProgram }],
  project(input): CompanionProjection {
    const value = input.supports.program; if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "sound Track requires its program output");
    const program = value.data as unknown as SoundProgram; const laneKey = `${input.authorKey}/sound`; const bandKey = `${laneKey}/uses`;
    const entities: StudioEntity[] = []; const parameterOwners: ParameterOwner[] = []; const fieldGroups: FieldGroup[] = [];
    const materials: CompanionProjection["materials"][number][] = [];
    for (const [index, placement] of program.timeline.placements.entries()) {
      if (!placement.take.media.sound) continue;
      const material = `${laneKey}/source/${placement.placementKey}`;
      materials.push({ key: material, kind: "audio", resource: placement.take.media.sound.resource });
      entities.push({ ...baseEntity(input, placement.placementKey, "Timeline sound", [{ start: placement.offsetFrames, end: placement.offsetFrames + placement.take.media.totalFrames }], laneKey, index), materials: [material], temporal: [], facts: { placement: placement.placementKey, readonly: true } });
    }
    for (const [index, use] of program.uses.entries()) {
      const owner = parameterOwner(input, "styles", index); if (owner && !parameterOwners.some(item => item.key === owner.key)) { parameterOwners.push(owner); fieldGroups.push(...soundStyleStudio.project({ ...input, value: owner.value, authorKey: owner.authorKey }).fieldGroups); }
      entities.push({ ...baseEntity(input, use.useKey, "Use", [use.window.frames], laneKey, entities.length), bandKey, parameterOwners: owner ? [owner.key] : [], facts: { gain: use.style.gain, endGain: use.style.endGain } });
    }
    return { entities, lanes: [{ key: laneKey, title: "Sound", height: 48, order: 0 }], bands: [{ key: bandKey, laneKey, title: "Uses", height: 15, order: 0 }], materials, fieldGroups, parameterOwners };
  },
};

export function soundAuthorItems(value: Json): AuthorItem[] {
  const plan = value as unknown as UsePlan;
  return plan.uses.map(use => ({ identity: use.useKey, windowIndex: use.windowIndex, styleIndex: use.styleIndex }));
}
