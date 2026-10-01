import { DvError } from "../../core/errors.ts";
import type { PerformanceProgram } from "../types.ts";
import type { Present, StyleDeclaration, VisualNode, VisualTrack } from "../../render/ir.ts";
import type { Rect } from "../../space/types.ts";
import { fitContent } from "../../space/math.ts";
import { stableIdentity } from "../../timeline/identity.ts";
import { subtractWindows } from "../sound/validate.ts";
import { validatePerformanceProgram } from "./validate.ts";
import { frameInkCss } from "./author.ts";

function geometry(rect: Rect): StyleDeclaration[] {
  return [{ property: "position", value: "absolute" }, { property: "left", value: `${rect.xPx}px` }, { property: "top", value: `${rect.yPx}px` }, { property: "width", value: `${rect.widthPx}px` }, { property: "height", value: `${rect.heightPx}px` }, { property: "box-sizing", value: "border-box" }];
}
export function lowerPerformance(program: PerformanceProgram): VisualTrack {
  validatePerformanceProgram(program);
  const presents: Present[] = [];
  for (const [useIndex, use] of program.uses.entries()) {
    const laterUses = program.uses.slice(useIndex + 1).map(item => item.window.frames);
    for (const [placementIndex, placement] of program.timeline.placements.entries()) {
      const media = placement.take.media;
      if (!media.picture) continue;
      const lifetime = { start: Math.max(placement.offsetFrames, use.window.frames.start), end: Math.min(placement.offsetFrames + media.totalFrames, use.window.frames.end) };
      if (lifetime.end <= lifetime.start) continue;
      const visible = subtractWindows(lifetime, laterUses);
      const presentKey = stableIdentity("performance-present", { trackKey: program.trackKey, useKey: use.useKey, placementKey: placement.placementKey });
      const rootKey = `${presentKey}/frame`;
      const { rect } = use.style.frame;
      const [top, right, bottom, left] = use.style.contentInsetPx;
      const fitted = fitContent({ xPx: rect.xPx + left, yPx: rect.yPx + top, widthPx: rect.widthPx - left - right, heightPx: rect.heightPx - top - bottom }, media.picture.extent, use.style.fit);
      // border-box's child coordinate origin is the inner border edge, not its outer frame edge.
      const borderDeclaration = use.style.outerStyle.find(item => item.property === "border");
      const borderWidth = borderDeclaration ? Number.parseFloat(borderDeclaration.value) : 0;
      const outer: StyleDeclaration[] = [...geometry(rect), ...use.style.outerStyle];
      if (use.style.clip === "frame") outer.push({ property: "clip-path", value: "inset(0)" });
      if (use.style.clip === "rounded") outer.push({ property: "clip-path", value: `inset(0 round ${use.style.radiusPx}px)` });
      if (use.style.framePaint) {
        if (use.style.framePaint.kind !== "fill") throw new DvError("TYPE_INVALID", "Performance frame paint must be a fill.");
        outer.push({ property: use.style.framePaint.ink.kind === "solid" ? "background-color" : "background-image", value: frameInkCss(use.style.framePaint.ink) });
      }
      const nodes: VisualNode[] = [
        { kind: "box", nodeKey: rootKey, parentKey: null, order: 0, style: outer, keyframes: [], attributes: [] },
        { kind: "video", nodeKey: `${presentKey}/picture`, parentKey: rootKey, order: 1,
          style: geometry({ ...fitted, xPx: fitted.xPx - rect.xPx - borderWidth, yPx: fitted.yPx - rect.yPx - borderWidth }), keyframes: [], attributes: [], resource: media.picture.resource,
          sampling: { sourceClock: media.clock, sourceTotalFrames: media.totalFrames, pieces: [{ target: { start: 0, end: lifetime.end - lifetime.start }, sourceStart: { numerator: lifetime.start - placement.offsetFrames, denominator: 1 }, sourceStep: { numerator: 1, denominator: 1 } }] },
        },
      ];
      presents.push({ presentKey, axisKey: program.timeline.axisKey, lifetime, visible, layer: use.style.layer, layerKey: `${String(placementIndex).padStart(16, "0")}/${program.trackKey}/${use.useKey}`, rootKey, nodes });
    }
  }
  return { kind: "visual", trackKey: program.trackKey, axisKey: program.timeline.axisKey, presents };
}
