import type { Json } from "../../core/value.ts";
import { DvError } from "../../core/errors.ts";
import type { CompanionInput, CompanionProjection, FieldGroup, StudioCompanion, StudioField } from "../../studio/companion.ts";
import type { FineProgram, FineStyle } from "../../components/caption-fine/types.ts";
import { fineTypes } from "../../components/caption-fine/types.ts";
import { captionTypes } from "../../components/caption/types.ts";
import { renderTypes } from "../../render/ir.ts";
import type { VisualTrack } from "../../render/ir.ts";
import { actions } from "../../components/caption-fine/style.ts";
import { validateFineProgram } from "../../components/caption-fine/validate.ts";
import { validateCaptionStyle } from "../../components/caption/validate.ts";
import { captionEntities } from "../caption/studio.ts";
import { emptyProjection, field, parameterOwner } from "../../studio/projection.ts";

type Section = { domain: FieldGroup["domain"]; page: string; names: string };
const paint = "fill opacity stroke-color stroke-width shadow-color shadow-opacity shadow-x shadow-y shadow-spread shadow-blur glow-color glow-opacity glow-blur glow-spread long-shadow-color long-shadow-opacity long-shadow-distance long-shadow-angle";
const sections: readonly Section[] = [
  { domain: "Where", page: "Placement", names: "stack-order x y width height anchor-x anchor-y" },
  { domain: "Where", page: "Flow", names: "align block-align direction inline-size wrap line-height letter-spacing word-gap max-words-per-line max-lines" },
  { domain: "How", page: "Text", names: "size kerning caps text-transform" },
  { domain: "How", page: "Paint", names: `${paint} ${paint.split(" ").map(name => `active-${name}`).join(" ")}` },
  { domain: "How", page: "Cue Box", names: "background padding radius border-color border-width cue-shadow-color cue-shadow-opacity cue-shadow-x cue-shadow-y cue-shadow-spread cue-shadow-blur" },
  { domain: "How", page: "Decoration", names: "underline underline-color underline-thickness underline-offset active-underline active-underline-color active-underline-thickness active-underline-offset active-box active-box-continuity active-box-background active-box-border-color active-box-border-width active-box-padding active-box-radius" },
  { domain: "When", page: "Cue", names: "lead-frames tail-frames handoff cue-enter cue-exit cue-enter-frames cue-exit-frames cue-enter-start-scale slide-distance" },
  { domain: "When", page: "Token", names: "karaoke karaoke-transition atom-enter atom-exit atom-enter-frames atom-exit-frames atom-reveal active-box-enter active-box-exit active-box-transition-frames active-response active-response-frames active-scale" },
  { domain: "When", page: "Loop", names: "loop loop-target loop-period-frames loop-intensity" },
];
const choices: Readonly<Record<string, readonly string[]>> = {
  "anchor-x": ["left", "center", "right"], "anchor-y": ["top", "center", "bottom"], align: ["left", "center", "right"],
  "block-align": ["start", "center", "end"], direction: ["ltr", "rtl"], "inline-size": ["hug", "fixed"], wrap: ["word", "grapheme"],
  kerning: ["auto", "normal", "none"], caps: ["normal", "small-caps", "all-small-caps"], "text-transform": ["none", "uppercase", "lowercase", "capitalize"],
  underline: ["off", "always"], "active-underline": ["off", "current", "trail"], "active-box": ["off", "current", "trail"], "active-box-continuity": ["isolated", "joined"],
  handoff: ["cut", "overlap"], karaoke: ["off", "current", "trail"], "karaoke-transition": ["step", "wipe"], "atom-reveal": ["all", "on-start", "typewriter"],
  loop: ["none", "shake", "wobble", "glow-pulse", "breathe", "float", "pulse", "flicker"], "loop-target": ["cue", "active-atom"],
};
const actionFields: Readonly<Record<string, true>> = { "cue-enter": true, "cue-exit": true, "atom-enter": true, "atom-exit": true, "active-box-enter": true, "active-box-exit": true, "active-response": true };
const colors: Readonly<Record<string, true>> = { fill: true, "active-fill": true, background: true, "active-box-background": true, "gradient-from": true, "gradient-to": true, "active-gradient-from": true, "active-gradient-to": true };
function fields(input: CompanionInput, style: FineStyle): CompanionProjection {
  const owner = parameterOwner(input, "recipe");
  const ownerKey = owner?.authorKey ?? input.authorKey;
  const groups: FieldGroup[] = sections.map(section => ({
    key: `${ownerKey}/${section.domain}/${section.page}`, ownerKey, domain: section.domain, pageKey: section.page, sectionKey: section.page,
    fields: section.names.split(" ").map(name => {
      const options = actionFields[name] ? actions : choices[name];
      const widget: StudioField["widget"] = options ? "select" : colors[name] || name.endsWith("-color") ? "color" : name === "padding" || name === "active-box-padding" ? "text" : "number";
      const authorValue: Json = style.recipe[name] ?? null;
      return field(input, ownerKey, name, {
        label: name, widget, schemaKey: `dsivio-video/caption-fine@1#recipe/${name}`, authorValue,
        schema: { type: widget === "number" ? "number" : "string", ...(options ? { enum: options } : {}) },
        ...(options ? { options: options.map(value => ({ value, label: value })) } : {}),
        ...(name === "opacity" || name.endsWith("-opacity") || ["x", "y", "width", "height"].includes(name) ? { displayScale: 100 } : {}),
      });
    }),
  }));
  for (const prefix of ["", "active-"]) {
    const from = `${prefix}gradient-from`, to = `${prefix}gradient-to`, angle = `${prefix}gradient-angle`;
    const authorValue: Record<string, Json> = style.recipe[from] === undefined ? {} : { [from]: style.recipe[from]!, [to]: style.recipe[to]!, [angle]: style.recipe[angle] ?? 90 };
    groups.push({ key: `${ownerKey}/How/${prefix}Gradient`, ownerKey, domain: "How", pageKey: "Paint", sectionKey: prefix ? "Active Gradient" : "Gradient", fields: [field(input, ownerKey, from, {
      label: prefix ? "Active Gradient" : "Gradient", widget: "record", schemaKey: `dsivio-video/caption-fine@1#${prefix}gradient`, authorValue, groupMembers: [from, to, angle],
      schema: { type: "object", additionalProperties: false, properties: { [from]: { type: "string", pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" }, [to]: { type: "string", pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" }, [angle]: { type: "number" } } },
    })] });
  }
  return { ...emptyProjection(), fieldGroups: groups, parameterOwners: owner ? [owner] : [] };
}

