import { DvError } from "../../core/errors.ts";
import type { PerformanceProgram } from "../../components/types.ts";
import { trackTypes } from "../../components/types.ts";
import type { VisualTrack } from "../../render/ir.ts";
import { renderTypes } from "../../render/ir.ts";
import { stableIdentity } from "../../timeline/identity.ts";
import type { CompanionInput, FieldGroup, ParameterOwner, StudioCompanion, StudioEntity, StudioMaterial } from "../../studio/companion.ts";
import { parameterOwner, referenceOwner, field } from "../../studio/projection.ts";
import { baseEntity, recipeFields } from "../sound/studio.ts";
import type { RecipeFieldDefinition } from "../sound/studio.ts";

export const appearanceDefinitions = [
  { key: "stack-order", domain: "Where", section: "Placement", value: 0 },
  { key: "fit", domain: "Where", section: "Fit", value: "contain", options: ["contain", "cover", "fit-width", "fit-height", "native", "scale-down", "stretch"] },
  ...["frame-x", "frame-y", "content-x", "content-y"].map(key => ({ key, domain: "Where" as const, section: "Placement", value: 0.5 })),
  ...["fit-offset-x", "fit-offset-y"].map(key => ({ key, domain: "Where" as const, section: "Placement", value: 0 })),
  { key: "fit-constraint", domain: "Where", section: "Fit", value: "bounded", options: ["bounded", "free"] },
  { key: "clip", domain: "Where", section: "Frame", value: "none", options: ["none", "frame", "rounded"] },
  { key: "radius", domain: "Where", section: "Frame", value: 0 }, { key: "padding", domain: "Where", section: "Frame", value: "0" },
  ...["opacity", "brightness", "contrast", "saturation"].map(key => ({ key, domain: "How" as const, section: "Image", value: 1 })),
  { key: "blur", domain: "How", section: "Image", value: 0 },
  { key: "border-width", domain: "How", section: "Frame Paint", value: 0 },
  { key: "border-style", domain: "How", section: "Frame Paint", value: "solid", options: ["solid", "dashed", "dotted"] },
  { key: "border-color", domain: "How", section: "Frame Paint", value: "#000000" },
  { key: "shadows", domain: "How", section: "Frame Paint", value: "" }, { key: "frame-paint", domain: "How", section: "Frame Paint", value: "#00000000" },
] satisfies readonly RecipeFieldDefinition[];

export function performanceFields(input: CompanionInput, owner: ParameterOwner): FieldGroup[] {
  const groups = recipeFields(input, owner, "appearance", appearanceDefinitions);
  const frame = referenceOwner(input, owner.authorKey, "frame");
  if (frame) {
    const fields = frame.attributes.filter(attr => !["id", "within", "extent", "aspect"].includes(attr.name) && attr.attribute.value.kind === "literal").map(attr => field(input, frame.authorKey, attr.name, { label: attr.name, widget: ["anchor", "fit", "constraint"].includes(attr.name) ? "text" : "number", schemaKey: `space/${attr.name}`, authorValue: attr.attribute.value.kind === "literal" ? attr.attribute.value.text : "", units: ["px", "%"] }));
    groups.push({ key: `${frame.authorKey}/Frame`, ownerKey: frame.authorKey, domain: "Where", pageKey: "Frame", sectionKey: "Frame", fields });
  }
  return groups;
}
export const performanceStyleStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/performance@1/style", moduleId: "dsivio-video/performance@1", matches: [{ surface: "Style", output: "", type: trackTypes.performanceStyle }], family: "performance-style", icon: "video", tone: "blue",
  project(input) { const owner: ParameterOwner = { key: input.authorKey, authorKey: input.authorKey, moduleId: input.moduleId, surface: "Style", output: "", value: input.value, bindings: [] }; return { entities: [], lanes: [], bands: [], materials: [], parameterOwners: [], fieldGroups: performanceFields(input, owner) }; },
};
export const performanceStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/performance@1/track", moduleId: "dsivio-video/performance@1", matches: [{ surface: "Track", output: "visual", type: renderTypes.visual }], family: "performance", icon: "video", tone: "blue", supports: [{ output: "program", type: trackTypes.performanceProgram }],
  project(input) {
    const value = input.supports.program; if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "performance Track requires its program output");
    const program = value.data as unknown as PerformanceProgram; const visual = input.value.data as unknown as VisualTrack;
    const laneKey = `${input.authorKey}/performance`; const bandKey = `${laneKey}/uses`; const entities: StudioEntity[] = []; const materials: StudioMaterial[] = []; const parameterOwners: ParameterOwner[] = []; const fieldGroups: FieldGroup[] = [];
    const ownerGroups = new Map<string, FieldGroup[]>();
    for (const placement of program.timeline.placements) {
      if (!placement.take.media.picture) continue;
      const key = `${laneKey}/${placement.placementKey}`; materials.push({ key, kind: "video", resource: placement.take.media.picture.resource });
      entities.push({ ...baseEntity(input, placement.placementKey, "Timeline picture", [{ start: placement.offsetFrames, end: placement.offsetFrames + placement.take.media.totalFrames }], laneKey, entities.length), temporal: [], materials: [key], facts: { readonly: true, placement: placement.placementKey } });
    }
    for (const [index, use] of program.uses.entries()) {
      const owner = parameterOwner(input, "styles", index);
      if (owner && !ownerGroups.has(owner.key)) { parameterOwners.push(owner); const groups = performanceFields(input, owner); ownerGroups.set(owner.key, groups); fieldGroups.push(...groups); }
      const keys = program.timeline.placements.map(placement => stableIdentity("performance-present", { trackKey: program.trackKey, useKey: use.useKey, placementKey: placement.placementKey }));
      const parts = visual.presents.filter(present => keys.includes(present.presentKey));
      entities.push({ ...baseEntity(input, use.useKey, "Use", [use.window.frames], laneKey, entities.length), bandKey, pictureParts: parts.flatMap(present => present.nodes.map(node => node.nodeKey)), visibleIntervals: parts.flatMap(present => present.visible ?? [present.lifetime]), parameterOwners: owner ? [...new Set([owner.key, ...(ownerGroups.get(owner.key) ?? []).map(group => group.ownerKey)])] : [], facts: { nativeClock: true } });
    }
    return { entities, lanes: [{ key: laneKey, title: "Performance", height: 60, order: 0 }], bands: [{ key: bandKey, laneKey, title: "Uses", height: 15, order: 0 }], materials, fieldGroups, parameterOwners };
  },
};
