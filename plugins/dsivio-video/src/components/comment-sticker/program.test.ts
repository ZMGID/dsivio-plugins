import test from "node:test";
import assert from "node:assert/strict";
import { projectWindow } from "../../timeline/temporal.ts";
import { resolveProperties } from "./shared.ts";
import { stickerRules } from "./validate.ts";
import { lowerStickers, STICKER_MOTION_SETUP } from "./lower.ts";
import { assembleStickerProgram } from "./program.ts";
import type { StickerStyle } from "./types.ts";
import type { Timeline } from "../../timeline/types.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { DvError } from "../../core/errors.ts";
import { ProjectStore } from "../../build/resources.ts";
import { localCapabilities } from "../../fonts/capabilities.ts";
import { validateFontFace } from "../../fonts/validate.ts";
import { locateBrowser } from "../../render/browser.ts";
import { compileDocument } from "../../render/document.ts";
import { composeComposition } from "../../render/composition.ts";
const timeline: Timeline = { axisKey: "a", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 120, placements: [] };
const canvas = { canvasKey: "c", extent: { widthPx: 720, heightPx: 1280 } };
const style: StickerStyle = { styleKey: "s", properties: resolveProperties({}, stickerRules), fonts: { stackKey: "fonts", faces: [700, 900].map(weight => ({ faceKey: `inter-${weight}`, family: "inter", weight, style: "normal" as const, shards: [{ resource: { $resource: `font-${weight}`, bytes: 100, mime: "font/woff2" }, unicodeRange: "U+0-10FFFF" }], license: { spdx: "OFL-1.1", notice: { $resource: "license", bytes: 100, mime: "text/plain" } } })) } };
function program(author?: string) {
  return assembleStickerProgram("track", timeline, canvas, [{ itemKey: "item", comment: "A thoughtful comment that wraps across the fixed body area.", ...(author ? { author } : {}) }], [{ canvasKey: "c", rect: { xPx: 40, yPx: 500, widthPx: 640, heightPx: 280 } }], [projectWindow(timeline, { kind: "during", source: "program" }, "item")], [style]);
}
test("avatar initial reserves one column; default none reclaims it; header and exact fonts remain observable", () => {
  const p = program("@alex"); const plain = lowerStickers(p).presents[0]!;
  const initial = lowerStickers({ ...p, stickers: p.stickers.map(item => ({ ...item, style: { ...style, properties: { ...style.properties, "avatar-fallback": "initial" } } })) }).presents[0]!;
  const body = plain.nodes.find(node => node.nodeKey.endsWith("/body"))!; const shifted = initial.nodes.find(node => node.nodeKey.endsWith("/body"))!;
  assert.equal(body.style.find(d => d.property === "left")!.value, "29px"); assert.equal(shifted.style.find(d => d.property === "left")!.value, "105px");
  const header = initial.nodes.find(node => node.nodeKey.endsWith("/header"))!; assert.equal(header.kind, "text-flow"); if (header.kind !== "text-flow" || body.kind !== "text-flow") throw new Error("Expected TextFlow");
  assert.equal(header.flow.paragraphs[0]!.runs[0]!.kind, "run"); assert.equal(header.flow.format.fonts.faces[0]!.weight, 700); assert.equal(body.flow.format.fonts.faces[0]!.weight, 900); assert.equal(body.flow.layout.maxLines, 3); assert.equal(body.flow.layout.overflow, "ellipsis");
  const avatar = initial.nodes.find(node => node.nodeKey.endsWith("/initial"))!; assert.equal(avatar.kind, "text"); if (avatar.kind === "text") assert.equal(avatar.text, "A");
});
test("layout and recipe errors never silently shrink or invent comment content", () => {
  assert.throws(() => resolveProperties({ unknown: 1 }, stickerRules), { code: "STICKER_RECIPE" });
  assert.throws(() => resolveProperties({ "body-size": 0 }, stickerRules), { code: "TYPE_INVALID" });
  const p = program(); assert.throws(() => lowerStickers({ ...p, stickers: p.stickers.map(item => ({ ...item, frame: { ...item.frame, rect: { ...item.frame.rect, heightPx: 100 } } })) }), { code: "STICKER_TOO_SHORT" });
  assert.throws(() => assembleStickerProgram("t", timeline, canvas, [{ itemKey: "i", comment: " " }], [], [], []), { code: "STICKER_INPUT" });
});
test("pop, hold and exit are deterministic under out-of-order seeks and short windows", () => {
  const target = { style: { opacity: "", transform: "" } }; const draw = new Function("root", "data", STICKER_MOTION_SETUP)({ parentElement: target }, { properties: style.properties, frames: 120 });
  draw(0); assert.equal(target.style.opacity, "0"); assert.match(target.style.transform, /scale\(0.78\)/);
  draw(50); const middle = { ...target.style }; draw(119); assert.ok(Number(target.style.opacity) < 0.1); draw(50); assert.deepEqual(target.style, middle);
  const short = new Function("root", "data", STICKER_MOTION_SETUP)({ parentElement: target }, { properties: style.properties, frames: 3 }); short(1); assert.ok(Number.isFinite(Number(target.style.opacity))); assert.doesNotMatch(target.style.transform, /NaN|Infinity/);
});
test("disabled entry reserves no frames before a short-window exit", () => {
  const properties = resolveProperties({ enter: "none", exit: "fade-up", "exit-frames": 5, "exit-easing": "linear", hold: "none" }, stickerRules);
  const target = { style: { opacity: "", transform: "" } };
  const draw = new Function("root", "data", STICKER_MOTION_SETUP)({ parentElement: target }, { properties, frames: 10 });
  draw(0); assert.equal(Number(target.style.opacity), 1);
  draw(5); assert.equal(Number(target.style.opacity), 1);
  draw(9); assert.ok(Math.abs(Number(target.style.opacity) - 0.2) < 1e-12); assert.ok(Math.abs(Number(/translateY\(([^p]+)px\)/.exec(target.style.transform)![1]) + 22.4) < 1e-12);
  draw(0); assert.equal(Number(target.style.opacity), 1);
});
test("disabled entry and exit allow hold motion over the whole short window", () => {
  const properties = resolveProperties({ enter: "none", exit: "none", hold: "float", "hold-period-frames": 4, "hold-amplitude-y": 4, "hold-rotation-amplitude": 0 }, stickerRules);
  const target = { style: { opacity: "", transform: "" } };
  const draw = new Function("root", "data", STICKER_MOTION_SETUP)({ parentElement: target }, { properties, frames: 10 });
  draw(1); assert.equal(target.style.opacity, "1"); assert.match(target.style.transform, /translateY\(4px\)/);
  draw(3); assert.match(target.style.transform, /translateY\(-4px\)/);
  draw(1); assert.match(target.style.transform, /translateY\(4px\)/);
});
test("real short card exits despite disabled entry's default frame count", async t => {
  let location;
  try { location = await locateBrowser("render"); }
  catch (error) { if (error instanceof DvError && error.code === "BROWSER_NOT_PREPARED") { t.skip("Requires explicit setup browser --kind render"); return; } throw error; }
  const directory = await mkdtemp(join(tmpdir(), "dv-sticker-motion-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ProjectStore(directory), executor = localCapabilities[0]!.executor;
  if (executor.kind !== "immediate") throw new DvError("STICKER_TEST", "Expected immediate font executor.");
  let faceData;
  try {
    const value = await executor.run({ faceKey: "motion-inter", family: "inter", weight: 700, style: "normal" }, { projectRoot: directory, buildId: "test", commandKey: "font", idempotencyKey: "font", workDir: directory, store, signal: new AbortController().signal, log() {} });
    faceData = value.data; validateFontFace(faceData);
  } catch (error) { if (error instanceof DvError && error.code === "FONT_NOT_PREPARED") { t.skip("Requires explicit setup fonts"); return; } throw error; }
  const source = program("@alex");
  const properties = resolveProperties({ enter: "none", exit: "fade-up", "exit-frames": 5, "exit-easing": "linear", hold: "none" }, stickerRules);
  const p = { ...source, stickers: source.stickers.map(item => ({ ...item, window: projectWindow(timeline, { kind: "at", source: "0f", duration: "10f" }, item.itemKey), style: { ...style, properties, fonts: { stackKey: "motion-fonts", faces: [faceData] } } })) };
  const document = compileDocument(composeComposition("motion-proof", canvas, timeline, { background: "#102030" }, [lowerStickers(p)], []));
  let html = document.html;
  for (const usage of document.resources) html = html.replaceAll(`dv-resource://${usage.resource.$resource}`, `data:${usage.resource.mime};base64,${(await readFile(store.pathOf(usage.resource))).toString("base64")}`);
  const browser = await puppeteer.launch({ executablePath: location.path, headless: true, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage(); await page.setViewport({ width: 720, height: 1280 }); await page.setContent(html, { waitUntil: "load" }); await page.evaluate("window.__dvReady");
  await page.evaluate("window.__dvSeekFrame(0)");
  assert.equal(await page.evaluate("Number(getComputedStyle(document.querySelector('[data-dv-node=\"item\"]')).opacity)"), 1);
  await page.evaluate("window.__dvSeekFrame(9)");
  const endPose = await page.evaluate("(()=>{const s=getComputedStyle(document.querySelector('[data-dv-node=\"item\"]'));return [Number(s.opacity),new DOMMatrix(s.transform).m42]})()");
  assert.ok(Array.isArray(endPose));
  assert.ok(Math.abs(endPose[0] - 0.2) < 1e-6); assert.ok(Math.abs(endPose[1] + 22.4) < 1e-6);
  await page.evaluate("window.__dvSeekFrame(10)");
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dv-node=\"item\"]')).visibility"), "hidden");
  await page.evaluate("window.__dvSeekFrame(0)");
  assert.equal(await page.evaluate("Number(getComputedStyle(document.querySelector('[data-dv-node=\"item\"]')).opacity)"), 1);
});
