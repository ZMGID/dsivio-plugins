import type { ModuleDef } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Timeline, Window } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { PerformanceProgram, PerformanceStyle, UsePlan } from "../../components/types.ts";
import { trackTypes } from "../../components/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { assemblePerformanceProgram } from "../../components/performance/program.ts";
import { lowerPerformance } from "../../components/performance/lower.ts";
import { decodePerformanceStyle, decodePerformanceTrack, performanceStyle } from "../../components/performance/author.ts";
import { validatePerformanceProgram, validatePerformanceStyle } from "../../components/performance/validate.ts";
import { identity, validateUsePlan } from "../../components/sound/validate.ts";
import { validateFrame } from "../../space/validate.ts";
import { RECIPE, validateRecipe } from "../recipe/index.ts";
import { USE_ATTRIBUTES } from "../sound/index.ts";

const performance: ModuleDef = {
  id: "dsivio-video/performance@1", summary: "Existing Timeline pictures styled independently of sound, retaining native source phase and ordered Use visibility.",
  types: { Style: { summary: "Resolved frame, content fit, filter, border/padding/shadows and explicit stacking.", validate: validatePerformanceStyle }, UsePlan: { summary: "Ordered identities and typed Window/Style input indexes.", validate: validateUsePlan }, Program: { summary: "Resolved Timeline/Canvas and ordered Use presentation rules.", validate: validatePerformanceProgram } },
  surfaces: {
    Style: { mode: "structured", doc: { summary: "Appearance supports fit/anchors/offset/constraint, opacity/blur/brightness/contrast/saturation, required stack-order, clip/radius/padding/border/shadows/frame-paint. Playback, trim and motion are forbidden.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Shared Style identity." }, { name: "frame", required: true, accepts: spaceTypes.frame, summary: "Canvas-space target frame." }, { name: "appearance", required: true, accepts: RECIPE, summary: "Static complete Appearance Recipe. Padding is 1/2/4 numbers; shadows are x y blur spread color separated by semicolons. Paint: #RRGGBB[AA], linear(angle; offset color, ...) or radial(x y; offset color, ...)." }], outputs: [{ name: "", type: trackTypes.performanceStyle, summary: "Shared Style." }] }, elaborate: decodePerformanceStyle },
    Track: { mode: "structured", doc: { summary: "Projects existing pictures at native speed; later Uses mask earlier rules without restarting phase. Empty Track has no picture.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Track identity." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Program axis." }, { name: "canvas", required: true, accepts: spaceTypes.canvas, summary: "Canvas geometry." }], children: [{ tag: "Use", repeat: true, summary: "Ordered Style/window rule." }], outputs: [{ name: "program", type: trackTypes.performanceProgram, summary: "Inspectable author program." }, { name: "visual", type: renderTypes.visual, summary: "Terminal visual track." }] }, elaborate: decodePerformanceTrack },
    Use: { mode: "structured", doc: { summary: "Track-only rule, default full program; supports complete W.", attributes: USE_ATTRIBUTES.map(attr => attr.name === "style" ? { ...attr, accepts: trackTypes.performanceStyle } : attr), outputs: [] }, elaborate(node, ctx) { ctx.fail("TRACK_CHILD", "Use is only valid inside performance:Track.", node.span); } },
  },
  producers: {
    style: { inputs: { frame: { type: spaceTypes.frame }, appearance: { type: RECIPE }, key: { type: timelineTypes.consumerKey } }, outputs: { style: trackTypes.performanceStyle }, run(inputs) {
      const frame = (inputs.frame as Value).data; validateFrame(frame);
      const appearance = (inputs.appearance as Value).data; validateRecipe(appearance);
      const key = (inputs.key as Value).data; identity(key);
      return { outputs: { style: { type: trackTypes.performanceStyle, data: performanceStyle(key, frame, appearance.properties) as unknown as Json } } };
    } },
    program: { inputs: { timeline: { type: timelineTypes.timeline }, canvas: { type: spaceTypes.canvas }, plan: { type: trackTypes.performancePlan }, windows: { type: timelineTypes.window, list: true }, styles: { type: trackTypes.performanceStyle, list: true } }, outputs: { program: trackTypes.performanceProgram }, run(inputs) {
      const program = assemblePerformanceProgram((inputs.timeline as Value).data as unknown as Timeline, (inputs.canvas as Value).data as Canvas, (inputs.plan as Value).data as UsePlan, (inputs.windows as Value[]).map(value => value.data as Window), (inputs.styles as Value[]).map(value => value.data as PerformanceStyle));
      return { outputs: { program: { type: trackTypes.performanceProgram, data: program as unknown as Json } } };
    } },
    lower: { inputs: { program: { type: trackTypes.performanceProgram } }, outputs: { visual: renderTypes.visual }, run(inputs) {
      const program = (inputs.program as Value).data;
      validatePerformanceProgram(program);
      return { outputs: { visual: { type: renderTypes.visual, data: lowerPerformance(program) as unknown as Json } } };
    } },
  },
};
export default performance;
