import { DvError } from "../../core/errors.ts";
import type { ModuleDef, ProducerInputs, SurfaceDef } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import { renderTypes } from "../../render/ir.ts";
import { spaceTypes } from "../../space/types.ts";
import { validateCanvas } from "../../space/validate.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { validateTimeline, validateWindow } from "../../timeline/validate.ts";
import { identity } from "../../components/sound/validate.ts";
import { decodeOverlayTrack } from "../../components/screen-overlay/author.ts";
import { assembleOverlayProgram } from "../../components/screen-overlay/program.ts";
import { lowerOverlay } from "../../components/screen-overlay/lower.ts";
import { overlayTypes } from "../../components/screen-overlay/types.ts";
import { OVERLAY_FIELDS, OVERLAY_KINDS, validateOverlayPlan, validateOverlayProgram } from "../../components/screen-overlay/validate.ts";
import { WINDOW_ATTRIBUTES } from "../time/index.ts";

function input(inputs: ProducerInputs, name: string): Json {
  const value = inputs[name];
  if (!value || Array.isArray(value) || !("data" in value)) throw new DvError("OVERLAY_INPUT", `Missing materialized '${name}'.`);
  return value.data;
}
const surfaces: Record<string, SurfaceDef> = {
  Track: {
    mode: "structured", doc: {
      summary: "Eleven seeded full-canvas overlays. Independent effects stack by z and declaration order without altering lower video.",
      attributes: [
        { name: "id", required: true, accepts: "text", summary: "Track identity." },
        { name: "canvas", required: true, accepts: spaceTypes.canvas, summary: "Complete canvas geometry." },
        { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Program axis." },
      ],
      children: OVERLAY_KINDS.map(tag => ({ tag, repeat: true, summary: `${tag} overlay with explicit parameters and window.` })),
      outputs: [ { name: "program", type: overlayTypes.program, summary: "Inspectable overlay plan." }, { name: "track", type: renderTypes.visual, summary: "Terminal full-canvas visual track." } ],
    }, elaborate: decodeOverlayTrack,
  },
};
for (const kind of OVERLAY_KINDS) surfaces[kind] = {
  mode: "structured", doc: {
    summary: `${kind}: empty effect declaration inside Track; every effect-specific parameter is required.`,
    attributes: [
      { name: "id", required: false, accepts: "text", summary: "Defaults to effect kind and declaration number." },
      { name: "z", required: true, accepts: "safe integer", summary: "Visual stack layer." },
      ...WINDOW_ATTRIBUTES.map(name => ({ name, required: false, accepts: "time literal or typed semantic/window reference", summary: "Required explicit W: during, at+for, until+for, start+end or shared window." })),
      ...Object.entries(OVERLAY_FIELDS[kind]).map(([name, rule]) => ({ name, required: true, accepts: rule.kind, summary: JSON.stringify(rule) })),
    ], outputs: [],
  },
  elaborate(node, ctx) { ctx.fail("OVERLAY_CHILD", `${kind} is only valid inside screen-overlay:Track.`, node.span); },
};
const overlay: ModuleDef = {
  id: "dsivio-video/screen-overlay@1", summary: "Eleven deterministic full-screen visual overlays, lowered to trusted canvas programs.",
  types: {
    AuthorPlan: { summary: "Ordered typed effect parameters and projected window indexes.", validate: validateOverlayPlan },
    Program: { summary: "Resolved canvas, timeline and independent effect lifetimes.", validate: validateOverlayProgram },
  }, surfaces,
  producers: {
    program: {
      inputs: { key: { type: timelineTypes.consumerKey }, canvas: { type: spaceTypes.canvas }, timeline: { type: timelineTypes.timeline }, plan: { type: overlayTypes.plan }, windows: { type: timelineTypes.window, list: true } },
      outputs: { program: overlayTypes.program },
      run(inputs) {
        const key = input(inputs, "key"); identity(key);
        const canvas = input(inputs, "canvas"); validateCanvas(canvas);
        const timeline = input(inputs, "timeline"); validateTimeline(timeline);
        const plan = input(inputs, "plan"); validateOverlayPlan(plan);
        const values = inputs.windows;
        if (!Array.isArray(values)) throw new DvError("OVERLAY_INPUT", "windows must be a typed list.");
        const windows = values.map(value => {
          if (!("data" in value)) throw new DvError("OVERLAY_INPUT", "Overlay window is pending.");
          validateWindow(value.data); return value.data;
        });
        return { outputs: { program: { type: overlayTypes.program, data: assembleOverlayProgram(key, canvas, timeline, plan, windows) as unknown as Json } } };
      },
    },
    lower: {
      inputs: { program: { type: overlayTypes.program } }, outputs: { track: renderTypes.visual },
      run(inputs) {
        const program = input(inputs, "program"); validateOverlayProgram(program);
        return { outputs: { track: { type: renderTypes.visual, data: lowerOverlay(program) as unknown as Json } } };
      },
    },
  },
};
export default overlay;
