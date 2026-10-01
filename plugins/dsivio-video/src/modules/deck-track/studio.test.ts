import test from "node:test";
import assert from "node:assert/strict";
import type { Json } from "../../core/value.ts";
import type { CompanionInput } from "../../studio/companion.ts";
import { assembleTimeline } from "../../timeline/timeline.ts";
import { projectInstant } from "../../timeline/temporal.ts";
import { assembleDeck } from "../../components/deck-track/program.ts";
import { lowerDeck } from "../../components/deck-track/lower.ts";
import { compileDocument } from "../../render/document.ts";
import { renderTypes } from "../../render/ir.ts";
import { deckTypes } from "../../components/deck-track/types.ts";
import type { MediaSource } from "../../components/media-track/types.ts";
import { deckTrackStudio } from "./studio.ts";
const timeline = assembleTimeline({ fps: { numerator: 30, denominator: 1 } }, [], { timelineKey: "deck-studio", placements: [] }, "100f");
function fixture(source: MediaSource): CompanionInput {
  const keys = ["card", "nested/card", "third"], canvas = { canvasKey: "canvas", extent: { widthPx: 320, heightPx: 240 } };
  const program = assembleDeck(timeline, canvas, { canvasKey: "canvas", rect: { xPx: 0, yPx: 0, widthPx: 240, heightPx: 180 } }, { trackKey: "deck", appearance: { "visible-previous": 0, "visible-next": 0 }, cards: keys.map(cardKey => ({ cardKey })) }, keys.map(() => source), keys.map((key, index) => projectInstant(timeline, { kind: "at", source: `${index * 30}f` }, key)), projectInstant(timeline, { kind: "at", source: "100f" }, "deck"), []);
  const track = lowerDeck(program);
  const document = compileDocument({ compositionKey: "film", canvasKey: "canvas", extent: canvas.extent, background: "#000000", domain: { axisKey: timeline.axisKey, clock: timeline.clock, totalFrames: timeline.totalFrames, totalSamples48k: 160000 }, visualTracks: [track], audioTracks: [] });
  return { value: { type: renderTypes.visual, data: track as unknown as Json }, type: renderTypes.visual, moduleId: "dsivio-video/deck-track@1", surface: "DepthStack", output: "track", outputKey: "lower.track", authorKey: "main.dvml#deck", timeline, document,
    supports: { program: { type: deckTypes.program, data: program as unknown as Json } }, inputs: {}, executionEdges: [], provenance: { kind: "author" },
    authorGraph: { source: "main.dvml", sources: ["main.dvml"], records: new Map(), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: [] },
    authoring: { units: new Map(), elements: new Map(), relations: [], references: [], inputs: [] }, fallback() { throw new Error("Unexpected fallback"); } };
}
test("Deck activation interval stays distinct from outgoing reflow visibility and exact nested card parts", () => {
  const input = fixture({ kind: "image", resource: { $resource: "image", bytes: 1, mime: "image/png" }, extent: { widthPx: 200, heightPx: 140 } });
  const projection = deckTrackStudio.project(input), first = projection.entities[0]!, nested = projection.entities[1]!;
  assert.deepEqual(first.intervals, [{ start: 0, end: 30 }]);
  assert.deepEqual(first.visibleIntervals, [{ start: 0, end: 30 }, { start: 30, end: 38 }]);
  assert.ok(first.pictureParts.includes("deck/1/card/source"));
  assert.ok(!first.pictureParts.includes("deck/1/nested/card/source"));
  assert.ok(nested.pictureParts.includes("deck/1/nested/card/source"));
  assert.deepEqual(first.temporal, []);
  assert.equal(projection.lanes[0]!.height, 52);
});
test("Deck Surface is a domain material, and still cards cannot expose source playback/trim", () => {
  const projection = deckTrackStudio.project(fixture({ kind: "surface", surface: { resource: { $resource: "surface-image", bytes: 1, mime: "image/png" }, extent: { widthPx: 200, heightPx: 140 }, alpha: "straight", color: "srgb-sdr", timing: { kind: "still" } } }));
  assert.equal(projection.materials[0]!.kind, "surface"); assert.equal(projection.materials[0]!.resource, undefined);
  assert.equal(projection.materials[0]!.value?.type, renderTypes.surface);
  assert.equal(projection.fieldGroups.some(group => group.sectionKey === "Playback"), false);
});
