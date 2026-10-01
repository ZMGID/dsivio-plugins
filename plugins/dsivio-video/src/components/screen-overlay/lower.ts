import type { Json } from "../../core/value.ts";
import { BROWSER_PROGRAM_VERSION } from "../../render/ir.ts";
import type { VisualTrack } from "../../render/ir.ts";
import { stableIdentity } from "../../timeline/identity.ts";
import type { OverlayProgram } from "./types.ts";
import { validateOverlayProgram } from "./validate.ts";
import { OVERLAY_SETUP } from "./runtime.ts";

export function lowerOverlay(program: OverlayProgram): VisualTrack {
  validateOverlayProgram(program);
  const { widthPx, heightPx } = program.canvas.extent;
  return {
    kind: "visual", trackKey: program.trackKey, axisKey: program.timeline.axisKey,
    presents: program.effects.map((effect, index) => {
      const presentKey = stableIdentity("screen-overlay-present", { trackKey: program.trackKey, effectKey: effect.effectKey });
      const rootKey = `${presentKey}/overlay`;
      return {
        presentKey, axisKey: program.timeline.axisKey, lifetime: effect.window.frames,
        layer: effect.z, layerKey: `${String(index).padStart(16, "0")}/${program.trackKey}/${effect.effectKey}`, rootKey,
        nodes: [{
          kind: "program", nodeKey: rootKey, parentKey: null, order: 0, keyframes: [], attributes: [],
          style: [
            { property: "position", value: "absolute" }, { property: "left", value: "0px" }, { property: "top", value: "0px" },
            { property: "width", value: `${widthPx}px` }, { property: "height", value: `${heightPx}px` }, { property: "overflow", value: "hidden" },
          ],
          program: {
            format: BROWSER_PROGRAM_VERSION, html: '<canvas aria-hidden="true"></canvas>', css: 'canvas { display: block; width: 100%; height: 100%; }', setup: OVERLAY_SETUP,
            data: { kind: effect.kind, options: effect.options, width: widthPx, height: heightPx, frames: effect.window.frames.end - effect.window.frames.start } as unknown as Json,
            resources: [],
          },
        }],
      };
    }),
  };
}
