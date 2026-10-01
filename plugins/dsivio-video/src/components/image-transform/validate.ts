import { DvError } from "../../core/errors.ts";
import { object, exact } from "../../space/validate.ts";
import type { ImageProgram, RasterStep } from "./types.ts";
export function range(value: unknown, name: string, min: number, max: number, integral = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integral && !Number.isSafeInteger(value))) throw new DvError("RASTER_INVALID", `${name} must be ${integral ? "an integer" : "finite"} in ${min}..${max}.`);
}
export function choice(value: unknown, name: string, choices: readonly string[]): void {
  if (typeof value !== "string" || !choices.includes(value)) throw new DvError("RASTER_INVALID", `${name} must be ${choices.join(" or ")}.`);
}
export function color(value: unknown, rgba = false): void {
  if (typeof value !== "string" || !(rgba ? /^#[0-9a-f]{8}$/i : /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i).test(value)) throw new DvError("RASTER_INVALID", `Color requires ${rgba ? "eight" : "six or eight"} hexadecimal digits.`);
}
export function validateStep(value: unknown): asserts value is RasterStep {
  const s = object(value);
  switch (s.kind) {
    case "crop": {
      exact(s, ["kind", "unit", "x", "y", "width", "height"]); choice(s.unit, "Crop unit", ["fraction", "pixel"]);
      const pixels = s.unit === "pixel";
      range(s.x, "Crop x", 0, pixels ? Number.MAX_SAFE_INTEGER : 1, pixels); range(s.y, "Crop y", 0, pixels ? Number.MAX_SAFE_INTEGER : 1, pixels);
      range(s.width, "Crop width", pixels ? 1 : Number.MIN_VALUE, pixels ? 65535 : 1, pixels); range(s.height, "Crop height", pixels ? 1 : Number.MIN_VALUE, pixels ? 65535 : 1, pixels);
      if (!pixels && (s.x + s.width > 1 + 1e-9 || s.y + s.height > 1 + 1e-9)) throw new DvError("RASTER_INVALID", "Fraction crop exceeds image bounds."); break;
    }
    case "resize": exact(s, ["kind", "width", "height", "fit", "interpolation", "background"]); range(s.width, "Resize width", 1, 16384, true); range(s.height, "Resize height", 1, 16384, true); choice(s.fit, "Fit", ["contain", "cover", "stretch"]); choice(s.interpolation, "Interpolation", ["nearest", "linear", "cubic", "area", "lanczos"]); if (s.background !== undefined) color(s.background); break;
    case "rotate": exact(s, ["kind", "degrees"]); if (![90, 180, 270].includes(Number(s.degrees)) || typeof s.degrees !== "number") throw new DvError("RASTER_INVALID", "Rotate degrees must be 90, 180 or 270."); break;
    case "flip": exact(s, ["kind", "axis"]); choice(s.axis, "Flip axis", ["horizontal", "vertical", "both"]); break;
    case "denoise": exact(s, ["kind", "method", "luma", "chroma", "templateWindow", "searchWindow", "saturationRecovery"]); choice(s.method, "Denoise method", ["nlm-ycrcb"]); range(s.luma, "Luma", 0, 50); range(s.chroma, "Chroma", 0, 50); range(s.templateWindow, "Template window", 1, 31, true); range(s.searchWindow, "Search window", 1, 63, true); range(s.saturationRecovery, "Saturation recovery", 0, 4); if (s.templateWindow % 2 !== 1 || s.searchWindow % 2 !== 1 || s.searchWindow <= s.templateWindow) throw new DvError("RASTER_INVALID", "Denoise windows must be odd; search must exceed template."); break;
    case "color": exact(s, ["kind", "exposureStops", "contrast", "saturation", "temperature", "tint", "gamma"]); range(s.exposureStops, "Exposure", -8, 8); range(s.contrast, "Contrast", 0, 4); range(s.saturation, "Saturation", 0, 4); range(s.temperature, "Temperature", -1, 1); range(s.tint, "Tint", -1, 1); range(s.gamma, "Gamma", 0.1, 10); break;
    case "sharpen": exact(s, ["kind", "amount", "radius", "threshold"]); range(s.amount, "Sharpen amount", 0, 5); range(s.radius, "Sharpen radius", 0.1, 20); range(s.threshold, "Sharpen threshold", 0, 255); break;
    case "blur": exact(s, ["kind", "sigma"]); range(s.sigma, "Blur sigma", 0.1, 100); break;
    case "alpha": exact(s, ["kind", "mode", "background"]); choice(s.mode, "Alpha mode", ["preserve", "flatten"]); if ((s.mode === "flatten") !== (s.background !== undefined)) throw new DvError("RASTER_INVALID", "Alpha flatten requires background; preserve forbids it."); if (s.background !== undefined) color(s.background); break;
    case "encode": exact(s, ["kind", "format", "quality", "background"]); choice(s.format, "Encode format", ["png", "jpeg", "webp"]); if (s.quality !== undefined) { range(s.quality, "Quality", 1, 100, true); if (s.format === "png") throw new DvError("RASTER_INVALID", "PNG forbids quality."); } if (s.background !== undefined) { color(s.background); if (s.format !== "jpeg") throw new DvError("RASTER_INVALID", "Only JPEG accepts encode background."); } break;
    default: throw new DvError("RASTER_INVALID", `Unknown raster step '${String(s.kind)}'.`);
  }
}
export function validateImageProgram(value: unknown): asserts value is ImageProgram {
  const p = object(value); exact(p, ["orderedSteps"]);
  if (!Array.isArray(p.orderedSteps) || !p.orderedSteps.length) throw new DvError("RASTER_INVALID", "Program requires at least one operation.");
  const steps = p.orderedSteps;
  steps.forEach((step, index) => { validateStep(step); if (step.kind === "encode" && index !== steps.length - 1) throw new DvError("RASTER_INVALID", "Encode must occur once, last."); });
}
