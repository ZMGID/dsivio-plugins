import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import sharp from "sharp";
import { runTool } from "../tools/index.ts";
import { mediaFrames } from "./frames.ts";
import { mediaTile, mediaTiles } from "./grid.ts";
import { validateTranscript } from "./transcript.ts";

let dir: string;
let clip: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "dv-frames-test-"));
  clip = join(dir, "testsrc.mp4");
  await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=4:duration=6", "-pix_fmt", "yuv420p", clip]);
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test("sampled extraction chooses first PTS >= requested, including after seek", async () => {
  const report = await mediaFrames(clip, { to: join(dir, "exact"), at: "0,0.251,3.125" });
  assert.deepEqual(report.items.map(item => [item.wantedSec, item.observedSec]), [[0, 0], [0.251, 0.5], [3.125, 3.25]]);
  assert.deepEqual(report.items.map(item => basename(item.filePath)), ["frame-0_000s.jpg", "frame-0_251s.jpg", "frame-3_125s.jpg"]);
  await assert.rejects(mediaFrames(clip, { to: join(dir, "tail"), at: "5.9" }), /No frame at or after/);
  assert.equal((await readdir(dir)).includes("tail"), false);
});
test("every sampling and raw half-open frames have different observable clocks and counts", async () => {
  const sampled = await mediaFrames(clip, { to: join(dir, "every"), every: "0.4", start: "0.1", end: "1.01" });
  assert.deepEqual(sampled.items.map(item => [item.wantedSec, item.observedSec]), [[0.1, 0.25], [0.5, 0.5], [0.9, 1]]);
  const raw = await mediaFrames(clip, { to: join(dir, "raw"), everyFrame: true, start: "0.1", end: "1.01", labelTime: true });
  assert.deepEqual(raw.items.map(item => item.observedSec), [0.25, 0.5, 0.75, 1]);
  assert.equal("timeLabelled" in raw, false);
  assert.equal(raw.items.some(item => "wantedSec" in item), false);
  assert.deepEqual(raw.items.map(item => basename(item.filePath)), ["frame-000000000.jpg", "frame-000000001.jpg", "frame-000000002.jpg", "frame-000000003.jpg"]);
  const metadata = await sharp(raw.items[0]!.filePath).metadata();
  assert.equal(metadata.width, 336);
  assert.ok(metadata.height! > 180);
});
test("default grids, transcript labels and time bitmap preserve image shape", async () => {
  const defaultGrid = await mediaTile(clip, { to: join(dir, "default.png") });
  assert.equal(defaultGrid.requestedTimes.length, 9);
  assert.equal(defaultGrid.usedRows, 3);
  const transcript = validateTranscript({ format: "dsivio-video.transcript/1", source: clip, durationSec: 6, language: "zh", engine: "fixture", blocks: [{ text: "你好 世界", tokens: [{ text: "你好", startSec: 0, endSec: 0.5 }, { text: "<世界&>", startSec: 0.5, endSec: 1 }] }] });
  const basic = await mediaTile(clip, { to: join(dir, "basic.png"), at: "0.251", columns: "1" });
  const labelled = await mediaTile(clip, { to: join(dir, "transcript.png"), at: "0.251", columns: "1", transcript });
  assert.deepEqual(labelled.items[0]!.activeTokens?.map(token => token.text), ["<世界&>"]);
  const basicSize = await sharp(basic.outputPath).metadata();
  const labelSize = await sharp(labelled.outputPath).metadata();
  assert.equal(labelSize.width, 336);
  assert.ok(labelSize.height! > basicSize.height!);
  const bitmap = await mediaFrames(clip, { to: join(dir, "bitmap"), at: "0.25", labelTime: true });
  const bitmapSize = await sharp(bitmap.items[0]!.filePath).metadata();
  assert.equal(bitmapSize.width, 320);
  assert.equal(bitmapSize.height, 180);
  const labelledFrames = await mediaFrames(clip, { to: join(dir, "labelled-frames"), at: "0.251", transcript });
  assert.equal((await sharp(labelledFrames.items[0]!.filePath).metadata()).height, labelSize.height);
  await assert.rejects(mediaTile(clip, { to: basic.outputPath, frames: "2" }), /already exists/);
  await assert.rejects(mediaFrames(clip, { to: join(dir, "bitmap"), at: "0" }), /already exists/);
});
test("ranges paginate independently and raw pages always include page numbers", async () => {
  const ranges = join(dir, "ranges.json");
  await writeFile(ranges, JSON.stringify([{ start: 0, end: 2, id: "intro", frames: 5 }, { start: 2, end: 3, every: 0.5 }]));
  const report = await mediaTiles(clip, { to: join(dir, "pages"), ranges, columns: "2", rows: "1" });
  assert.deepEqual(report.pages.map(page => basename(page.outputPath)), ["001-intro-p001.jpg", "001-intro-p002.jpg", "001-intro-p003.jpg", "002-2_000s-3_000s.jpg"]);
  assert.deepEqual(report.pages.map(page => page.requestedTimes), [[0.2, 0.6], [1, 1.4], [1.8], [2, 2.5]]);
  const last = await sharp(report.pages[2]!.outputPath).metadata();
  assert.equal(last.width, 664);
  const raw = await mediaTiles(clip, { to: join(dir, "raw-pages"), everyFrame: true, start: "0", end: "1", columns: "2", rows: "1" });
  assert.deepEqual(raw.pages.map(page => basename(page.outputPath)), ["001-frames-p001.jpg", "001-frames-p002.jpg"]);
  assert.deepEqual(raw.pages.map(page => page.items.map(item => item.observedSec)), [[0, 0.25], [0.5, 0.75]]);
  assert.equal("gridColumns" in raw, false);
  assert.equal(raw.pages.some(page => "requestedTimes" in page || "startSec" in page), false);
  await assert.rejects(mediaTiles(clip, { to: join(dir, "pages"), frames: "2" }), /already exists/);
});
