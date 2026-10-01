import test from "node:test";
import assert from "node:assert/strict";
import type { CompanionInput } from "../../studio/companion.ts";
import type { Json } from "../../core/value.ts";
import { emptyProjection } from "../../studio/projection.ts";
import { imageProgramType } from "../../components/image-transform/types.ts";
import { imageTransformCompanions } from "./studio.ts";
import { VISUAL_IR_VERSION } from "../../render/ir.ts";
const timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 90, placements: [] };
function input(data: Json): CompanionInput {
  return { value: { type: imageProgramType, data }, type: imageProgramType, moduleId: "dsivio-video/image-transform@1", surface: "Program", output: "", outputKey: "program", authorKey: "author", authorGraph: { source: "source", sources: [], records: new Map(), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: [] }, authoring: { units: new Map(), elements: new Map(), relations: [], inputs: [], references: [] }, inputs: {}, executionEdges: [], supports: {}, timeline, document: { version: VISUAL_IR_VERSION, compositionKey: "composition", domain: { ...timeline, totalSamples48k: 144000 }, extent: { widthPx: 32, heightPx: 32 }, resources: [], surfaces: [], html: "" }, provenance: { kind: "author" }, fallback: emptyProjection };
}
test("static transform retains operation order and does not invent a Program time window", () => {
  const steps: Json[] = [{ kind: "rotate", degrees: 90 }, { kind: "crop", unit: "pixel", x: 1, y: 0, width: 2, height: 3 }, { kind: "encode", format: "png" }];
  const result = imageTransformCompanions[0]!.project(input({ orderedSteps: steps }));
  assert.deepEqual(result.entities[0]!.intervals, []);
  assert.deepEqual(result.entities[0]!.temporal, []);
  assert.deepEqual(result.fieldGroups[0]!.fields[0]!.authorValue, steps);
  assert.equal(result.fieldGroups[1]!.domain, "Where");
  assert.deepEqual(result.fieldGroups[2]!.fields.map(field => field.label), ["unit", "x", "y", "width", "height"]);
});
test("ordered image controls use real complete validation, not arbitrary records", () => {
  const project = (steps: Json) => imageTransformCompanions[0]!.project(input({ orderedSteps: steps }));
  assert.throws(() => project([{ kind: "encode", format: "png" }, { kind: "flip", axis: "both" }]), { code: "RASTER_INVALID" });
  assert.throws(() => project([{ kind: "denoise", method: "nlm-ycrcb", luma: 2, chroma: 10, templateWindow: 7, searchWindow: 7, saturationRecovery: 1 }]), { code: "RASTER_INVALID" });
  assert.throws(() => project([{ kind: "crop", unit: "fraction", x: 0.8, y: 0, width: 0.3, height: 1 }]), { code: "RASTER_INVALID" });
});
