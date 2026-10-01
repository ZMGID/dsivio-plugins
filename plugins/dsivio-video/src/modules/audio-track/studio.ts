import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { AudioPlan, AudioProgram } from "../../components/audio-track/types.ts";
import { audioTrackTypes } from "../../components/audio-track/types.ts";
import { renderTypes } from "../../render/ir.ts";
import type { FieldGroup, StudioCompanion, StudioMaterial } from "../../studio/companion.ts";
import { field } from "../../studio/projection.ts";
import { baseEntity } from "../sound/studio.ts";
import type { AuthorItem } from "../sound/studio.ts";

export function audioAuthorItems(value: Json): AuthorItem[] {
  return (value as unknown as AudioPlan).items.map(item => ({ identity: item.itemKey, windowIndex: item.windowIndex }));
}
export const audioTrackStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/audio-track@1/track", moduleId: "dsivio-video/audio-track@1", matches: [{ surface: "Track", output: "audio", type: renderTypes.audio }], family: "audio-track", icon: "audio", tone: "green", supports: [{ output: "program", type: audioTrackTypes.program }],
  project(input) {
    const value = input.supports.program; if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "audio-track requires its program output");
    const program = value.data as unknown as AudioProgram; const laneKey = `${input.authorKey}/audio`; const materials: StudioMaterial[] = []; const fieldGroups: FieldGroup[] = [];
    const entities = program.items.map((item, index) => {
      const entity = baseEntity(input, item.plan.itemKey, "Audio Clip", [item.window.frames], laneKey, index); const ownerKey = entity.authorKey;
      const materialKey = `${entity.editorKey}/audio`; if (!item.source.sound) throw new DvError("STUDIO_AUDIO_SOURCE", "Audio Item has no sound");
      materials.push({ key: materialKey, kind: "audio", resource: item.source.sound.resource, facts: { totalSamples: item.source.sound.totalSamples } });
      const playback: Record<string, Json> = { playback: item.plan.playback, ...(item.plan.minRate === undefined ? {} : { "min-rate": item.plan.minRate }), ...(item.plan.maxRate === undefined ? {} : { "max-rate": item.plan.maxRate }) };
      fieldGroups.push({ key: `${ownerKey}/Playback`, ownerKey, domain: "When", pageKey: "Playback", sectionKey: "Playback", fields: [field(input, ownerKey, "playback", { fieldKey: `${ownerKey}:playback-record`, label: "Playback", widget: "record", schemaKey: "audio-track/playback", authorValue: playback, groupMembers: ["playback", "min-rate", "max-rate"], schema: { type: "object", required: ["playback"], additionalProperties: false, properties: { playback: { type: "string", enum: ["once", "once-start", "once-end", "loop", "loop-start", "loop-end", "stretch"] }, "min-rate": { type: "number", minimum: Number.MIN_VALUE }, "max-rate": { type: "number", minimum: Number.MIN_VALUE } } } })] });
      for (const [sectionKey, definitions] of [["Trim", [["trim-start", item.plan.trimStart], ["trim-end", item.plan.trimEnd ?? ""]]], ["Fade", [["fade-in", item.plan.fadeIn], ["fade-out", item.plan.fadeOut]]]] as const) fieldGroups.push({ key: `${ownerKey}/${sectionKey}`, ownerKey, domain: "When", pageKey: sectionKey, sectionKey, fields: definitions.map(([key, value]) => field(input, ownerKey, key, { label: key, widget: "number", schemaKey: "audio-track/duration", authorValue: value, units: ["ms", "s", "f"] })) });
      fieldGroups.push({ key: `${ownerKey}/Mix`, ownerKey, domain: "How", pageKey: "Mix", sectionKey: "Mix", fields: [field(input, ownerKey, "gain", { label: "gain", widget: "number", schemaKey: "audio-track/gain", authorValue: item.plan.gain, displayScale: 100, schema: { type: "number", minimum: 0, maximum: 64 } })] });
      return { ...entity, materials: [materialKey], facts: { sourceFrames: item.source.totalFrames, playback: item.plan.playback } };
    });
    return { entities, lanes: [{ key: laneKey, title: "Audio", height: 48, order: 0 }], bands: [], materials, fieldGroups, parameterOwners: [] };
  },
};
