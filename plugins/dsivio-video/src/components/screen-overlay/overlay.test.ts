import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthor } from "../../elaborate/compile.ts";
import type { AuthorRegistry } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import overlay from "../../modules/screen-overlay/index.ts";
import space from "../../modules/space/index.ts";
import time from "../../modules/time/index.ts";
import program from "../../modules/program/index.ts";
import visual from "../../modules/visual/index.ts";
import type { Canvas } from "../../space/types.ts";
import type { Timeline } from "../../timeline/types.ts";
import { projectWindow } from "../../timeline/temporal.ts";
import { lowerOverlay } from "./lower.ts";
import { assembleOverlayProgram } from "./program.ts";
import { parseOverlayOptions, validateOverlayProgram } from "./validate.ts";
import type { OverlayAuthorPlan } from "./types.ts";
import { createBokehGeometry } from "./runtime.ts";

const canvas: Canvas = { canvasKey: "canvas", extent: { widthPx: 640, heightPx: 360 } };
const timeline: Timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, placements: [] };
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "dv-overlay-author-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const modules = [overlay, space, time, program, visual];
  const registry: AuthorRegistry = {
    findModule: id => modules.find(module => module.id === id),
    findProducer: ref => { const hash = ref.lastIndexOf("#"); return modules.find(module => module.id === ref.slice(0, hash))?.producers[ref.slice(hash + 1)]; },
    findFrontend: using => modules.map(module => module.frontends?.[using]).find(Boolean),
  };
  const imports = modules.map(module => `<import as="${module.id.split("/").at(-1)!.split("@")[0]}" from="${module.id}"/>`).join("");
  return (body: string) => {
    const file = join(dir, "main.dvml");
    writeFileSync(file, `<?dvml using="dsivio-video/markup@1"?><dvml>${imports}<program:Clock id="clock" frame-rate="30"/><time:Timeline id="timeline" clock={clock} end="60f"/><space:Canvas id="canvas" width="640" height="360"/>${body}</dvml>`);
    return compileAuthor(file, Workspace.open({ cwd: dir }), registry);
  };
}
const wash = '<screen-overlay:ColorWash z="-2" color="#12345678" opacity="0.5" during="program"/>';
const track = (children: string) => `<screen-overlay:Track id="overlay" canvas={canvas} timeline={timeline}>${children}</screen-overlay:Track>`;

test("author effects reject missing windows, defaults, unknown attributes and nonempty bodies", t => {
  const compile = fixture(t);
  assert.throws(() => compile(track("")), { code: "OVERLAY_EMPTY" });
  assert.throws(() => compile(track(wash.replace(' during="program"', ""))), { code: "OVERLAY_WINDOW" });
  assert.throws(() => compile(track(wash.replace(' opacity="0.5"', ""))), { code: "TRACK_ATTRIBUTE" });
  assert.throws(() => compile(track(wash.replace(' z="-2"', ' z="1.5"'))), { code: "TYPE_INVALID" });
  assert.throws(() => compile(track(wash.replace('/>', ' frame={canvas}/>'))), { code: "TRACK_ATTRIBUTE" });
  assert.throws(() => compile(track(wash.replace('/>', '>text</screen-overlay:ColorWash>'))), { code: "TRACK_CHILD" });
  assert.throws(() => compile(track(wash.replace('color="#12345678"', 'color="#fff"'))), { code: "OVERLAY_COLOR" });
  assert.throws(() => compile(track(wash.replace('opacity="0.5"', 'opacity="1.1"'))), { code: "TYPE_INVALID" });
});

test("effect ids are track-scoped, derived ids are stable and explicit duplicates fail", t => {
  const compile = fixture(t);
  assert.throws(() => compile(track(wash.replace(' z=', ' id="same" z=') + wash.replace(' z=', ' id="same" z='))), { code: "OVERLAY_DUPLICATE" });
  const graph = compile(track(wash + wash));
  const plan = [...graph.records.values()].find(record => record.value.type.endsWith("#AuthorPlan"))!.value.data as unknown as OverlayAuthorPlan;
  assert.notEqual(plan.effects[0]!.effectKey, plan.effects[1]!.effectKey);
});

