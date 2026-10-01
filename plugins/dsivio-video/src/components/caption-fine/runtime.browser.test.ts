import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import { ProjectStore } from "../../build/resources.ts";
import { localCapabilities as fontCapabilities } from "../../fonts/capabilities.ts";
import { validateFontFace } from "../../fonts/validate.ts";
import { locateBrowser } from "../../render/browser.ts";
import { composeComposition } from "../../render/composition.ts";
import { compileDocument } from "../../render/document.ts";
import { captureFrames } from "../../render/frames.ts";
import type { ExecuteContext } from "../../core/capability.ts";
import type { FontFace } from "../../fonts/types.ts";
import type { FineProgram } from "./types.ts";
import { createFineStyle } from "./style.ts";
import { lowerFine } from "./lower.ts";
import { projectWindow } from "../../timeline/temporal.ts";
let prepared = true;
try { await locateBrowser("render"); } catch (cause) { if (!(cause instanceof DvError) || cause.code !== "BROWSER_NOT_PREPARED") throw cause; prepared = false; }
const skip = !prepared && "Run setup browser --kind render for caption browser regressions";
async function fixture(root: string): Promise<{ ctx: ExecuteContext; face: FontFace }> {
 const store = new ProjectStore(root), ctx: ExecuteContext = { buildId: "caption-test", commandKey: "caption-test", idempotencyKey: "caption-test", projectRoot: root, workDir: join(root, "work"), store, signal: new AbortController().signal, log() {} };
 const font = fontCapabilities[0]!; if (font.executor?.kind !== "immediate") throw new Error("Expected exact local font executor");
 const value = await font.executor.run({ faceKey: "caption-test", family: "inter", weight: 700, style: "normal" }, ctx); validateFontFace(value.data); return { ctx, face: value.data };
}
function program(face: FontFace, extra: Record<string, Json>, text = "CAPTIONS"): FineProgram {
 const timeline = { axisKey: "caption-axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, placements: [] };
 const style = createFineStyle("caption-style", { rule: "caption.test", properties: { "stack-order": 0, x: .1, y: .25, width: .8, align: "left", size: 24, "line-height": 1.2, background: "#00000000", padding: "0", radius: 0, fill: "#FFFFFF", ...extra } }, face);
 return { trackKey: "captions", timeline, content: { axisKey: timeline.axisKey, storyKey: "story", cues: [{ cueKey: "cue", turnKey: "turn", segmentKey: "segment", frames: { start: 0, end: 60 }, units: [{ unitKey: "unit", text, separator: "", tokenBounds: { start: 0, end: 1 }, attributes: {}, frames: { start: 0, end: 60 } }] }] }, uses: [{ useKey: "use", window: projectWindow(timeline, { kind: "during", source: "program" }, "use"), style }] };
}
async function bounds(p: FineProgram, frames: number[], ctx: ExecuteContext): Promise<{ left: number; top: number; right: number; bottom: number }[]> {
 const document = compileDocument(composeComposition("caption-proof", { canvasKey: "canvas", extent: { widthPx: 240, heightPx: 240 } }, p.timeline, { background: "#000000" }, [lowerFine(p)], []));
 const captured = await captureFrames({ input: { kind: "document", document }, frames }, ctx);
 const result = [];
 for (const frame of captured.frames) {
  const { data, info } = await sharp(ctx.store.pathOf(frame.resource)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const index = (y * info.width + x) * info.channels; if (Math.max(data[index]!, data[index + 1]!, data[index + 2]!) > 100) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); } }
  result.push({ left, top, right, bottom });
 }
 return result;
}
test("Cue and active-atom loops and active responses compose real transforms without a none sentinel", { skip }, async () => {
 const root = await mkdtemp(join(tmpdir(), "dv-caption-motion-"));
 try {
  const { ctx, face } = await fixture(root);
  for (const target of ["cue", "active-atom"]) {
   const [still, floating] = await bounds(program(face, { loop: "float", "loop-target": target, "loop-period-frames": 12 }), [0, 3], ctx);
   assert.equal(floating!.top, still!.top - 4); assert.equal(floating!.bottom, still!.bottom - 4); assert.equal(floating!.left, still!.left);
  }
  const baseline = (await bounds(program(face, {}), [3], ctx))[0]!;
  const response = (await bounds(program(face, { "active-response": "scale", "active-response-frames": 6, "active-scale": 2 }), [3], ctx))[0]!;
  assert.ok(response.right - response.left > baseline.right - baseline.left, "active response must actually enlarge painted glyphs");
 } finally { await rm(root, { recursive: true, force: true }); }
});
test("Completed entrance wipes do not mask Cue or active-box exit wipes", { skip }, async () => {
 const root = await mkdtemp(join(tmpdir(), "dv-caption-wipe-"));
 try {
  const { ctx, face } = await fixture(root);
  for (const extra of [{ "cue-enter": "wipe-left", "cue-enter-frames": 6, "cue-exit": "wipe-right", "cue-exit-frames": 12 }, { fill: "#000000", "active-box": "current", "active-box-background": "#FFFFFF", "active-box-enter": "wipe-left", "active-box-exit": "wipe-right", "active-box-transition-frames": 12, "active-box-radius": 0 }] as Record<string, Json>[]) {
   const [whole, exiting] = await bounds(program(face, extra), [20, 54], ctx);
   assert.ok(exiting!.left > whole!.left + 20, "exit wipe must remove the left portion after the entrance has completed"); assert.equal(exiting!.right, whole!.right);
  }
 } finally { await rm(root, { recursive: true, force: true }); }
});
test("Grapheme captions wrap a measured unit internally and joined boxes follow its line fragments", { skip }, async () => {
 const root = await mkdtemp(join(tmpdir(), "dv-caption-wrap-"));
 try {
  const { ctx, face } = await fixture(root);
  const [word] = await bounds(program(face, { width: .25, wrap: "word" }, "CAPTIONING"), [30], ctx);
  const [wrapped] = await bounds(program(face, { width: .25, wrap: "grapheme", "active-box": "current", "active-box-continuity": "joined", "active-box-background": "#FFFFFF", "active-box-radius": 0 }, "CAPTIONING"), [30], ctx);
  assert.ok(wrapped!.bottom - wrapped!.top > word!.bottom - word!.top + 25, "one aligned unit must occupy multiple measured lines");
  assert.ok(wrapped!.right - wrapped!.left <= 60, "painted glyphs and joined background must stay inside the narrow caption width");
 } finally { await rm(root, { recursive: true, force: true }); }
});
