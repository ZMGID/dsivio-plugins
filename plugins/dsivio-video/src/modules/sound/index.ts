import type { ModuleDef, AttributeDoc } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { SoundProgram, SoundStyle, UsePlan } from "../../components/types.ts";
import { trackTypes } from "../../components/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { assembleSoundProgram } from "../../components/sound/program.ts";
import { lowerSound } from "../../components/sound/lower.ts";
import { decodeSoundStyle, decodeSoundTrack } from "../../components/sound/author.ts";
import { validateSoundProgram, validateSoundStyle, validateUsePlan } from "../../components/sound/validate.ts";
import { soundStudio, soundStyleStudio, elaborateTrack, soundAuthorItems } from "./studio.ts";

export const USE_ATTRIBUTES: AttributeDoc[] = [
  { name: "id", required: false, accepts: "text", summary: "Use identity, otherwise derived from declaration order." },
  { name: "style", required: true, accepts: trackTypes.soundStyle, summary: "Shared track Style reference." },
  { name: "during", required: false, accepts: "program or SegmentRef or SelectionRef", default: "program", summary: "Whole program or exact semantic span." },
  { name: "window", required: false, accepts: timelineTypes.window, summary: "Explicit shared Window; cannot combine with another W form." },
  { name: "at", required: false, accepts: "time literal or MomentRef", summary: "Start point; requires for." },
  { name: "until", required: false, accepts: "time literal or MomentRef", summary: "End point; requires for." },
  { name: "for", required: false, accepts: "time literal", summary: "Positive duration paired with at/until." },
  ...["start", "end"].map(name => ({ name, required: false, accepts: "point expression", summary: "Explicit window edge; both edges required." })),
  ...["start-source", "end-source", "selection", "segment", "moment"].map(name => ({ name, required: false, accepts: "semantic reference", summary: "Required semantic binding for edge expression; unused bindings forbidden." })),
];
const sound: ModuleDef = {
  id: "dsivio-video/sound@1", summary: "Ordered presentation rules for existing Timeline sound; one placement-level 48 kHz sample origin preserves phase across Use splits, including fractional FPS. Source and Use precedence mask audibility without resetting playback.",
  studio: [soundStudio, soundStyleStudio],
  types: { Style: { summary: "Shared linear gain endpoints in 0..64.", validate: validateSoundStyle }, UsePlan: { summary: "Ordered identities and indexes into typed Window/Style input lists.", validate: validateUsePlan }, Program: { summary: "Timeline with ordered resolved Use windows and shared styles.", validate: validateSoundProgram } },
  surfaces: {
    Style: { mode: "structured", doc: { summary: "Empty gain Style. Zero gain still masks earlier Uses.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Shared Style name." }, { name: "gain", required: false, accepts: "number 0..64", default: "1", summary: "Gain at window start." }, { name: "end-gain", required: false, accepts: "number 0..64", default: "gain", summary: "Gain at window end." }], outputs: [{ name: "", type: trackTypes.soundStyle, summary: "Shared Style." }] }, elaborate: decodeSoundStyle },
    Track: { mode: "structured", doc: { summary: "Projects existing source sound with last-placement/last-Use precedence. Empty Track is silent.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Track identity." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Program axis." }], children: [{ tag: "Use", repeat: true, summary: "Ordered presentation rule." }], outputs: [{ name: "program", type: trackTypes.soundProgram, summary: "Inspectable author program." }, { name: "audio", type: renderTypes.audio, summary: "Terminal sound track." }] }, elaborate(node, ctx) { elaborateTrack(node, ctx, decodeSoundTrack, soundAuthorItems); } },
    Use: { mode: "structured", doc: { summary: "Track-only shared Style/window rule; full W with default program.", attributes: USE_ATTRIBUTES, outputs: [] }, elaborate(node, ctx) { ctx.fail("TRACK_CHILD", "Use is only valid inside sound:Track.", node.span); } },
  },
  producers: {
    program: { inputs: { timeline: { type: timelineTypes.timeline }, plan: { type: trackTypes.soundPlan }, windows: { type: timelineTypes.window, list: true }, styles: { type: trackTypes.soundStyle, list: true } }, outputs: { program: trackTypes.soundProgram }, run(inputs) {
      const program = assembleSoundProgram((inputs.timeline as Value).data as unknown as Timeline, (inputs.plan as Value).data as UsePlan, (inputs.windows as Value[]).map(value => value.data as Window), (inputs.styles as Value[]).map(value => value.data as SoundStyle));
      return { outputs: { program: { type: trackTypes.soundProgram, data: program as unknown as Json } } };
    } },
    lower: { inputs: { program: { type: trackTypes.soundProgram } }, outputs: { audio: renderTypes.audio }, run(inputs) {
      const program = (inputs.program as Value).data;
      validateSoundProgram(program);
      return { outputs: { audio: { type: renderTypes.audio, data: lowerSound(program) as unknown as Json } } };
    } },
  },
};
export default sound;
