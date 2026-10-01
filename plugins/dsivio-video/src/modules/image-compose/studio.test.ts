import test from "node:test";
import assert from "node:assert/strict";
import type { CompanionInput } from "../../studio/companion.ts";
import { emptyProjection } from "../../studio/projection.ts";
import { VISUAL_IR_VERSION } from "../../render/ir.ts";
import { composePlanType } from "../../components/image-compose/types.ts";
import module from "./index.ts";
const timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 90, placements: [] };
const imageType = "dsivio-video/media@1#Image";
const sources = ["second-declared", "first-declared", "second-declared"].map($resource => ({ type: imageType, data: { $resource, bytes: 100, mime: "image/png" } }));
const frame = { canvasKey: "canvas", rect: { xPx: 0, yPx: 0, widthPx: 20, heightPx: 20 } };
function input(): CompanionInput {
  return { value: { type: imageType, data: { $resource: "result", bytes: 100, mime: "image/png" } }, type: imageType, moduleId: module.id, surface: "Image", output: "image", outputKey: "compose.image", authorKey: "author", authorGraph: { source: "source", sources: [], records: new Map(), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: [] }, authoring: { units: new Map(), elements: new Map(), relations: [], inputs: [], references: [] }, inputs: { sources, frames: sources.map(() => ({ type: "dsivio-video/space@1#Frame", data: frame })), plan: [{ type: composePlanType, data: { background: "#00000000", layers: sources.map((_, index) => ({ fit: "contain", interpolation: "nearest", opacity: index === 1 ? 0.5 : 1 })) } }] }, executionEdges: [], supports: {}, timeline, document: { version: VISUAL_IR_VERSION, compositionKey: "composition", domain: { ...timeline, totalSamples48k: 144000 }, extent: { widthPx: 32, heightPx: 32 }, resources: [], surfaces: [], html: "" }, provenance: { kind: "author" }, fallback: emptyProjection };
}
test("composition preserves declared repeated sources and later-layer paint order without fabricating static time", () => {
  const result = module.studio![0]!.project(input());
  assert.deepEqual(result.materials.slice(0, 3).map(material => material.resource?.$resource), ["second-declared", "first-declared", "second-declared"]);
  assert.deepEqual(result.entities.map(entity => entity.paintRank), [0, 1, 2]);
  assert.deepEqual(result.entities.map(entity => entity.materials), result.materials.slice(0, 3).map(material => [material.key]));
  assert.deepEqual(result.entities.map(entity => [entity.intervals, entity.temporal]), [[[], []], [[], []], [[], []]]);
  const opacity = result.fieldGroups.flatMap(group => group.fields).filter(field => field.label === "Opacity");
  assert.deepEqual(opacity.map(field => [field.authorValue, field.displayScale]), [[1, 100], [0.5, 100], [1, 100]]);
});
test("layer projection rejects a missing consumed source instead of shifting geometry to the wrong layer", () => {
  const value = input();
  assert.throws(() => module.studio![0]!.project({ ...value, inputs: { ...value.inputs, sources: sources.slice(1) } }), { code: "STUDIO_COMPOSE_INPUTS" });
});
