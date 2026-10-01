import { DvError } from "../../core/errors.ts";
import { object, exact } from "../../space/validate.ts";
import { color, choice, range } from "../image-transform/validate.ts";
import type { ComposePlan } from "./types.ts";
export function validateComposePlan(value: unknown): asserts value is ComposePlan {
  const p = object(value); exact(p, ["background", "layers"]); color(p.background, true);
  if (!Array.isArray(p.layers) || p.layers.length < 1 || p.layers.length > 64) throw new DvError("RASTER_INVALID", "Compose requires 1..64 layers.");
  for (const layer of p.layers) { const l = object(layer); exact(l, ["fit", "interpolation", "opacity"]); choice(l.fit, "Layer fit", ["contain", "cover", "stretch"]); choice(l.interpolation, "Layer interpolation", ["nearest", "linear", "cubic", "area", "lanczos"]); range(l.opacity, "Layer opacity", 0, 1); }
}