test("field constraints preserve physical boundaries and all mandatory seeded parameters", () => {
  assert.throws(() => parseOverlayOptions("ScanLines", { spacing: "5", thickness: "6", angle: "0", opacity: "1", travel: "0" }), { code: "OVERLAY_ATTRIBUTE" });
  assert.throws(() => parseOverlayOptions("Bokeh", { amount: "1", "min-size": "10", "max-size": "9", color: "#ffffff", warmth: "0", drift: "0", seed: "0" }), { code: "OVERLAY_ATTRIBUTE" });
  assert.throws(() => parseOverlayOptions("GlitchVeil", { bars: "257", colors: "#ffffff", opacity: "1", travel: "0", seed: "0" }), { code: "TYPE_INVALID" });
  assert.throws(() => parseOverlayOptions("GlitchVeil", { bars: "1", colors: "#ffffff,", opacity: "1", travel: "0", seed: "0" }), { code: "OVERLAY_COLOR" });
  assert.throws(() => parseOverlayOptions("Grain", { amount: "1", size: "0", chroma: "color", "motion-rate": "0", seed: "0" }), { code: "OVERLAY_ATTRIBUTE" });
  assert.throws(() => parseOverlayOptions("TVStatic", { amount: "1", size: "1", "scan-lines": "0", "motion-rate": "1", seed: "-1" }), { code: "TYPE_INVALID" });
  assert.deepEqual(parseOverlayOptions("Flash", { color: "#ffffff", intensity: "0", attack: "0", hold: "0", decay: "0" }), { color: "#ffffff", intensity: 0, attack: 0, hold: 0, decay: 0 });
});

test("independent overlapping effects retain lifetime and stacking without suppressing lower effects", () => {
  const plan: OverlayAuthorPlan = { effects: [
    { kind: "ColorWash", effectKey: "wash", z: -2, options: { color: "#ff0000", opacity: 0.2 }, windowIndex: 0 },
    { kind: "Flash", effectKey: "flash", z: -2, options: { color: "#ffffff", intensity: 1, attack: 1, hold: 1, decay: 1 }, windowIndex: 1 },
  ] };
  const windows = [projectWindow(timeline, { kind: "during", source: "program" }, "wash"), projectWindow(timeline, { kind: "at", source: "10f", duration: "20f" }, "flash")];
  const resolved = assembleOverlayProgram("overlay", canvas, timeline, plan, windows);
  const lowered = lowerOverlay(resolved);
  assert.deepEqual(lowered.presents.map(present => present.lifetime), [{ start: 0, end: 60 }, { start: 10, end: 30 }]);
  assert.ok(lowered.presents[0]!.layerKey < lowered.presents[1]!.layerKey);
  assert.equal(lowered.presents[0]!.visible, undefined);
  assert.throws(() => assembleOverlayProgram("overlay", canvas, timeline, plan, windows.slice(0, 1)), { code: "OVERLAY_INPUT" });
  assert.throws(() => validateOverlayProgram({ ...resolved, timeline: { ...timeline, axisKey: "other" } }), { code: "OVERLAY_WINDOW" });
  assert.throws(() => validateOverlayProgram({ ...resolved, effects: [{ ...resolved.effects[0]!, effectKey: "other" }] }), { code: "OVERLAY_WINDOW" });
});

test("Bokeh generated geometry keeps one highlight at zero amount and scales to 48", () => {
  const options = { amount: 0, "min-size": 20, "max-size": 100, color: "#ffffff", warmth: 0, drift: 0, seed: 0 };
  for (const [amount, count] of [[0, 1], [0.01, 1], [0.5, 24], [1, 48]]) {
    const geometry = createBokehGeometry(640, 360, { ...options, amount: amount! }, () => 0.5);
    assert.equal(geometry.length, count);
    assert.deepEqual(geometry[0], { x: 320, y: 180, radius: 30, alpha: 0.275, velocity: 0 });
  }
  const lower = createBokehGeometry(640, 360, options, () => 0);
  const upper = createBokehGeometry(640, 360, options, () => 1 - Number.EPSILON);
  assert.equal(lower[0]!.radius, options["min-size"] / 2);
  assert.ok(upper[0]!.radius <= options["max-size"] / 2);
  assert.ok(upper[0]!.x < 640 && upper[0]!.y < 360);
});
