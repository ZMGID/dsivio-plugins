import test from "node:test";
import assert from "node:assert/strict";
import { frameToSample48k } from "./math.ts";

const ntsc = { fps: { numerator: 30_000, denominator: 1001 } };

test("48 kHz boundaries are exact and interval lengths never accumulate per-frame rounding", () => {
  assert.equal(frameToSample48k(0, ntsc), 0);
  assert.equal(frameToSample48k(1, ntsc), 1602);
  assert.equal(frameToSample48k(2, ntsc), 3203);
  assert.equal(frameToSample48k(5, ntsc), 8008);
  assert.equal(frameToSample48k(30_000, ntsc), 48_048_000);
  assert.equal(frameToSample48k(2, ntsc) - frameToSample48k(1, ntsc), 1601);
  assert.equal(frameToSample48k(1, { fps: { numerator: 96_000, denominator: 1 } }), 1);
  assert.equal(frameToSample48k(3, { fps: { numerator: 96_000, denominator: 1 } }), 2);
});

test("large rational intermediates retain half-sample precision and mathematical equivalence", () => {
  const exactHalf = { fps: { numerator: Number.MAX_SAFE_INTEGER - 1, denominator: (Number.MAX_SAFE_INTEGER - 1) / 2 } };
  assert.equal(frameToSample48k(1, exactHalf), 24_000);
  assert.equal(frameToSample48k(99, { fps: { numerator: 60, denominator: 2 } }), 158_400);
  assert.equal(frameToSample48k(Number.MAX_SAFE_INTEGER, { fps: { numerator: 48_000, denominator: 1 } }), Number.MAX_SAFE_INTEGER);
  // Floating multiplication rounds this boundary up by one sample before division.
  assert.equal(frameToSample48k(9_007_199_254_740_990, { fps: { numerator: 48_001, denominator: 1 } }), 9_007_011_608_665_809);
});

test("invalid boundaries, clocks and unsafe output fail instead of losing precision", () => {
  for (const frame of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => frameToSample48k(frame, ntsc), { code: "FRAME_INVALID" });
  for (const fps of [{ numerator: 0, denominator: 1 }, { numerator: 30, denominator: 0 }, { numerator: 29.97, denominator: 1 }, { numerator: 30, denominator: Infinity }, { numerator: Number.MAX_SAFE_INTEGER + 1, denominator: 1 }]) assert.throws(() => frameToSample48k(1, { fps }), { code: "CLOCK_INVALID" });
  assert.throws(() => frameToSample48k(Number.MAX_SAFE_INTEGER, ntsc), { code: "SAMPLE_OVERFLOW" });
});
