import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { CompanionInput, CompanionProjection, FieldGroup, StudioCompanion } from "../../studio/companion.ts";
import { authorFor, sourceFor, field, temporalAuthorities } from "../../studio/projection.ts";
import { renderTypes } from "../../render/ir.ts";
import { validateVisualTrack } from "../../render/validate.ts";
import { overlayTypes } from "../../components/screen-overlay/types.ts";
import { OVERLAY_FIELDS, validateOverlayProgram } from "../../components/screen-overlay/validate.ts";
import { stableIdentity } from "../../timeline/identity.ts";

const moduleId = "dsivio-video/screen-overlay@1";
const geometry = ["center-x", "center-y", "radius-x", "radius-y", "width", "size", "min-size", "max-size", "z"];
const motion = ["attack", "hold", "decay", "travel", "from", "to", "motion-rate", "drift"];

export function projectOverlay(input: CompanionInput): CompanionProjection {
  const supported = input.type === overlayTypes.program ? input.value : input.supports.program;
  if (!supported || supported.type !== overlayTypes.program) throw new DvError("STUDIO_SUPPORT", "Overlay projection requires its real Program support output.");
  validateOverlayProgram(supported.data);
  const program = supported.data;
  const rendered = input.type === renderTypes.visual ? input.value : input.supports.track;
  if (!rendered || rendered.type !== renderTypes.visual) throw new DvError("STUDIO_SUPPORT", "Overlay projection requires its real visual track.");
  validateVisualTrack(rendered.data);
  const lowered = rendered.data;
  if (program.effects.some(effect => !authorFor(input, effect.effectKey))) throw new DvError("STUDIO_PROVENANCE", "Overlay effect has no registered author identity.");
  const laneKey = `${input.authorKey}/effects`;
  const fieldGroups: FieldGroup[] = [];
  const entities = program.effects.map(effect => {
    const author = authorFor(input, effect.effectKey);
    const authorKey = author?.authorKey ?? input.authorKey;
    const ownerKey = authorKey;
    const fields = [field(input, authorKey, "z", { label: "Z", widget: "number", schemaKey: `${moduleId}#${effect.kind}.z`, authorValue: effect.z }), ...Object.entries(OVERLAY_FIELDS[effect.kind]).map(([name, rule]) => field(input, authorKey, name, {
      label: name, widget: rule.kind === "choice" ? "select" : rule.kind === "color" ? "color" : rule.kind === "colors" ? "list" : "number",
      schemaKey: `${moduleId}#${effect.kind}.${name}`, authorValue: (effect.options as unknown as Record<string, Json>)[name]!,
      ...(rule.kind === "choice" ? { options: rule.values.map((value: string) => ({ value, label: value })), schema: { type: "string" as const, enum: [...rule.values] } } : rule.kind === "number" ? { schema: { type: "number" as const, ...("min" in rule ? { minimum: rule.min } : {}), ...("max" in rule ? { maximum: rule.max } : {}) } } : rule.kind === "colors" ? { schema: { type: "array" as const, minItems: 1, items: { type: "string" as const, pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" } } } : { schema: { type: "string" as const, pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" } }),
      ...(rule.kind === "number" && "max" in rule && rule.max === 1 && "min" in rule && rule.min === 0 ? { displayScale: 100, units: ["%"] } : {}),
      ...(name === "attack" || name === "hold" || name === "decay" ? { units: ["f"] } : {}),
    }))];
    for (const [domain, sectionKey] of [["Where", "Geometry"], ["When", "Motion"], ["How", "Color"], ["How", "Effect"]] as const) {
      const selected = fields.filter(item => {
        const name = item.label;
        return sectionKey === "Geometry" ? geometry.includes(name) || name === "Z" : sectionKey === "Motion" ? motion.includes(name) : sectionKey === "Color" ? name === "color" || name === "colors" : !geometry.includes(name) && name !== "Z" && !motion.includes(name) && name !== "color" && name !== "colors";
      });
      if (selected.length) fieldGroups.push({ key: `${ownerKey}/${sectionKey}`, ownerKey, domain, pageKey: domain, sectionKey, fields: selected });
    }
    const presentKey = stableIdentity("screen-overlay-present", { trackKey: program.trackKey, effectKey: effect.effectKey });
    const present = lowered.presents.find(item => item.presentKey === presentKey);
    if (!present || lowered.trackKey !== program.trackKey || lowered.axisKey !== program.timeline.axisKey) throw new DvError("STUDIO_PROVENANCE", "Overlay visual part does not belong to its Program effect.");
    return {
      editorKey: `${authorKey}/effect`, authorKey, title: effect.kind, paintRank: effect.z,
      intervals: [effect.window.frames], laneKey, pictureParts: [present.presentKey, ...present.nodes.map(node => node.nodeKey)], parameterOwners: [ownerKey],
      sourceSlice: sourceFor(input, effect.effectKey),
      facts: { kind: effect.kind, options: effect.options as unknown as Json, z: effect.z },
      temporal: temporalAuthorities(input, effect.effectKey, "windows"),
    };
  });
  return { entities, lanes: [{ key: laneKey, title: "Screen overlays", height: 52, order: 0 }], bands: [], materials: [], fieldGroups, parameterOwners: [] };
}

export const overlayStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/track`, moduleId,
  matches: [{ surface: "Track", output: "track", type: renderTypes.visual }],
  family: "screen-overlay", icon: "effect", tone: "purple", supports: [{ output: "program", type: overlayTypes.program }], project: projectOverlay,
};