export const fineStyleStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/caption-fine@1#style-studio", moduleId: "dsivio-video/caption-fine@1",
  matches: [{ surface: "Style", output: "", type: captionTypes.style }], family: "caption-style", icon: "text", tone: "purple",
  project(input) {
    validateCaptionStyle(input.value.data);
    const style = input.value.data as unknown as FineStyle;
    return fields(input, style);
  },
};

export const fineTrackStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/caption-fine@1#track-studio", moduleId: "dsivio-video/caption-fine@1",
  matches: [{ surface: "Track", output: "track", type: renderTypes.visual }],
  supports: [{ output: "program", type: fineTypes.program }, { output: "content", type: captionTypes.content }, { output: "schedule", type: fineTypes.schedule }],
  family: "caption", icon: "text", tone: "purple",
  project(input) {
    const value = input.supports.program;
    if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "caption-fine Track requires its same-Surface program output");
    validateFineProgram(value.data);
    const program = value.data as unknown as FineProgram;
    const laneKey = `${input.authorKey}/captions`, bandKey = `${laneKey}/uses`;
    const entities = captionEntities(input, program, laneKey, bandKey).map(entity => {
      if (entity.bandKey) return entity;
      const cueKey = entity.facts.cueKey;
      const track = input.value.data as unknown as VisualTrack;
      const parts = track.presents.filter(present => program.uses.some(use => present.presentKey === `${program.trackKey}/${String(cueKey)}/${use.useKey}`));
      return { ...entity, pictureParts: parts.flatMap(part => [part.presentKey, ...part.nodes.map(node => node.nodeKey)]), visibleIntervals: parts.flatMap(part => part.visible ?? [part.lifetime]) };
    });
    return { ...emptyProjection(), entities, lanes: [{ key: laneKey, title: "Captions", height: 36, order: 0 }], bands: [{ key: bandKey, laneKey, title: "Uses", height: 15, order: 0 }] };
  },
};
