import test from "node:test";
import assert from "node:assert/strict";
import type { FontFace } from "../../fonts/types.ts";
import type { Json } from "../../core/value.ts";
import { parseScript } from "../../timeline/script.ts";
import { materializeTake } from "../../timeline/align.ts";
import { assembleTimeline } from "../../timeline/timeline.ts";
import { projectWindow } from "../../timeline/temporal.ts";
import { projectCaptionContent } from "../caption/program.ts";
import { createFineStyle, decodeFineRecipe, actions } from "./style.ts";
import { assembleFineProgram, scheduleFine, cueEnvelope } from "./program.ts";
import { lowerFine } from "./lower.ts";
import { validateRegions } from "./validate.ts";
const face: FontFace = { faceKey: "sc", family: "noto-sans-sc", weight: 700, style: "normal", shards: [{ resource: { $resource: "woff", bytes: 100, mime: "font/woff2" }, unicodeRange: "U+0-10FFFF" }], license: { spdx: "OFL-1.1", notice: { $resource: "license", bytes: 100, mime: "text/plain" } } };
const properties = { "stack-order": 10, x: .5, y: .8, width: .9, align: "center", size: 48, "line-height": 1.2, background: "#00000080", padding: "8 12", radius: 8, fill: "#FFFFFF" };
const style = createFineStyle("fine", { rule: "caption.base", properties }, face);
function fixture(body = "<intro><HOST>今天||很好</intro><unplaced><GUEST>再见</unplaced>") {
 const narrative = parseScript(body, "story").narrative, segment = narrative.segments[0]!;
 const take = materializeTake(narrative, segment, { clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, sound: { resource: { $resource: "audio", bytes: 100, mime: "audio/wav" }, totalSamples: 96000 } }, { sampleRate: 16000, totalSamples: 32000, language: "zh", engine: "test", blocks: [{ words: ["今", "天", "很", "好"].map((text, i) => ({ text, samples: { start: i * 6000, end: i * 6000 + 4000 } })), characters: [] }], voiceRegions: [] });
 const timeline = assembleTimeline(take.media.clock, [take], { timelineKey: "tl", placements: [{ placementKey: "clip", at: "10f" }] }, "90f"); return { narrative, timeline };
}
test("Caption projection preserves explicit cue boundaries, roles, original separators and real aligned word clocks", () => {
 const { narrative, timeline } = fixture(); const content = projectCaptionContent(narrative.captions, timeline);
 assert.deepEqual(content.cues.map(cue => ({ role: cue.role, text: cue.units.map(unit => unit.text).join(""), frames: cue.units.map(unit => unit.frames) })), [{ role: "HOST", text: "今天", frames: [{ start: 10, end: 18 }, { start: 21, end: 29 }] }, { role: "HOST", text: "很好", frames: [{ start: 32, end: 40 }, { start: 43, end: 52 }] }]);
 assert.equal(content.cues.some(cue => cue.role === "GUEST"), false);
 assert.throws(() => projectCaptionContent({ ...narrative.captions, storyKey: "other" }, timeline), { code: "CAPTION_STORY" });
});
test("Hidden and role precedence mask visibility without cutting complete Cues or restarting clocks", () => {
 const { narrative, timeline } = fixture(); const hidden = { kind: "hidden" as const, styleKey: "hidden" };
 const keys = ["all", "hidden", "guest"];
 const windows = [projectWindow(timeline, { kind: "during", source: "program" }, keys[0]!), projectWindow(timeline, { kind: "at", source: "15f", duration: "8f" }, keys[1]!), projectWindow(timeline, { kind: "during", source: "program" }, keys[2]!)];
 const program = assembleFineProgram("captions", narrative.captions, timeline, { uses: keys.map((useKey, i) => ({ useKey, windowIndex: i, styleIndex: i, ...(i === 2 ? { role: "GUEST" } : {}) })) }, windows, [style, hidden, hidden]);
 const schedule = scheduleFine(program); assert.deepEqual(schedule.items[0]?.lifetime, { start: 10, end: 29 }); assert.deepEqual(schedule.items[0]?.visible, [{ start: 10, end: 15 }, { start: 23, end: 29 }]);
 const track = lowerFine(program); const node = track.presents[0]!.nodes[0]!; assert.equal(node.kind, "program"); if (node.kind !== "program") throw new Error("Expected program"); assert.deepEqual(node.program.data && typeof node.program.data === "object" && !Array.isArray(node.program.data) ? node.program.data.units : null, program.content.cues[0]!.units);
});
test("Cut removes only optional envelope contention while overlap retains it", () => {
 const { narrative, timeline } = fixture(); const cues = projectCaptionContent(narrative.captions, timeline).cues;
 const expanded = createFineStyle("lead", { rule: "caption.lead", properties: { ...properties, "lead-frames": 12, "tail-frames": 12 } }, face);
 assert.deepEqual(cueEnvelope(cues[0]!, cues, expanded, 90), { start: 0, end: 30 }); assert.deepEqual(cueEnvelope(cues[1]!, cues, expanded, 90), { start: 30, end: 64 });
 assert.deepEqual(cueEnvelope(cues[0]!, cues, { ...expanded, recipe: { ...expanded.recipe, handoff: "overlap" } }, 90), { start: 0, end: 41 });
});
test("All recipe actions and drawing defaults validate; malformed colors, padding, dependencies and unknown keys fail", () => {
 for (const action of actions) decodeFineRecipe({ ...properties, "cue-enter": action, "atom-exit": action, "active-response": action });
 assert.equal(style.recipe["active-fill"], "#FFD54A"); assert.equal(style.recipe["word-gap"], 12); assert.equal(style.recipe["active-gradient-from"], undefined);
 const invalid: Record<string, Json>[] = [{ strange: 1 }, { "max-lines": 2 }, { "cue-enter-start-scale": .5 }, { "gradient-from": "#FFFFFF" }, { fill: "red" }, { padding: "1 2 3 4" }, { x: 2 }, { "max-words-per-line": 1.5 }];
 for (const bad of invalid) assert.throws(() => decodeFineRecipe({ ...properties, ...bad }), { code: "CAPTION_RECIPE" });
 assert.throws(() => createFineStyle("duplicate", { rule: "caption.base", properties }, face, [face]), { code: "TYPE_INVALID" });
});
test("Structural line limits count display units without splitting dual-text groups", () => {
 const { narrative, timeline } = fixture("<intro><HOST><今天|今天>很好</intro>");
 const limited = createFineStyle("limited", { rule: "caption.lines", properties: { ...properties, "max-words-per-line": 1, "max-lines": 2 } }, face);
 const program = assembleFineProgram("caption", narrative.captions, timeline, { uses: [{ useKey: "use", windowIndex: 0, styleIndex: 0 }] }, [projectWindow(timeline, { kind: "during", source: "program" }, "use")], [limited]);
 assert.throws(() => lowerFine(program), { code: "CAPTION_LINES" });
});
test("Regions require complete exact-frame evidence and a Cue role on the same axis", () => {
 const { narrative, timeline } = fixture(); const frames = Array.from({ length: 90 }, (_, i) => i === 20 ? null : { x: .1, y: .2, width: .3, height: .4 });
 validateRegions({ axisKey: timeline.axisKey, totalFrames: 90, tracks: [{ role: "HOST", frames }] });
 assert.throws(() => validateRegions({ axisKey: timeline.axisKey, totalFrames: 90, tracks: [{ role: "HOST", frames: frames.slice(1) }] }), { code: "CAPTION_REGIONS" });
 assert.throws(() => validateRegions({ axisKey: timeline.axisKey, totalFrames: 1, tracks: [{ role: "HOST", frames: [{ x: 2, y: .2, width: .3, height: .4 }] }] }), { code: "CAPTION_REGIONS" });
 const plan = { uses: [{ useKey: "u", windowIndex: 0, styleIndex: 0 }] }, windows = [projectWindow(timeline, { kind: "during", source: "program" }, "u")];
 assert.throws(() => assembleFineProgram("t", narrative.captions, timeline, plan, windows, [style], { axisKey: "wrong", totalFrames: 90, tracks: [] }), { code: "CAPTION_REGIONS" });
});
test("Hidden speech display units remain evidence but do not consume visible structural lines", () => {
 const { narrative, timeline } = fixture("<intro><HOST>< |今天>很好</intro>");
 const limited = createFineStyle("limited", { rule: "caption.lines", properties: { ...properties, "max-words-per-line": 1, "max-lines": 2 } }, face);
 const program = assembleFineProgram("captions", narrative.captions, timeline, { uses: [{ useKey: "u", windowIndex: 0, styleIndex: 0 }] }, [projectWindow(timeline, { kind: "during", source: "program" }, "u")], [limited]);
 assert.equal(program.content.cues[0]!.units[0]!.text, "");
 assert.deepEqual(program.content.cues[0]!.units[0]!.frames, { start: 10, end: 29 });
 const text = lowerFine(program).presents[0]!.nodes[1]!;
 assert.equal(text.kind, "text-flow"); if (text.kind !== "text-flow") throw new Error("Expected terminal text");
 assert.deepEqual(text.flow.paragraphs[0]!.runs.filter(run => run.kind === "run").map(run => run.text), ["很", "好"]);
});
test("Cut preserves overlapping measured speech rather than shortening either Cue", () => {
 const { narrative, timeline } = fixture(); const cues = projectCaptionContent(narrative.captions, timeline).cues;
 const overlap = [{ ...cues[0]!, frames: { start: 10, end: 40 } }, { ...cues[1]!, frames: { start: 30, end: 52 } }];
 const expanded = createFineStyle("overlap", { rule: "caption.base", properties: { ...properties, "lead-frames": 12, "tail-frames": 12 } }, face);
 assert.deepEqual(cueEnvelope(overlap[0]!, overlap, expanded, 90), { start: 0, end: 40 });
 assert.deepEqual(cueEnvelope(overlap[1]!, overlap, expanded, 90), { start: 30, end: 64 });
});
