import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { Frame } from "../../space/types.ts";
import { performanceStyle } from "../performance/author.ts";
import { integer } from "../sound/validate.ts";
import type { MediaAppearance, MediaPlayback } from "./types.ts";
export const FIT_KEYS = ["fit", "frame-x", "frame-y", "content-x", "content-y", "fit-offset-x", "fit-offset-y", "fit-constraint", "opacity", "blur", "brightness", "contrast", "saturation"];
export const SAMPLING_KEYS = ["playback", "trim-start", "trim-end"];
export function parseAppearance(key: string, frame: Frame, properties: Record<string, Json>, layerOnly = false): MediaAppearance {
  if (layerOnly && Object.keys(properties).some(k => ![...FIT_KEYS, ...SAMPLING_KEYS].includes(k))) throw new DvError("MEDIA_APPEARANCE", "Layer appearance only accepts fit and sampling keys.");
  const p = { ...properties }; delete p.playback; delete p["trim-start"]; delete p["trim-end"];
  if (layerOnly) p["stack-order"] = 0;
  const base = performanceStyle(key, frame, p);
  const playback = properties.playback ?? "once-start";
  if (!["once-start", "once-end", "hold-start", "hold-end", "loop-start", "loop-end", "stretch"].includes(String(playback))) throw new DvError("MEDIA_PLAYBACK", "Invalid visual playback mode.");
  const appearance: MediaAppearance = { ...base, playback: playback as MediaPlayback };
  if (properties["trim-start"] !== undefined || properties["trim-end"] !== undefined) {
    if (properties["trim-start"] === undefined || properties["trim-end"] === undefined) throw new DvError("MEDIA_TRIM", "Both source trim edges are required.");
    integer(properties["trim-start"]); integer(properties["trim-end"], 1);
    if (properties["trim-end"] <= properties["trim-start"]) throw new DvError("MEDIA_TRIM", "Source trim must be nonempty and both edges must be supplied.");
    appearance.trim = { start: properties["trim-start"], end: properties["trim-end"] };
  }
  return appearance;
}
