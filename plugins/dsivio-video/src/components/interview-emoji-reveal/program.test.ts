import test from "node:test";
import assert from "node:assert/strict";
import type { Timeline } from "../../timeline/types.ts";
import { projectWindow } from "../../timeline/temporal.ts";
import { resolveProperties } from "../comment-sticker/shared.ts";
import { emojiRules, validateEmojiPlan } from "./validate.ts";
import { assembleEmojiProgram } from "./program.ts";
import { lowerEmojiReveal } from "./lower.ts";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { DvError } from "../../core/errors.ts";
import { locateBrowser } from "../../render/browser.ts";
import { compileDocument } from "../../render/document.ts";
import { composeComposition } from "../../render/composition.ts";
const timeline: Timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, placements: [] };
const canvas = { canvasKey: "canvas", extent: { widthPx: 720, heightPx: 1280 } };
const style = { styleKey: "style", properties: resolveProperties({}, emojiRules) };
const image = { $resource: "img", bytes: 100, mime: "image/png" };
const outer = projectWindow(timeline, { kind: "edges", start: "10f", end: "50f" }, "track");
const plan = { trackKey: "track", items: [{ itemKey: "preset", preset: true }, { itemKey: "first", preset: false, at: { kind: "at" as const, source: "20f" as const } }, { itemKey: "second", preset: false, at: { kind: "at" as const, source: "40f" as const } }] };
test("preset ordering, times, image bytes and Canvas bounds are enforced without sorting or scaling", () => {
  assert.throws(() => validateEmojiPlan({ ...plan, items: [...plan.items, { itemKey: "late", preset: true }] }), { code: "EMOJI_PRESET" });
  assert.throws(() => validateEmojiPlan({ ...plan, items: [{ itemKey: "bad", preset: false }] }), { code: "TYPE_INVALID" });
  assert.throws(() => assembleEmojiProgram(timeline, canvas, style, outer, image, { ...plan, items: [plan.items[0]!, plan.items[2]!, plan.items[1]!] }, [image, image, image]), { code: "EMOJI_ORDER" });
  assert.throws(() => assembleEmojiProgram(timeline, canvas, style, outer, { ...image, bytes: 0 }, plan, [image, image, image]), { code: "STICKER_IMAGE" });
  assert.throws(() => assembleEmojiProgram(timeline, { ...canvas, extent: { widthPx: 200, heightPx: 200 } }, style, outer, image, plan, [image, image, image]), { code: "EMOJI_LAYOUT" });
  assert.throws(() => assembleEmojiProgram(timeline, canvas, style, outer, image, { ...plan, items: [{ itemKey: "at-end", preset: false, at: { kind: "at", source: "50f" } }] }, [image]), { code: "EMOJI_ORDER" });
});
test("one-frame reveal preserves 0.72 activation pose and settles without duplicate stage boundaries", () => {
  const p = assembleEmojiProgram(timeline, canvas, { ...style, properties: { ...style.properties, "reveal-frames": 1 } }, outer, image, { ...plan, items: [{ itemKey: "last", preset: false, at: { kind: "at", source: "49f" } }] }, [image]);
  const node = lowerEmojiReveal(p).presents[0]!.nodes.find(n => n.nodeKey === "last/reveal")!; if (node.kind !== "program") throw new Error("Expected program");
  assert.deepEqual(node.program.data, { activation: 39, points: [{ frame: 39, scale: 0.72 }, { frame: 40, scale: 1 }] });
});
test("real answers inherit the Present lifetime and retain padding coordinates across border widths", async t => {
  let browserLocation;
  try { browserLocation = await locateBrowser("render"); }
  catch (error) { if (error instanceof DvError && error.code === "BROWSER_NOT_PREPARED") { t.skip("Requires explicit setup browser --kind render"); return; } throw error; }
  const browser = await puppeteer.launch({ executablePath: browserLocation.path, headless: true, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const iconBytes = await sharp({ create: { width: 48, height: 48, channels: 4, background: "#ff0000" } }).png().toBuffer();
  const placeholderBytes = await sharp({ create: { width: 48, height: 48, channels: 4, background: "#0000ff" } }).png().toBuffer();
  const icon = { $resource: "answer", bytes: iconBytes.length, mime: "image/png" };
  const placeholder = { $resource: "placeholder", bytes: placeholderBytes.length, mime: "image/png" };
  async function pageFor(borderWidth: number) {
    const browserStyle = { ...style, properties: { ...style.properties, "top-y": 0.2, "border-width": borderWidth, radius: 0 } };
    const p = assembleEmojiProgram(timeline, canvas, browserStyle, outer, placeholder, { ...plan, items: plan.items.slice(0, 2) }, [icon, icon]);
    const document = compileDocument(composeComposition("emoji-proof", canvas, timeline, { background: "#102030" }, [lowerEmojiReveal(p)], []));
    const html = document.html.replaceAll("dv-resource://answer", `data:image/png;base64,${iconBytes.toString("base64")}`).replaceAll("dv-resource://placeholder", `data:image/png;base64,${placeholderBytes.toString("base64")}`);
    const page = await browser.newPage();
    await page.setViewport({ width: 720, height: 1280 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate("window.__dvReady");
    return page;
  }
  await t.test("hidden before start and at exclusive end, exact activation and reverse-seek bounce", async () => {
    const page = await pageFor(12);
    try {
      await page.evaluate("window.__dvSeekFrame(9)");
      const before = await page.screenshot();
      assert.equal(await page.evaluate("Array.from(document.querySelectorAll('[data-emoji]')).every(el=>getComputedStyle(el).visibility==='hidden')"), true);
      await page.evaluate("window.__dvSeekFrame(10)");
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dv-node=\"preset/answer\"]')).visibility"), "visible");
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dv-node=\"first/placeholder\"]')).visibility"), "visible");
      for (const [frame, scale] of [[20, 0.72], [22, 1.14], [24, 0.95], [26, 1]] as const) {
        await page.evaluate(`window.__dvSeekFrame(${frame})`);
        assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dv-node=\"first/placeholder\"]')).visibility"), "hidden");
        assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dv-node=\"first/answer\"]')).visibility"), "visible");
        const width = await page.evaluate("document.querySelector('[data-dv-node=\"first/answer\"]').getBoundingClientRect().width");
        assert.ok(typeof width === "number");
        assert.ok(Math.abs(width - 48 * scale) < 0.01);
      }
      await page.evaluate("window.__dvSeekFrame(50)");
      assert.equal(await page.evaluate("Array.from(document.querySelectorAll('[data-emoji]')).every(el=>getComputedStyle(el).visibility==='hidden')"), true);
      assert.deepEqual(await page.screenshot(), before);
      await page.evaluate("window.__dvSeekFrame(19)");
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dv-node=\"first/placeholder\"]')).visibility"), "visible");
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dv-node=\"first/answer\"]')).visibility"), "hidden");
    } finally { await page.close(); }
  });
  await t.test("border decoration never shifts either icon or placeholder", async () => {
    for (const borderWidth of [0, 12]) {
      const page = await pageFor(borderWidth);
      try {
        await page.evaluate("window.__dvSeekFrame(10)");
        const bounds = await page.evaluate("Array.from(document.querySelectorAll('[data-emoji]')).filter(el=>getComputedStyle(el).visibility==='visible').map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})");
        assert.deepEqual(bounds, [[295, 282, 48, 48], [377, 282, 48, 48]]);
      } finally { await page.close(); }
    }
  });
});
