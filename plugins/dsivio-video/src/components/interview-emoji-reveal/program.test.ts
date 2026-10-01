import test from "node:test";
import assert from "node:assert/strict";
import type { Timeline } from "../../timeline/types.ts";
import { projectWindow } from "../../timeline/temporal.ts";
import { resolveProperties } from "../comment-sticker/shared.ts";
import { emojiRules, validateEmojiPlan } from "./validate.ts";
import { assembleEmojiProgram } from "./program.ts";
import { lowerEmojiReveal, EMOJI_REVEAL_SETUP } from "./lower.ts";
const timeline: Timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, placements: [] };
const canvas = { canvasKey: "canvas", extent: { widthPx: 720, heightPx: 1280 } };
const style = { styleKey: "style", properties: resolveProperties({}, emojiRules) };
const image = { $resource: "img", bytes: 100, mime: "image/png" };
const outer = projectWindow(timeline, { kind: "edges", start: "10f", end: "50f" }, "track");
const plan = { trackKey: "track", items: [{ itemKey: "preset", preset: true }, { itemKey: "first", preset: false, at: { kind: "at" as const, source: "20f" as const } }, { itemKey: "second", preset: false, at: { kind: "at" as const, source: "40f" as const } }] };
test("answer switches exactly on activation, bounces on integer frames, and seeks without history", () => {
  const p = assembleEmojiProgram(timeline, canvas, style, outer, image, plan, [image, image, image]); const track = lowerEmojiReveal(p);
  const node = track.presents[0]!.nodes.find(n => n.nodeKey === "first/reveal")!; assert.equal(node.kind, "program"); if (node.kind !== "program") throw new Error("Expected program");
  const placeholder = { style: { visibility: "" } }, answer = { style: { visibility: "", transform: "" } };
  const draw = new Function("root", "data", EMOJI_REVEAL_SETUP)({ parentElement: { querySelector: (selector: string) => selector.includes("placeholder") ? placeholder : answer } }, node.program.data);
  draw(9); assert.equal(placeholder.style.visibility, "visible"); assert.equal(answer.style.visibility, "hidden");
  draw(10); assert.equal(placeholder.style.visibility, "hidden"); assert.equal(answer.style.visibility, "visible"); assert.equal(answer.style.transform, "scale(0.72)");
  draw(12); assert.equal(answer.style.transform, "scale(1.14)"); draw(14); assert.equal(answer.style.transform, "scale(0.95)"); draw(16); assert.equal(answer.style.transform, "scale(1)");
  draw(9); assert.equal(answer.style.visibility, "hidden"); draw(10); assert.equal(answer.style.transform, "scale(0.72)");
});
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
