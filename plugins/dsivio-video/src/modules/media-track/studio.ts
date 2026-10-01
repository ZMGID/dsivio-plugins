import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { MediaPlan, MediaProgram } from "../../components/media-track/types.ts";
import { mediaTrackTypes } from "../../components/media-track/types.ts";
import type { VisualTrack } from "../../render/ir.ts";
import { renderTypes } from "../../render/ir.ts";
import type { FieldGroup, ParameterOwner, StudioCompanion, StudioMaterial } from "../../studio/companion.ts";
import { field, referenceOwner } from "../../studio/projection.ts";
import { baseEntity } from "../sound/studio.ts";
import type { AuthorItem } from "../sound/studio.ts";
import { performanceFields } from "../performance/studio.ts";

export function mediaAuthorItems(value: Json): AuthorItem[] {
  return (value as unknown as MediaPlan).groups.map(group => ({ identity: group.id, ...(group.windowIndex === undefined ? {} : { windowIndex: group.windowIndex }) }));
}
export const mediaTrackStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/media-track@1/track", moduleId: "dsivio-video/media-track@1", matches: [{ surface: "Track", output: "visual", type: renderTypes.visual }, { surface: "Track", output: "audio", type: renderTypes.audio }], family: "media-track", icon: "video", tone: "blue", supports: [{ output: "program", type: mediaTrackTypes.program }],
  project(input) {
    const value = input.supports.program; if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "media-track requires its program output");
    const program = value.data as unknown as MediaProgram; const audio = input.type === renderTypes.audio; const laneKey = `${input.authorKey}/${audio ? "audio" : "media"}`;
    const materials: StudioMaterial[] = []; const fieldGroups: FieldGroup[] = []; const parameterOwners: ParameterOwner[] = [];
    const entities = program.groups.map((group, index) => {
      const entity = baseEntity(input, group.plan.id, "Item", [group.lifetime], laneKey, index);
      entity.editorKey += audio ? "/audio" : "/visual";
      entity.selectionGroup = entity.authorKey;
      const author = input.authoring.elements.get(entity.authorKey);
      const surface = author?.surface.split(":").at(-1) === "Sequence" ? "Sequence" : "Item";
      entity.title = surface;
      const groupStart = fieldGroups.length;
      const owner: ParameterOwner = { key: entity.authorKey, authorKey: entity.authorKey, moduleId: input.moduleId, surface, output: "", value, bindings: [] };
      parameterOwners.push(owner);
      const keys: string[] = [];
      const first = group.units[0];
      if (first) for (const layer of first.layers) {
        const source = layer.source; if (!source) continue; const key = `${entity.editorKey}/${layer.plan.id}`;
        if (source.kind === "image" && !audio) materials.push({ key, kind: "image", resource: source.resource, facts: { extent: source.extent } });
        else if (source.kind === "surface" && !audio) materials.push({ key, kind: "surface", value: { type: renderTypes.surface, data: source.surface as unknown as Json } });
        else if (source.kind === "media") {
          if (audio && source.media.sound) materials.push({ key, kind: "audio", resource: source.media.sound.resource });
          else if (!audio && source.media.picture) materials.push({ key, kind: "video", resource: source.media.picture.resource });
        }
        if (materials.some(material => material.key === key)) keys.push(key);
      }
      if (!audio) {
        fieldGroups.push(...performanceFields(input, owner));
        const appearance = referenceOwner(input, owner.authorKey, "appearance");
        if (appearance?.recipe) {
          const playback: Record<string, Json> = { playback: group.appearance.playback };
          for (const property of appearance.recipe.properties) if (["trim-start", "trim-end"].includes(property.name)) playback[property.name] = property.value;
          fieldGroups.push({ key: `${appearance.authorKey}/Playback`, ownerKey: appearance.authorKey, domain: "When", pageKey: "Playback", sectionKey: "Playback", fields: [field(input, appearance.authorKey, "playback", { label: "Playback", widget: "record", schemaKey: "media-track/playback", authorValue: playback, groupMembers: ["playback", "trim-start", "trim-end"], schema: { type: "object", required: ["playback"], additionalProperties: false, properties: { playback: { type: "string", enum: ["once-start", "once-end", "hold-start", "hold-end", "loop-start", "loop-end", "stretch"] }, "trim-start": { type: "number", minimum: 0 }, "trim-end": { type: "number", minimum: 1 } } } })] });
        }
        const motion = referenceOwner(input, owner.authorKey, "motion");
        if (motion?.recipe) for (const section of ["enter", "sustain", "exit"]) {
          if (section === "sustain") {
            fieldGroups.push({ key: `${motion.authorKey}/sustain`, ownerKey: motion.authorKey, domain: "When", pageKey: "Sustain", sectionKey: "Sustain", fields: [field(input, motion.authorKey, "sustain", { label: "sustain", widget: "text", schemaKey: "media-track/sustain", authorValue: motion.recipe.properties.find(property => property.name === "sustain")?.value ?? "" })] });
            continue;
          }
          const members = [section, ...["frames", "easing", "direction", "amount", "origin"].map(suffix => `${section}-${suffix}`)];
          const values = Object.fromEntries(motion.recipe.properties.filter(property => members.includes(property.name)).map(property => [property.name, property.value]));
          values[section] ??= "none";
          fieldGroups.push({ key: `${motion.authorKey}/${section}`, ownerKey: motion.authorKey, domain: "When", pageKey: section, sectionKey: section, fields: [field(input, motion.authorKey, section, { label: section, widget: "record", schemaKey: `media-track/${section}`, authorValue: values, groupMembers: members, schema: { type: "object", required: [section], additionalProperties: false, properties: { [section]: { type: "string", enum: ["none", "fade", "slide", "scale", "pop", "bounce", "blur-reveal", "wipe", "flip", "spin"] }, [`${section}-frames`]: { type: "number", minimum: 0 }, [`${section}-easing`]: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"] }, [`${section}-direction`]: { type: "string", enum: ["left", "right", "up", "down"] }, [`${section}-amount`]: { type: "number" }, [`${section}-origin`]: { type: "string", enum: ["outside-canvas"] } } } })] });
        }
      }
      const members = surface === "Sequence" && author ? [...input.authoring.elements.values()].filter(element => element.moduleId === input.moduleId && element.surface.split(":").at(-1) === "Member" && element.sourceUnit === author.sourceUnit && element.elementSpan.start > author.elementSpan.start && element.elementSpan.end < author.elementSpan.end).sort((a, b) => a.elementSpan.start - b.elementSpan.start) : [];
      for (const [unitIndex, unit] of group.units.entries()) {
        if (!unit.plan.sourceAudio) continue;
        const gainOwner = surface === "Item" ? entity.authorKey : members[unitIndex]?.authorKey;
        if (!gainOwner) throw new DvError("STUDIO_SOURCE_OWNER", "Media audio gain has no authored unit owner.");
        if (surface === "Sequence") parameterOwners.push({ key: gainOwner, authorKey: gainOwner, moduleId: input.moduleId, surface: "Member", output: "", value, bindings: [] });
        fieldGroups.push({ key: `${gainOwner}/Audio Gain`, ownerKey: gainOwner, domain: "How", pageKey: "Audio", sectionKey: "Audio Gain", fields: [field(input, gainOwner, "audio-gain", { label: "audio-gain", widget: "number", schemaKey: "media-track/gain", authorValue: unit.plan.audioGain, displayScale: 100, schema: { type: "number", minimum: 0, maximum: 64 } })] });
      }
      if (group.plan.until?.kind === "at-boundary") fieldGroups.push({ key: `${entity.authorKey}/Boundary`, ownerKey: entity.authorKey, domain: "When", pageKey: "Boundary", sectionKey: "Boundary", fields: [field(input, entity.authorKey, "until-boundary", { label: "until-boundary", widget: "select", schemaKey: "media-track/boundary", authorValue: group.plan.until.boundary, options: ["start", "end"].map(value => ({ value, label: value })) })] });
      const presents = audio ? [] : (input.value.data as unknown as VisualTrack).presents.filter(present => present.presentKey === group.plan.id);
      return { ...entity, materials: keys, pictureParts: presents.flatMap(present => present.nodes.map(node => node.nodeKey)), parameterOwners: [...new Set([owner.key, ...fieldGroups.slice(groupStart).map(group => group.ownerKey)])], facts: { units: group.units.length, lifetime: group.lifetime }, visibleIntervals: presents.map(present => present.lifetime) };
    });
    return { entities, lanes: [{ key: laneKey, title: audio ? "Media Audio" : "Media", height: audio ? 48 : 76, order: 0 }], bands: [], materials, fieldGroups, parameterOwners };
  },
};
