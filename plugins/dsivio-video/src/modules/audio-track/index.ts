import { DvError } from "../../core/errors.ts";
import type { ModuleDef } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { Timeline, SynchronizedMedia, Window } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { audioTrackTypes } from "../../components/audio-track/types.ts";
import type { AudioPlan } from "../../components/audio-track/types.ts";
import { validateAudioPlan, validateAudioProgram } from "../../components/audio-track/validate.ts";
import { assembleAudioProgram } from "../../components/audio-track/program.ts";
import { lowerAudio } from "../../components/audio-track/lower.ts";
import { decodeAudioTrack, AUDIO_ITEM_ATTRIBUTES } from "../../components/audio-track/author.ts";
import { identity } from "../../components/sound/validate.ts";
const audioTrack: ModuleDef = {
  id: "dsivio-video/audio-track@1", summary: "Independent explicitly normalized audio placements, native phase, loops, pitch-preserving stretch and audible-interval fades.",
  types: { Plan: { summary: "Author audio placement plan.", validate: validateAudioPlan }, Program: { summary: "Resolved audio source windows.", validate: validateAudioProgram } },
  surfaces: {
    Track: { mode: "structured", doc: { summary: "At least one Item; no visual output.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Identity." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Target program." }], children: [{ tag: "Item", repeat: true, summary: "Independent normalized audio placement." }], outputs: [{ name: "program", type: audioTrackTypes.program, summary: "Inspectable placement program." }, { name: "audio", type: renderTypes.audio, summary: "Terminal audio track." }] }, elaborate: decodeAudioTrack },
    Item: { mode: "structured", doc: { summary: "Complete W required. Trims independently default to zero/source end; once/loop align either edge; stretch requires both rate bounds; gain 0..64; fades fit actual audible span.", attributes: AUDIO_ITEM_ATTRIBUTES.map(name => ({ name, required: name === "source", accepts: name === "source" ? timelineTypes.media : "text", summary: name })), outputs: [] }, elaborate(node, ctx) { ctx.fail("AUDIO_CHILD", "Item belongs inside audio-track:Track.", node.span); } },
  },
  producers: {
    program: { inputs: { key: { type: timelineTypes.consumerKey }, timeline: { type: timelineTypes.timeline }, plan: { type: audioTrackTypes.plan }, sources: { type: timelineTypes.media, list: true }, windows: { type: timelineTypes.window, list: true } }, outputs: { program: audioTrackTypes.program }, run(inputs) {
      const key = (inputs.key as Value).data; identity(key);
      const program = assembleAudioProgram((inputs.timeline as Value).data as unknown as Timeline, (inputs.plan as Value).data as unknown as AudioPlan, (inputs.sources as Value[]).map(v => v.data as unknown as SynchronizedMedia), (inputs.windows as Value[]).map(v => v.data as unknown as Window));
      if (program.trackKey !== key) throw new DvError("AUDIO_KEY", "Audio track key mismatch.");
      return { outputs: { program: { type: audioTrackTypes.program, data: program as unknown as Json } } };
    } },
    lower: { inputs: { program: { type: audioTrackTypes.program } }, outputs: { audio: renderTypes.audio }, run(inputs) { const data = (inputs.program as Value).data; validateAudioProgram(data); return { outputs: { audio: { type: renderTypes.audio, data: lowerAudio(data) as unknown as Json } } }; } },
  },
};
export default audioTrack;
