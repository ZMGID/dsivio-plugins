import type { StudioCompanion, CompanionInput, StudioEntity } from "../../studio/companion.ts";
import type { CaptionProgram } from "../../components/caption/types.ts";
import { captionTypes } from "../../components/caption/types.ts";
import { emptyProjection, sourceFor, temporalAuthorities, parameterOwner } from "../../studio/projection.ts";

/** Caption text is authored display text, never an editable reconstruction of Script. */
export function captionEntities(input: CompanionInput, program: CaptionProgram, laneKey: string, bandKey: string): StudioEntity[] {
  const documentOwner = parameterOwner(input, "document");
  const documentSlice = documentOwner ? sourceFor(input, documentOwner.authorKey) : input.sourceSlice;
  const cues: StudioEntity[] = program.content.cues.map((cue, index) => ({
    editorKey: `${input.authorKey}/cue/${index}`, authorKey: documentOwner?.authorKey ?? input.authorKey,
    title: `${index + 1}. ${cue.units.map((unit, unitIndex) => (unitIndex ? unit.separator : "") + unit.text).join("")}`,
    text: cue.units.map((unit, unitIndex) => (unitIndex ? unit.separator : "") + unit.text).join(""),
    paintRank: index, intervals: [cue.frames], laneKey,
    pictureParts: [], parameterOwners: [], facts: { cueKey: cue.cueKey, ...(cue.role ? { role: cue.role } : {}) },
    temporal: [], ...(documentSlice ? { sourceSlice: sourceFor(input, cue.cueKey) ?? documentSlice } : {}),
  }));
  const uses: StudioEntity[] = program.uses.map((use, index) => {
    const relation = input.authoring.relations.find(item => item.identity === use.useKey);
    const authorKey = relation?.authorKey ?? input.authorKey;
    const sourceSlice = relation ? sourceFor(input, relation.bindingKey) : input.sourceSlice;
    const owner = parameterOwner(input, "styles", index)?.authorKey;
    return {
      editorKey: authorKey === input.authorKey ? `${authorKey}/use/${index}` : authorKey,
      authorKey, title: use.style.kind === "hidden" ? "Hidden" : "Caption Style", paintRank: index,
      intervals: [use.window.frames], laneKey, bandKey,
      pictureParts: [], parameterOwners: owner ? [owner] : [],
      facts: { styleKey: use.style.styleKey, ...(use.role ? { role: use.role } : {}) },
      temporal: temporalAuthorities(input, use.useKey, "windows"), ...(sourceSlice ? { sourceSlice } : {}),
    };
  });
  return [...cues, ...uses];
}

export const captionStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/caption@1#hidden-studio", moduleId: "dsivio-video/caption@1",
  matches: [{ surface: "Hidden", output: "", type: captionTypes.style }],
  family: "caption", icon: "text", tone: "purple",
  project(input) {
    return { ...emptyProjection(), parameterOwners: [{ key: input.authorKey, authorKey: input.authorKey, moduleId: input.moduleId, surface: input.surface, output: input.output, value: input.value, bindings: [] }] };
  },
};
