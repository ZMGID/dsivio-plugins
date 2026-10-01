import { DvError } from "../core/errors.ts";
import type { Canvas, Extent, Frame, Path, Point } from "./types.ts";
export function object(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new DvError("TYPE_INVALID", "Expected an object");
  return data as Record<string, unknown>;
}
export function finite(data: unknown, name: string, minimum = -Infinity): number {
  if (typeof data !== "number" || !Number.isFinite(data) || data < minimum) throw new DvError("TYPE_INVALID", `${name} must be finite and at least ${minimum}`);
  return data;
}
export function key(data: unknown): asserts data is string {
  if (typeof data !== "string" || !data.trim()) throw new DvError("TYPE_INVALID", "Identity must be nonempty text");
}
export function exact(data: Record<string, unknown>, names: string[]): void {
  if (Object.keys(data).some(name => !names.includes(name))) throw new DvError("TYPE_INVALID", "Unexpected object field");
}
export function validateExtent(data: unknown): asserts data is Extent {
  const d = object(data); exact(d, ["widthPx", "heightPx"]);
  if (finite(d.widthPx, "widthPx") <= 0 || finite(d.heightPx, "heightPx") <= 0) throw new DvError("TYPE_INVALID", "Extent dimensions must be positive");
}
export function validateCanvas(data: unknown): asserts data is Canvas {
  const d = object(data); exact(d, ["canvasKey", "extent"]); key(d.canvasKey); validateExtent(d.extent);
  if (!Number.isSafeInteger(d.extent.widthPx) || !Number.isSafeInteger(d.extent.heightPx)) throw new DvError("TYPE_INVALID", "Canvas dimensions must be safe integers");
}
export function validateFrame(data: unknown): asserts data is Frame {
  const d = object(data); exact(d, ["canvasKey", "rect"]); key(d.canvasKey); const r = object(d.rect); exact(r, ["xPx", "yPx", "widthPx", "heightPx"]);
  finite(r.xPx, "xPx"); finite(r.yPx, "yPx"); if (finite(r.widthPx, "widthPx") <= 0 || finite(r.heightPx, "heightPx") <= 0) throw new DvError("TYPE_INVALID", "Frame dimensions must be positive");
}
export function validatePoint(data: unknown): asserts data is Point {
  const d = object(data); exact(d, ["canvasKey", "xPx", "yPx", "anchor"]); key(d.canvasKey); finite(d.xPx, "xPx"); finite(d.yPx, "yPx");
  const a = object(d.anchor); exact(a, ["x", "y"]); if (finite(a.x, "anchor.x", 0) > 1 || finite(a.y, "anchor.y", 0) > 1) throw new DvError("TYPE_INVALID", "Anchor must be in [0,1]");
}
export function validatePath(data: unknown): asserts data is Path {
  const d = object(data); exact(d, ["canvasKey", "start", "segments"]); key(d.canvasKey);
  const point = (v: unknown): void => { const p = object(v); exact(p, ["xPx", "yPx"]); finite(p.xPx, "xPx"); finite(p.yPx, "yPx"); }; point(d.start);
  if (!Array.isArray(d.segments) || !d.segments.length) throw new DvError("TYPE_INVALID", "Path requires segments");
  for (const value of d.segments) { const s = object(value); if (!["line", "quadratic", "cubic"].includes(String(s.kind))) throw new DvError("TYPE_INVALID", "Invalid path segment"); exact(s, s.kind === "line" ? ["kind", "to"] : s.kind === "quadratic" ? ["kind", "to", "control"] : ["kind", "to", "control1", "control2"]); point(s.to); if (s.kind === "quadratic") point(s.control); if (s.kind === "cubic") { point(s.control1); point(s.control2); } }
}
