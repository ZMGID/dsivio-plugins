import { DvError } from "../../core/errors.ts";
import type { ModuleDef, ProducerInputs } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { Timeline } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Canvas } from "../../space/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { mediaTrackTypes } from "../../components/media-track/types.ts";
import type { MediaInputs } from "../../components/media-track/types.ts";
import { validateMediaPlan, validateMediaProgram } from "../../components/media-track/validate.ts";
import { assembleMediaProgram } from "../../components/media-track/program.ts";
import { lowerMediaVisual, lowerMediaAudio } from "../../components/media-track/lower.ts";
import { decodeMediaTrack, MEDIA_ATTRIBUTES } from "../../components/media-track/author.ts";
import { identity } from "../../components/sound/validate.ts";
import { mediaTrackStudio, mediaAuthorItems } from "./studio.ts";
import { elaborateTrack } from "../sound/studio.ts";
const moduleId = "dsivio-video/media-track@1";
const childSurfaces: ModuleDef["surfaces"] = {};
for (const [tag, attrs] of Object.entries(MEDIA_ATTRIBUTES)) if (tag !== "Track") childSurfaces[tag] = { mode: "structured", doc: { summary: `${tag} is valid only within media-track:Track. Complete typed sources and temporal evidence are required.`, attributes: attrs.map(name => ({ name, required: ["frame", "appearance"].includes(name) && ["Item", "Sequence", "Paint"].includes(tag) || name === "at" && tag === "Sampling" || ["from", "transition"].includes(name) && tag === "Handoff" || name === "source" && tag === "Sound" || name === "until" && tag === "Sequence", accepts: name === "frame" ? spaceTypes.frame : ["appearance", "motion", "transition"].includes(name) ? "dsivio-video/recipe@1#Recipe" : name === "media" || name === "source" ? timelineTypes.media : name === "surface" ? renderTypes.surface : name === "image" ? "dsivio-video/media@1#Image" : name === "extent" ? spaceTypes.extent : name === "clip" ? spaceTypes.path : "text", summary: name })), outputs: [] }, elaborate(node, ctx) { ctx.fail("MEDIA_CHILD", `${tag} belongs inside media-track:Track.`, node.span); } };
function materializedList(inputs: ProducerInputs, name: string): Json[] {
  const list = inputs[name]; if (!Array.isArray(list)) throw new DvError("MEDIA_INPUT", `Missing list '${name}'.`); return list.map(v => { if (!("data" in v)) throw new DvError("MEDIA_INPUT", "Pending inputs cannot be lowered."); return v.data; });
}
const mediaTrack: ModuleDef = {
  id: moduleId, summary: "Independent layered media and replacement sequences with explicit transitions, native source clocks, outer motion and declared audio.",
  studio: [mediaTrackStudio],
  types: { Plan: { summary: "Author placement and transition plan.", validate: validateMediaPlan }, Program: { summary: "Resolved source sampling, placement, motion and triggers.", validate: validateMediaProgram } },
  surfaces: { ...childSurfaces, Track: { mode: "structured", doc: { summary: "At least one Item or Sequence. Exports audio only when source-audio or Sound is declared; Film never inserts it automatically.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Identity." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Program clock." }, { name: "canvas", required: true, accepts: spaceTypes.canvas, summary: "Placement canvas." }], children: [{ tag: "Item", repeat: true, summary: "Independent W-window placement." }, { tag: "Sequence", repeat: true, summary: "Ordered Member replacements with adjacent Handoffs." }], outputs: [{ name: "program", type: mediaTrackTypes.program, summary: "Inspectable resolved program." }, { name: "visual", type: renderTypes.visual, summary: "Terminal visual track." }, { name: "audio", type: renderTypes.audio, summary: "Declared source audio and sound effects only." }] }, elaborate(node, ctx) { elaborateTrack(node, ctx, decodeMediaTrack, mediaAuthorItems); } } },
  producers: {
    program: { inputs: { key: { type: timelineTypes.consumerKey }, timeline: { type: timelineTypes.timeline }, canvas: { type: spaceTypes.canvas }, plan: { type: mediaTrackTypes.plan }, frames: { type: spaceTypes.frame, list: true }, images: { type: "dsivio-video/media@1#Image", list: true }, media: { type: timelineTypes.media, list: true }, surfaces: { type: renderTypes.surface, list: true }, extents: { type: spaceTypes.extent, list: true }, clips: { type: spaceTypes.path, list: true }, windows: { type: timelineTypes.window, list: true } }, outputs: { program: mediaTrackTypes.program }, run(inputs) {
      const plan = (inputs.plan as Value).data; validateMediaPlan(plan); const key = (inputs.key as Value).data; identity(key); if (key !== plan.trackKey) throw new DvError("MEDIA_KEY", "Track key mismatch.");
      const data = Object.fromEntries(["frames", "images", "media", "surfaces", "extents", "clips", "windows"].map(name => [name, materializedList(inputs, name)])) as unknown as MediaInputs;
      const program = assembleMediaProgram((inputs.timeline as Value).data as unknown as Timeline, (inputs.canvas as Value).data as unknown as Canvas, plan, data);
      return { outputs: { program: { type: mediaTrackTypes.program, data: program as unknown as Json } } };
    } },
    visual: { inputs: { program: { type: mediaTrackTypes.program } }, outputs: { visual: renderTypes.visual }, run(inputs) { const p = (inputs.program as Value).data; validateMediaProgram(p); return { outputs: { visual: { type: renderTypes.visual, data: lowerMediaVisual(p) as unknown as Json } } }; } },
    audio: { inputs: { program: { type: mediaTrackTypes.program } }, outputs: { audio: renderTypes.audio }, run(inputs) { const p = (inputs.program as Value).data; validateMediaProgram(p); return { outputs: { audio: { type: renderTypes.audio, data: lowerMediaAudio(p) as unknown as Json } } }; } },
  },
};
export default mediaTrack;
