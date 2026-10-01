import type { StudioCompanion } from "../../studio/companion.ts";
import { renderTypes } from "../../render/ir.ts";
import { timelineTypes } from "../../timeline/types.ts";

export const filmStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/film@1/composition", moduleId: "dsivio-video/film@1",
  matches: [{ surface: "Film", output: "composition", type: renderTypes.composition }],
  family: "film", icon: "film", tone: "neutral",
  film: {
    composition: { output: "composition", type: renderTypes.composition },
    timeline: { input: "timeline", type: timelineTypes.timeline },
    tracks: [{ input: "visualTracks", types: [renderTypes.visual], kind: "visual" }, { input: "audioTracks", types: [renderTypes.audio], kind: "audio" }],
  },
  project() { return { entities: [], lanes: [], bands: [], materials: [], fieldGroups: [], parameterOwners: [] }; },
};
