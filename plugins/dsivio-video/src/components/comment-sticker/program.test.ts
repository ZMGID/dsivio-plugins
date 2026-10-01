import test from "node:test";
import assert from "node:assert/strict";
import { projectWindow } from "../../timeline/temporal.ts";
import { resolveProperties } from "./shared.ts";
import { stickerRules } from "./validate.ts";
import { lowerStickers, STICKER_MOTION_SETUP } from "./lower.ts";
import { assembleStickerProgram } from "./program.ts";
import type { StickerStyle } from "./types.ts";
import type { Timeline } from "../../timeline/types.ts";
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
