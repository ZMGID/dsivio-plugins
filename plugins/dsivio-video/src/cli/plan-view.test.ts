import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { NeedPreview } from "../plan/preview.ts";
import { Workspace } from "../source/workspace.ts";
import { parseOptions } from "./options.ts";
import { planView } from "./plan-view.ts";
import type { PreparedRun } from "./project.ts";

function prepared(needs: NeedPreview[]): PreparedRun {
  return {
    workspace: Workspace.open({ cwd: process.cwd() }),
    plan: { definition: { schema: "dsivio-video.definition/1", author: "main.dvml", run: "build.dvrun", targets: ["shot.video"], seeds: {}, forwarded: {}, reused: {}, steps: [], outputs: {}, modules: [] }, overrides: [], unreachable: [], assets: new Map() },
    needs,
  };
}
const options = parseOptions([], { usage: "plan", min: 0, max: 0 });

test("deferred pure steps do not reject a plan or masquerade as paid requests", () => {
  const view = planView(prepared([
    { kind: "waiting", step: "render", label: "Render", waitingFor: ["hero.image"] },
    { kind: "request", step: "image", label: "hero", port: "image", capability: "gateway/image", resolution: { ok: true, backend: "dsivio", cost: "paid", request: { model: "enabled" }, summary: { model: "enabled" } } },
  ]), options);
  assert.equal(view.valid, true);
  assert.equal(view.data.needTotal, 1);
  assert.equal(view.data.paidNeedTotal, 1);
  assert.equal(view.data.waitingStepTotal, 1);
  assert.equal(view.data.readiness.diagnosticTotal, 0);
});

test("producer issues reject readiness even when an unrelated request resolved", () => {
  const view = planView(prepared([
    { kind: "issue", step: "render", label: "Render", code: "TEXT_SLOT_REQUIRED", message: "Missing required direction slot" },
    { kind: "request", step: "image", label: "hero", port: "image", capability: "gateway/image", resolution: { ok: true, backend: "dsivio", cost: "paid", request: { model: "enabled" }, summary: { model: "enabled" } } },
  ]), options);
  assert.equal(view.valid, false);
  assert.equal(view.data.readiness.valid, false);
  assert.equal(view.data.requestProblemTotal, 1);
  assert.equal(view.data.paidNeedTotal, 1);
});

test("a disabled model rejects readiness without charging an informational waiting row", () => {
  const view = planView(prepared([
    { kind: "waiting", step: "render", label: "Render", waitingFor: ["hero.image"] },
    { kind: "request", step: "image", label: "hero", port: "image", capability: "gateway/image", resolution: { ok: false, code: "GEN_MODEL_NOT_ENABLED", reason: "Model is disabled" } },
  ]), options);
  assert.equal(view.valid, false);
  assert.equal(view.data.paidNeedTotal, 0);
  assert.equal(view.data.needTotal, 1);
  assert.equal(view.data.requestProblemTotal, 1);
});

test("human requests indent multiline prompts and name local references without opaque ids or empty media kinds", () => {
  const ref = { $resource: "res_private_reference", mime: "image/png", bytes: 68 };
  const input = prepared([{ kind: "request", step: "image", label: "hero", port: "image", capability: "gateway/image", resolution: {
    ok: true, backend: "dsivio", cost: "paid", request: { references: { images: [ref] } },
    summary: { prompt: "First line\n\nLast line", references: { images: [ref], videos: [], audios: [] } },
  } }]);
  input.plan.assets.set(ref.$resource, { ref, path: join(input.workspace.root, "assets", "product.png") });
  const human = planView(input, options).lines.join("\n");
  assert.match(human, /\n    First line\n    \n    Last line\n/);
  assert.match(human, /assets\/product[.]png/);
  assert.doesNotMatch(human, /res_private_reference|videos=|audios=/);
});

test("a reused media reference is identified by its public output rather than its resource id", () => {
  const ref = { $resource: "res_reused_reference", mime: "image/png", bytes: 68 };
  const input = prepared([{ kind: "request", step: "video", label: "shot", port: "video", capability: "gateway/video", resolution: {
    ok: true, backend: "dsivio", cost: "paid", request: { firstFrame: ref }, summary: { firstFrame: ref },
  } }]);
  input.plan.definition.seeds.image = { type: "dsivio-video/media@1#Image", data: ref };
  input.plan.definition.outputs["hero.image"] = { record: "image", type: "dsivio-video/media@1#Image" };
  const human = planView(input, options).lines.join("\n");
  assert.match(human, /hero[.]image/);
  assert.doesNotMatch(human, /res_reused_reference/);
});
