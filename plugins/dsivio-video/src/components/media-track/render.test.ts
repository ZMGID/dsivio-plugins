import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import { ProjectStore } from "../../build/resources.ts";
import { runTool } from "../../tools/index.ts";
import { locateBrowser } from "../../render/browser.ts";
import { captureFrames } from "../../render/frames.ts";
import { mixAudio } from "../../render/audio.ts";
import { compileDocument } from "../../render/document.ts";
import { composeComposition } from "../../render/composition.ts";
import { projectWindow } from "../../timeline/temporal.ts";
import { assembleMediaProgram } from "./program.ts";
import { lowerMediaVisual, lowerMediaAudio } from "./lower.ts";
import { parseMotion } from "./motion.ts";
import type { MediaPlan, Sampling } from "./types.ts";

for (const sourceForm of ["direct", "layers"] as const) {
  test(sourceForm === "direct" ? "sampled video zoom renders through Film without animating the sampled terminal" : "one Layer named content renders its layer-only appearance through Film", async t => {
    try { await locateBrowser("render"); }
    catch (error) { if (error instanceof DvError && error.code === "BROWSER_NOT_PREPARED") { t.skip("Pinned render browser is not prepared."); return; } throw error; }
    const root = await mkdtemp(join(tmpdir(), "dv-media-regression-"));
    const store = new ProjectStore(root), ctx = { buildId: "media-regression", commandKey: "capture", idempotencyKey: "media-regression", workDir: join(root, "work"), projectRoot: root, store, signal: new AbortController().signal, log() {} };
    try {
      const videoPath = join(root, "green.mp4");
      await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x00FF00:s=40x40:r=30", "-frames:v", "12", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
      const resource = await store.putFile(videoPath, "video/mp4"), timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 12, placements: [] };
      const canvas = { canvasKey: "canvas", extent: { widthPx: 160, heightPx: 100 } }, frame = { canvasKey: "canvas", rect: { xPx: 40, yPx: 10, widthPx: 80, heightPx: 80 } };
      const appearance: Record<string, Json> = { "stack-order": 1, fit: "native" };
      const sampling: Sampling[] = sourceForm === "direct" ? [{ at: 0, zoom: 1, x: 0, y: 0, rotate: 0 }, { at: 1, zoom: 2, x: 0, y: 0, rotate: 0 }] : [];
      const plan: MediaPlan = { trackKey: "media", hasAudio: false, groups: [{ id: "item", frameIndex: 0, windowIndex: 0, properties: appearance, motion: parseMotion({}), units: [{ id: "unit", sourceForm, audioGain: 1, properties: appearance, layers: [{ id: "content", kind: "media", sourceIndex: 0, properties: sourceForm === "direct" ? appearance : { fit: "native" }, sampling }] }], handoffs: [], sounds: [] }] };
      const program = assembleMediaProgram(timeline, canvas, plan, { frames: [frame], media: [{ clock: timeline.clock, totalFrames: 12, picture: { resource, extent: { widthPx: 40, heightPx: 40 }, alpha: "opaque" } }], images: [], surfaces: [], extents: [], clips: [], windows: [projectWindow(timeline, { kind: "during", source: "program" }, "item")] });
      const composition = composeComposition("film", canvas, timeline, { background: "#000000" }, [lowerMediaVisual(program)], []);
      const capture = await captureFrames({ input: { kind: "document", document: compileDocument(composition) }, frames: [0, 11] }, ctx);
      const first = await sharp(store.pathOf(capture.frames[0]!.resource)).ensureAlpha().raw().toBuffer(), last = await sharp(store.pathOf(capture.frames[1]!.resource)).ensureAlpha().raw().toBuffer();
      const center = (50 * 160 + 80) * 4, edge = (50 * 160 + 45) * 4;
      assert.ok(first[center + 1]! > 240 && first[center]! < 10, "The fitted source must be visibly green at the center.");
      assert.ok(first[edge]! < 10 && first[edge + 1]! < 10, "Native fit leaves the initial edge black.");
      if (sourceForm === "direct") assert.ok(last[edge + 1]! > 240 && last[edge]! < 10, "Zoom must expand the sampled video into the formerly black edge.");
      else assert.ok(last[edge]! < 10 && last[edge + 1]! < 10, "A content-named Layer keeps native fit instead of acquiring direct-source defaults.");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("Member picture and cut sound retain the same native origin and stretch rate through rendering", async t => {
  try { await locateBrowser("render"); }
  catch (error) { if (error instanceof DvError && error.code === "BROWSER_NOT_PREPARED") { t.skip("Pinned render browser is not prepared."); return; } throw error; }
  const root = await mkdtemp(join(tmpdir(), "dv-media-phase-")), store = new ProjectStore(root);
  const ctx = { buildId: "phase-regression", commandKey: "render", idempotencyKey: "phase-regression", workDir: join(root, "work"), projectRoot: root, store, signal: new AbortController().signal, log() {} };
  try {
    const videoPath = join(root, "frames.mp4"), audioPath = join(root, "levels.wav");
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "nullsrc=s=40x40:r=30,geq=lum='16+N*2':cb=128:cr=128", "-frames:v", "90", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.1+0.002*floor(t*30)|0.1+0.002*floor(t*30):s=48000:d=3", "-c:a", "pcm_s16le", audioPath]);
    const picture = await store.putFile(videoPath, "video/mp4"), sound = await store.putFile(audioPath, "audio/wav");
    const timeline = { axisKey: "phase", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, placements: [] };
    const canvas = { canvasKey: "canvas", extent: { widthPx: 160, heightPx: 100 } }, frame = { canvasKey: "canvas", rect: { xPx: 40, yPx: 10, widthPx: 80, heightPx: 80 } };
    for (const playback of ["once-start", "stretch"] as const) {
      const appearance: Record<string, Json> = { "stack-order": 1, fit: "native", playback };
      const plan: MediaPlan = { trackKey: playback, hasAudio: true, groups: [{ id: "sequence", frameIndex: 0, properties: appearance, motion: parseMotion({}), until: { kind: "at", source: "60f" }, units: [0, 30].map((at, i) => ({ id: `member${i}`, sourceForm: "direct", properties: appearance, audioGain: 1, sourceAudio: "content", instant: { kind: "at", source: `${at}f` }, layers: [{ id: "content", kind: "media", sourceIndex: 0, properties: appearance, sampling: [] }] })), handoffs: [{ id: "swap", from: "member0", operator: "wipe", duration: 10, ratio: .4, direction: "left", audio: "cut" }], sounds: [] }] };
      const program = assembleMediaProgram(timeline, canvas, plan, { frames: [frame], media: [{ clock: timeline.clock, totalFrames: 90, picture: { resource: picture, extent: { widthPx: 40, heightPx: 40 }, alpha: "opaque" }, sound: { resource: sound, totalSamples: 144000 } }], images: [], surfaces: [], extents: [], clips: [], windows: [] });
      const composition = composeComposition(playback, canvas, timeline, { background: "#000000" }, [lowerMediaVisual(program)], [lowerMediaAudio(program)]);
      const capture = await captureFrames({ input: { kind: "document", document: compileDocument(composition) }, frames: [30] }, ctx);
      const expectedPath = join(root, `expected-${playback}.png`);
      await runTool("ffmpeg", ["-v", "error", "-i", videoPath, "-vf", `select=eq(n\\,${playback === "stretch" ? 10 : 4})`, "-frames:v", "1", expectedPath]);
      const actual = await sharp(store.pathOf(capture.frames[0]!.resource)).ensureAlpha().raw().toBuffer(), expected = await sharp(expectedPath).ensureAlpha().raw().toBuffer();
      assert.equal(actual[(50 * 160 + 65) * 4], expected[(20 * 40 + 5) * 4], "The incoming picture must sample its shared pre-boundary source phase.");
      if (playback === "once-start") {
        const mixed = await mixAudio({ domain: composition.domain, tracks: composition.audioTracks, frames: { start: 0, end: 60 } }, ctx);
        const output = await readFile(store.pathOf(mixed.resource)), input = await readFile(audioPath);
        function pcmOffset(wav: Buffer): number { let offset = 12; while (wav.toString("ascii", offset, offset + 4) !== "data") { const length = wav.readUInt32LE(offset + 4); offset += 8 + length + length % 2; } return offset + 8; }
        const actualSample = output.readInt16LE(pcmOffset(output) + (48000 + 16) * 4), expectedSample = input.readInt16LE(pcmOffset(input) + (6400 + 16) * 4);
        assert.ok(Math.abs(actualSample - expectedSample) <= 1, "Cut audio must begin with the picture's fourth source frame, not source frame zero.");
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
