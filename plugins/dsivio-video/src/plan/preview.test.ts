import test from "node:test";
import assert from "node:assert/strict";
import type { ExecutionDefinition } from "../core/graph.ts";
import type { ProducerDef } from "../core/module.ts";
import type { CapabilityDef } from "../core/capability.ts";
import { isPending } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { previewNeeds } from "./preview.ts";
import { DvError } from "../core/errors.ts";

const image = "media@1#Image";
const text = "text@1#Text";
function definition(): ExecutionDefinition {
  return { schema: "dsivio-video.definition/1", author: "author", run: "run", targets: ["shot.video"], modules: [], seeds: { prompt: { type: text, data: "sunrise" } }, forwarded: {}, reused: {}, steps: [
    { key: "a", producer: "test@1#image", label: "hero", inputs: { prompt: "prompt" }, results: { image: "hero.image" }, resultTypes: { image } },
    { key: "b", producer: "test@1#video", label: "shot", inputs: { prompt: "prompt", frame: "hero.image" }, results: { video: "shot.video" }, resultTypes: { video: image } },
  ], outputs: { "hero.image": { record: "hero.image", type: image }, "shot.video": { record: "shot.video", type: image } } };
}

test("pending first frame is visible in a resolved request without capability execution", async () => {
  const requests: Json[] = [];
  let executed = false;
  const producers: Record<string, ProducerDef> = {
    "test@1#image": { inputs: { prompt: { type: text } }, outputs: { image }, run() { return { needs: { image: { capability: "test/image", request: { prompt: "sunrise" } } } }; } },
    "test@1#video": { inputs: { prompt: { type: text }, frame: { type: image } }, outputs: { video: image }, previewsPending: true, run(inputs) { const frame = inputs.frame; assert.ok(frame && !Array.isArray(frame) && isPending(frame)); return { needs: { video: { capability: "test/image", request: { "first-frame": { $pending: frame.$pending, type: frame.type } } } } }; } },
  };
  const capability: CapabilityDef = { name: "test/image", returns: image, async resolve(request) { requests.push(request); return { ok: true, request, backend: "test", summary: {}, cost: "paid" }; }, executor: { kind: "immediate", async run() { executed = true; throw new Error("must never execute"); } } };
  const rows = await previewNeeds(definition(), { projectRoot: "/project" }, { findProducer: (ref) => producers[ref], findCapability: () => capability });
  assert.equal(executed, false);
  assert.deepEqual(requests[1], { "first-frame": { $pending: "hero.image", type: image } });
  assert.deepEqual(rows.map((row) => { assert.ok(row.kind === "request"); return [row.label, row.port, row.capability, row.resolution.ok]; }), [["hero", "image", "test/image", true], ["shot", "video", "test/image", true]]);
});

test("known pure upstream values are evaluated before pending-capable consumers", async () => {
  const def = definition();
  def.steps.reverse();
  const producers: Record<string, ProducerDef> = {
    "test@1#image": { inputs: { prompt: { type: text } }, outputs: { image }, run() { return { outputs: { image: { type: image, data: "known-frame" } } }; } },
    "test@1#video": { inputs: { frame: { type: image } }, outputs: { video: image }, previewsPending: true, run(inputs) { const frame = inputs.frame; assert.ok(frame && !Array.isArray(frame) && "data" in frame); return { outputs: { video: { type: image, data: frame.data } } }; } },
  };
  assert.deepEqual(await previewNeeds(def, { projectRoot: "/project" }, { findProducer: (ref) => producers[ref], findCapability: () => undefined }), []);
});

test("non-previewable pending steps report the public waiting name", async () => {
  const producers: Record<string, ProducerDef> = {
    "test@1#image": { inputs: {}, outputs: { image }, run() { return { needs: { image: { capability: "missing", request: {} } } }; } },
    "test@1#video": { inputs: {}, outputs: { video: image }, run() { throw new Error("pending step must not run"); } },
  };
  const rows = await previewNeeds(definition(), { projectRoot: "/project" }, { findProducer: (ref) => producers[ref], findCapability: () => undefined });
  const request = rows[0]!;
  assert.ok(request.kind === "request");
  assert.deepEqual(request.resolution, { ok: false, code: "UNKNOWN_CAPABILITY", reason: "Unknown capability missing" });
  assert.deepEqual(rows[1], { kind: "waiting", step: "b", label: "shot", waitingFor: ["hero.image"] });
});

test("unselected producer needs are never resolved", async () => {
  const def = definition();
  def.steps = [def.steps[0]!];
  def.targets = ["hero.image"];
  def.steps[0]!.resultTypes.unselected = image;
  const producer: ProducerDef = { inputs: {}, outputs: { image, unselected: image }, run() { return { outputs: { image: { type: image, data: "fixed" } }, needs: { unselected: { capability: "must-not-resolve", request: {} } } }; } };
  assert.deepEqual(await previewNeeds(def, { projectRoot: "/project" }, { findProducer: () => producer, findCapability() { throw new Error("unselected capability must not be looked up"); } }), []);
});

test("producer failures become coded issues without losing independent previews", async () => {
  for (const cause of [new DvError("PROMPT_INVALID", "Invalid prompt"), new Error("Broken producer")]) {
    const def = definition();
    def.steps[1]!.inputs = { prompt: "prompt" };
    const producers: Record<string, ProducerDef> = {
      "test@1#image": { inputs: {}, outputs: { image }, run() { throw cause; } },
      "test@1#video": { inputs: {}, outputs: { video: image }, run() { return { needs: { video: { capability: "independent", request: { prompt: "still previewed" } } } }; } },
    };
    const capability: CapabilityDef = { name: "independent", returns: image, async resolve(request) { return { ok: true, request, backend: "test", summary: {}, cost: "local" }; }, executor: { kind: "immediate", async run() { throw new Error("must never execute"); } } };
    const rows = await previewNeeds(def, { projectRoot: "/project" }, { findProducer: (ref) => producers[ref], findCapability: () => capability });
    assert.deepEqual(rows[0], { kind: "issue", step: "a", label: "hero", code: cause instanceof DvError ? "PROMPT_INVALID" : "PRODUCER_RUN_FAILED", message: cause.message });
    const independent = rows[1]!;
    assert.ok(independent.kind === "request");
    assert.equal(independent.capability, "independent");
    assert.equal(independent.resolution.ok, true);
  }
});
