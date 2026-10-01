import test from "node:test";
import assert from "node:assert/strict";
import { fitContent, resolveFrame } from "./math.ts";
import type { FrameEdges, Length } from "./types.ts";

const percent = (value: number): Length => ({ unit: "%", value });
const edges = (left: number, top: number, right: number, bottom: number): FrameEdges => ({ left: percent(left), top: percent(top), right: percent(right), bottom: percent(bottom) });
const frame = { xPx: 10, yPx: 20, widthPx: 100, heightPx: 100 };
const wide = { widthPx: 200, heightPx: 100 };

test("nested frames accumulate parent origin and use right/bottom as edges, not insets", () => {
  const outer = resolveFrame({ xPx: 0, yPx: 0, widthPx: 1000, heightPx: 600 }, edges(10, 20, 90, 80));
  assert.deepEqual(outer, { xPx: 100, yPx: 120, widthPx: 800, heightPx: 360 });
  assert.deepEqual(resolveFrame(outer, edges(25, 0, 75, 100)), { xPx: 300, yPx: 120, widthPx: 400, heightPx: 360 });
  assert.deepEqual(resolveFrame(outer, { left: { unit: "px", value: -10 }, top: percent(0), right: percent(110), bottom: { unit: "px", value: 400 } }), { xPx: 90, yPx: 120, widthPx: 890, heightPx: 400 });
});

test("all content fits preserve their explicit scaling contract", () => {
  assert.deepEqual(fitContent(frame, wide), { xPx: 10, yPx: 45, widthPx: 100, heightPx: 50 });
  assert.deepEqual(fitContent(frame, wide, { mode: "cover" }), { xPx: -40, yPx: 20, widthPx: 200, heightPx: 100 });
  assert.deepEqual(fitContent(frame, wide, { mode: "fit-width" }), { xPx: 10, yPx: 45, widthPx: 100, heightPx: 50 });
  assert.deepEqual(fitContent(frame, wide, { mode: "fit-height" }), { xPx: -40, yPx: 20, widthPx: 200, heightPx: 100 });
  assert.deepEqual(fitContent(frame, wide, { mode: "native" }), { xPx: -40, yPx: 20, widthPx: 200, heightPx: 100 });
  assert.deepEqual(fitContent(frame, wide, { mode: "stretch" }), { xPx: 10, yPx: 20, widthPx: 100, heightPx: 100 });
  assert.deepEqual(fitContent(frame, { widthPx: 20, heightPx: 10 }, { mode: "scale-down" }), { xPx: 50, yPx: 65, widthPx: 20, heightPx: 10 });
  assert.deepEqual(fitContent(frame, wide, { mode: "scale-down" }), { xPx: 10, yPx: 45, widthPx: 100, heightPx: 50 });
});

test("independent anchors and bounded placement work for content larger or smaller than frame", () => {
  assert.deepEqual(fitContent(frame, wide, { frameAnchor: { x: 1, y: 0 }, contentAnchor: { x: 0, y: 1 }, offsetXPx: 3, offsetYPx: -2, limit: "free" }), { xPx: 113, yPx: -32, widthPx: 100, heightPx: 50 });
  assert.deepEqual(fitContent(frame, wide, { offsetXPx: 500, offsetYPx: -500 }), { xPx: 10, yPx: 20, widthPx: 100, heightPx: 50 });
  assert.deepEqual(fitContent(frame, wide, { mode: "cover", offsetXPx: -500 }), { xPx: -90, yPx: 20, widthPx: 200, heightPx: 100 });
  assert.deepEqual(fitContent(frame, wide, { mode: "cover", offsetXPx: 500 }), { xPx: 10, yPx: 20, widthPx: 200, heightPx: 100 });
});

test("invalid and nonfinite geometry is rejected, but out-of-parent coordinates are allowed", () => {
  assert.throws(() => resolveFrame(frame, edges(50, 0, 50, 100)), { code: "SPACE_INVALID" });
  assert.throws(() => resolveFrame(frame, edges(60, 0, 50, 100)), { code: "SPACE_INVALID" });
  assert.throws(() => resolveFrame(frame, edges(0, NaN, 100, 100)), { code: "SPACE_LENGTH" });
  assert.throws(() => fitContent(frame, { widthPx: 0, heightPx: 100 }), { code: "SPACE_EXTENT" });
  assert.throws(() => fitContent(frame, wide, { contentAnchor: { x: 1.1, y: 0 } }), { code: "SPACE_FIT" });
  assert.throws(() => fitContent(frame, wide, { offsetXPx: Infinity }), { code: "SPACE_FIT" });
  assert.throws(() => fitContent({ ...frame, widthPx: Number.MAX_VALUE }, { widthPx: Number.MIN_VALUE, heightPx: 1 }, { mode: "cover" }), { code: "SPACE_INVALID" });
});
