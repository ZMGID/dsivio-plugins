import test from "node:test";
import assert from "node:assert/strict";
import type { Json } from "../../core/value.ts";
import type { CompanionInput } from "../../studio/companion.ts";
import type { FontFace } from "../../fonts/types.ts";
import { parseScript } from "../../timeline/script.ts";
import { materializeTake } from "../../timeline/align.ts";
import { assembleTimeline } from "../../timeline/timeline.ts";
import { projectWindow } from "../../timeline/temporal.ts";
import { createFineStyle } from "../../components/caption-fine/style.ts";
import { assembleFineProgram } from "../../components/caption-fine/program.ts";
import { lowerFine } from "../../components/caption-fine/lower.ts";
import { fineTypes } from "../../components/caption-fine/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { compileDocument } from "../../render/document.ts";
import { fineTrackStudio, fineStyleStudio } from "./studio.ts";
import { captionTypes } from "../../components/caption/types.ts";
const face: FontFace = { faceKey: "sc", family: "noto-sans-sc", weight: 700, style: "normal", shards: [{ resource: { $resource: "font", bytes: 100, mime: "font/woff2" }, unicodeRange: "U+0-10FFFF" }], license: { spdx: "OFL-1.1", notice: { $resource: "license", bytes: 100, mime: "text/plain" } } };
const style = createFineStyle("fine", { rule: "caption.base", properties: { "stack-order": 10, x: .5, y: .8, width: .9, align: "center", size: 48, "line-height": 1.2, background: "#00000080", padding: "8 12", radius: 8, fill: "#FFFFFF" } }, face);
function fixture(body: string): CompanionInput {
  const narrative = parseScript(body, "story").narrative, segment = narrative.segments[0]!;
  const take = materializeTake(narrative, segment, { clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, sound: { resource: { $resource: "audio", bytes: 100, mime: "audio/wav" }, totalSamples: 96000 } }, { sampleRate: 16000, totalSamples: 32000, language: "zh", engine: "test", blocks: [{ words: ["今", "天", "很", "好"].map((text, index) => ({ text, samples: { start: index * 6000, end: index * 6000 + 4000 } })), characters: [] }], voiceRegions: [] });
  const timeline = assembleTimeline(take.media.clock, [take], { timelineKey: "tl", placements: [{ placementKey: "clip", at: "10f" }] }, "90f");
  const windows = [projectWindow(timeline, { kind: "during", source: "program" }, "use"), projectWindow(timeline, { kind: "at", source: "15f", duration: "8f" }, "hide")];
  const program = assembleFineProgram("captions", narrative.captions, timeline, { uses: [{ useKey: "use", windowIndex: 0, styleIndex: 0 }, { useKey: "hide", windowIndex: 1, styleIndex: 1 }] }, windows, [style, { kind: "hidden", styleKey: "hidden" }]);
  const track = lowerFine(program), domain = { axisKey: timeline.axisKey, clock: timeline.clock, totalFrames: timeline.totalFrames, totalSamples48k: 144000 };
  const document = compileDocument({ compositionKey: "film", canvasKey: "canvas", domain, extent: { widthPx: 640, heightPx: 360 }, background: "#000000", visualTracks: [track], audioTracks: [] });
  return { value: { type: renderTypes.visual, data: track as unknown as Json }, type: renderTypes.visual, moduleId: "dsivio-video/caption-fine@1", surface: "Track", output: "track", outputKey: "lower.track", authorKey: "main.dvml#caption", timeline, document,
    supports: { program: { type: fineTypes.program, data: program as unknown as Json } }, inputs: {}, executionEdges: [], provenance: { kind: "author" },
    authorGraph: { source: "main.dvml", sources: ["main.dvml"], records: new Map(), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: [] },
    authoring: { units: new Map(), elements: new Map(), relations: [], references: [], inputs: [] }, fallback() { throw new Error("Unexpected fallback"); } };
}
test("Companion preserves authored dual display text and complete read-only Cue clock while masks remain separate", () => {
  const input = fixture("<intro><HOST><天气|今天>很好</intro>"), projection = fineTrackStudio.project(input);
  const cue = projection.entities[0]!;
  assert.equal(cue.text, "天气很好"); assert.deepEqual(cue.temporal, []);
  assert.deepEqual(cue.intervals, [{ start: 10, end: 52 }]);
  assert.deepEqual(cue.visibleIntervals, [{ start: 10, end: 15 }, { start: 23, end: 52 }]);
  assert.equal(projection.bands[0]!.height, 15); assert.equal(projection.bands[0]!.laneKey, projection.lanes[0]!.key);
  const changed = fineTrackStudio.project(fixture("<intro><HOST><晴天|今天>很好</intro>"));
  assert.equal(changed.entities[0]!.editorKey, cue.editorKey);
});
test("Style controls retain domain enum scalars, exact recipe ratios and optional numeric schema", () => {
  const input = fixture("<intro><HOST>今天很好</intro>");
  const projection = fineStyleStudio.project({ ...input, surface: "Style", output: "", value: { type: captionTypes.style, data: style as unknown as Json } });
  const fields = projection.fieldGroups.flatMap(group => group.fields), width = fields.find(field => field.label === "width")!;
  assert.equal(width.authorValue, .9); assert.equal(width.displayScale, 100);
  assert.deepEqual(fields.find(field => field.label === "karaoke-transition")!.options?.map(option => option.value), ["step", "wipe"]);
  assert.equal(fields.find(field => field.label === "active-box-transition-frames")!.authorValue, 0);
  assert.equal(fields.find(field => field.label === "height")!.widget, "number");
});
