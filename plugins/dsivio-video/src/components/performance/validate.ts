import { DvError } from "../../core/errors.ts";
import { fitContent } from "../../space/math.ts";
import { validateCanvas, validateFrame } from "../../space/validate.ts";
import { validateTimeline, validateWindow } from "../../timeline/validate.ts";
import { validateStyle as validateStyleDeclarations } from "../../render/validate.ts";
import { validatePaint } from "../../render/text-runtime.ts";
import type { PerformanceProgram, PerformanceStyle } from "../types.ts";
import { finite, identity, integer, object } from "../sound/validate.ts";

export function validatePerformanceStyle(data: unknown): asserts data is PerformanceStyle {
  const style = object(data, ["styleKey", "frame", "layer", "fit", "outerStyle", "contentInsetPx", "clip", "radiusPx"], ["framePaint"]);
  identity(style.styleKey); validateFrame(style.frame); integer(style.layer, -Number.MAX_SAFE_INTEGER); finite(style.radiusPx, 0);
  if (!["none", "frame", "rounded"].includes(String(style.clip))) throw new DvError("TYPE_INVALID", "Unknown performance clipping mode.");
  const fit = object(style.fit, [], ["mode", "frameAnchor", "contentAnchor", "offsetXPx", "offsetYPx", "limit"]);
  for (const name of ["frameAnchor", "contentAnchor"]) if (fit[name] !== undefined) {
    const anchor = object(fit[name], ["x", "y"]); finite(anchor.x, 0, 1); finite(anchor.y, 0, 1);
  }
  if (fit.mode !== undefined && !["contain", "cover", "fit-width", "fit-height", "native", "scale-down", "stretch"].includes(String(fit.mode))) throw new DvError("TYPE_INVALID", "Unknown content fit mode.");
  if (fit.limit !== undefined && fit.limit !== "bounded" && fit.limit !== "free") throw new DvError("TYPE_INVALID", "Unknown content fit limit.");
  for (const name of ["offsetXPx", "offsetYPx"]) if (fit[name] !== undefined) finite(fit[name]);
  if (!Array.isArray(style.contentInsetPx) || style.contentInsetPx.length !== 4) throw new DvError("TYPE_INVALID", "Performance inset requires four sides.");
  style.contentInsetPx.forEach(value => finite(value, 0));
  if (Number(style.contentInsetPx[1]) + Number(style.contentInsetPx[3]) >= style.frame.rect.widthPx || Number(style.contentInsetPx[0]) + Number(style.contentInsetPx[2]) >= style.frame.rect.heightPx) throw new DvError("PERFORMANCE_INSET", "Padding and border must leave a positive content rectangle.");
  validateStyleDeclarations(style.outerStyle);
  if (style.framePaint !== undefined) {
    validatePaint(style.framePaint);
    if (style.framePaint.kind !== "fill") throw new DvError("TYPE_INVALID", "Performance frame paint must be a fill.");
  }
}
export function validatePerformanceProgram(data: unknown): asserts data is PerformanceProgram {
  const program = object(data, ["trackKey", "timeline", "canvas", "uses"]);
  identity(program.trackKey); validateTimeline(program.timeline); validateCanvas(program.canvas);
  if (!Array.isArray(program.uses)) throw new DvError("TYPE_INVALID", "Performance requires an ordered Use list.");
  const keys = new Set<string>();
  for (const entry of program.uses) {
    const use = object(entry, ["useKey", "window", "style"]);
    identity(use.useKey); validateWindow(use.window); validatePerformanceStyle(use.style);
    if (keys.has(use.useKey) || use.window.consumerKey !== use.useKey || use.window.axisKey !== program.timeline.axisKey || use.window.frames.end > program.timeline.totalFrames || use.style.frame.canvasKey !== program.canvas.canvasKey) throw new DvError("TYPE_INVALID", "Use has mismatched identity, canvas or program bounds.");
    keys.add(use.useKey);
    fitContent(use.style.frame.rect, program.canvas.extent, use.style.fit);
  }
}
