import { DvError } from "../core/errors.ts";
import type { ContentFit, Extent, FrameEdges, Length, Rect } from "./types.ts";

export function validateRect(rect: Rect): void {
  if (![rect.xPx, rect.yPx, rect.widthPx, rect.heightPx].every(Number.isFinite) || rect.widthPx <= 0 || rect.heightPx <= 0) {
    throw new DvError("SPACE_INVALID", "Rect must have finite coordinates and positive finite dimensions");
  }
}

function lengthPx(length: Length, extent: number): number {
  if (!Number.isFinite(length.value) || (length.unit !== "px" && length.unit !== "%")) throw new DvError("SPACE_LENGTH", "Length requires a finite px or % value");
  return length.unit === "px" ? length.value : extent * length.value / 100;
}

/** right/bottom are edge coordinates relative to the parent's origin, not insets. */
export function resolveFrame(parent: Rect, edges: FrameEdges): Rect {
  validateRect(parent);
  const left = lengthPx(edges.left, parent.widthPx);
  const top = lengthPx(edges.top, parent.heightPx);
  const rect = {
    xPx: parent.xPx + left, yPx: parent.yPx + top,
    widthPx: lengthPx(edges.right, parent.widthPx) - left,
    heightPx: lengthPx(edges.bottom, parent.heightPx) - top,
  };
  validateRect(rect);
  return rect;
}

function bound(value: number, origin: number, spare: number): number {
  return Math.min(Math.max(value, Math.min(origin, origin + spare)), Math.max(origin, origin + spare));
}

/** Returns the placed content rect; caller owns any desired clipping mask. */
export function fitContent(frame: Rect, intrinsic: Extent, fit: ContentFit = {}): Rect {
  validateRect(frame);
  if (!Number.isFinite(intrinsic.widthPx) || !Number.isFinite(intrinsic.heightPx) || intrinsic.widthPx <= 0 || intrinsic.heightPx <= 0) throw new DvError("SPACE_EXTENT", "Intrinsic dimensions must be positive finite numbers");
  const frameAnchor = fit.frameAnchor ?? { x: 0.5, y: 0.5 };
  const contentAnchor = fit.contentAnchor ?? { x: 0.5, y: 0.5 };
  const offsetX = fit.offsetXPx ?? 0;
  const offsetY = fit.offsetYPx ?? 0;
  if (![frameAnchor.x, frameAnchor.y, contentAnchor.x, contentAnchor.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) throw new DvError("SPACE_FIT", "Anchors must be in [0,1] and offsets must be finite");
  if (fit.limit !== undefined && fit.limit !== "bounded" && fit.limit !== "free") throw new DvError("SPACE_FIT", "Fit limit must be bounded or free");
  const sx = frame.widthPx / intrinsic.widthPx;
  const sy = frame.heightPx / intrinsic.heightPx;
  let scaleX: number;
  let scaleY: number;
  switch (fit.mode ?? "contain") {
    case "contain": scaleX = scaleY = Math.min(sx, sy); break;
    case "cover": scaleX = scaleY = Math.max(sx, sy); break;
    case "fit-width": scaleX = scaleY = sx; break;
    case "fit-height": scaleX = scaleY = sy; break;
    case "native": scaleX = scaleY = 1; break;
    case "scale-down": scaleX = scaleY = Math.min(1, sx, sy); break;
    case "stretch": scaleX = sx; scaleY = sy; break;
    default: throw new DvError("SPACE_FIT", "Unknown content fit mode");
  }
  const widthPx = intrinsic.widthPx * scaleX;
  const heightPx = intrinsic.heightPx * scaleY;
  let xPx = frame.xPx + frame.widthPx * frameAnchor.x - widthPx * contentAnchor.x + offsetX;
  let yPx = frame.yPx + frame.heightPx * frameAnchor.y - heightPx * contentAnchor.y + offsetY;
  if ((fit.limit ?? "bounded") === "bounded") {
    xPx = bound(xPx, frame.xPx, frame.widthPx - widthPx);
    yPx = bound(yPx, frame.yPx, frame.heightPx - heightPx);
  }
  const rect = { xPx, yPx, widthPx, heightPx };
  validateRect(rect);
  return rect;
}
