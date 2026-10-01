import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResultsRepository } from "../build/results.ts";
import type { ResultManifest } from "../build/results.ts";
import { BuildStore } from "../build/store.ts";
import { StudioLibraries } from "./libraries.ts";

const ids = ["bld_20261001T000000000Z_0000000001", "bld_20261001T000001000Z_0000000002", "bld_20261001T000002000Z_0000000003"];
const resource = { $resource: "res_0123456789abcdef0123456789abcdef", mime: "image/png", bytes: 2 };
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "dv-libraries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, stateDir: join(root, ".dsivio-video") };
}
function manifest(id: string, outputs: ResultManifest["outputs"], outcome: ResultManifest["outcome"] = "complete"): ResultManifest {
  return { id, outputs, outcome, title: null, author: "author", run: "run.dvrun", targets: ["image"], createdAt: "2026-10-01T00:00:00Z", completedAt: outcome === "open" ? null : "2026-10-01T00:00:01Z", failure: null, operations: [] };
}
test("Library keeps open results opt-in and follows actual owner identity, not matching bytes", async (t) => {
  const ws = await fixture(t), results = new ResultsRepository(ws.stateDir), libraries = new StudioLibraries(ws);
  await results.write(manifest(ids[0]!, { image: { type: "media@1#Image", class: "resource", value: resource }, nested: { type: "test@1#Composite", class: "composite", value: { file: resource } } }));
  await results.write(manifest(ids[1]!, { alias: { forward: { build: ids[0]!, output: "image" } } }));
  await results.write(manifest(ids[2]!, { distinct: { type: "media@1#Image", class: "resource", value: resource } }, "open"));
  assert.deepEqual((await results.list()).map(row => row.id), [ids[1], ids[0]]);
  assert.deepEqual((await results.list({ includeOpen: true })).map(row => row.id), [...ids].reverse());
  const page = await libraries.artifacts();
  assert.equal(page.artifacts.length, 2);
  const owner = page.artifacts.find(card => card.owner.build === ids[0])!;
  assert.deepEqual(owner.sources.map(row => [row.build, row.output]), [[ids[1], "alias"], [ids[0], "image"]]);
  assert.equal(page.artifacts.some(card => card.owner.output === "nested"), false);
  assert.deepEqual(await libraries.artifactResource(ids[1]!, "alias"), resource);
});
test("Display-name edit targets the requested alias only and preserves immutable data/extensions", async (t) => {
  const ws = await fixture(t), results = new ResultsRepository(ws.stateDir);
  await results.write(manifest(ids[0]!, { image: { type: "media@1#Image", class: "resource", value: resource } }));
  await results.write(manifest(ids[1]!, { alias: { forward: { build: ids[0]!, output: "image" } }, other: { type: "test@1#Text", class: "scalar", value: "keep" } }));
  const path = results.pathOf(ids[1]!);
  const raw = JSON.parse(await readFile(path, "utf8"));raw.custom = { keep: true };raw.outputs.alias.custom = [1, 2];
  await writeFile(path, JSON.stringify(raw));
  const old = (await results.readVersioned(ids[1]!))!;
  const renamed = await results.renameOutput(ids[1]!, "alias", old.manifestVersion, "  New / display name  ");
  assert.equal(renamed.manifest.outputs.alias?.displayName, "New / display name");
  assert.equal((await results.read(ids[0]!))?.outputs.image?.displayName, undefined);
  assert.deepEqual((await results.read(ids[1]!))?.outputs.other, old.manifest.outputs.other);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")).custom, { keep: true });
  assert.deepEqual(await results.readOutput(ids[1]!, "alias"), { type: "media@1#Image", value: { type: "media@1#Image", data: resource } });
  await assert.rejects(results.renameOutput(ids[1]!, "alias", old.manifestVersion, "Stale"), { code: "RESULT_RENAME_CONFLICT" });
});
test("Open and result-save-pending Builds reject rename; task filters and cursor include save state", async (t) => {
  const ws = await fixture(t), results = new ResultsRepository(ws.stateDir), libraries = new StudioLibraries(ws), store = new BuildStore(ws.stateDir);
  await results.write(manifest(ids[0]!, { image: { type: "media@1#Image", class: "resource", value: resource } }));
  await results.write(manifest(ids[1]!, { image: { type: "media@1#Image", class: "resource", value: resource } }, "open"));
  store.insert({ id: ids[2]!, title: "Saving", author: "author", run: "run.dvrun", state: "working", outcome: "failed", stopReason: "failed", cancelRequested: false, created: "2026-10-01", definition: { schema: "dsivio-video.definition/1", author: "author", run: "run", targets: [], seeds: {}, forwarded: {}, reused: {}, modules: [], steps: [], outputs: {} } });
  await results.write(manifest(ids[2]!, { image: { type: "media@1#Image", class: "resource", value: resource } }, "failed"));
  store.close();
  for (const id of [ids[1]!, ids[2]!]) await assert.rejects(results.renameOutput(id, "image", (await results.readVersioned(id))!.manifestVersion, "Not yet"), { code: "RESULT_RENAME_CONFLICT" });
  const active = await libraries.tasks({ state: "active", limit: 1 });
  assert.equal(active.tasks[0]?.id, ids[2]);assert.equal(active.before, ids[2]);
  assert.equal((await libraries.tasks({ state: "active", before: active.before })).tasks[0]?.id, ids[1]);
  assert.deepEqual((await libraries.tasks({ state: "ended" })).tasks.map(row => row.id), [ids[0]]);
});
test("Artifact forwarding cycles fail rather than fabricate an owner", async (t) => {
  const ws = await fixture(t), results = new ResultsRepository(ws.stateDir);
  await results.write(manifest(ids[0]!, { image: { forward: { build: ids[1]!, output: "image" } } }));
  await results.write(manifest(ids[1]!, { image: { forward: { build: ids[0]!, output: "image" } } }));
  await assert.rejects(new StudioLibraries(ws).artifacts(), { code: "HISTORY_CYCLE" });
});

test("Concurrent display-name writes on the same manifest permit one old-version winner", async (t) => {
  const ws = await fixture(t), first = new ResultsRepository(ws.stateDir), second = new ResultsRepository(ws.stateDir);
  await first.write(manifest(ids[0]!, { image: { type: "media@1#Image", class: "resource", value: resource }, other: { type: "media@1#Image", class: "resource", value: resource } }));
  const original = (await first.readVersioned(ids[0]!))!;
  const outcomes = await Promise.allSettled([
    first.renameOutput(ids[0]!, "image", original.manifestVersion, "First"),
    second.renameOutput(ids[0]!, "other", original.manifestVersion, "Second"),
  ]);
  assert.equal(outcomes.filter(row => row.status === "fulfilled").length, 1);
  const rejected = outcomes.find(row => row.status === "rejected");
  assert.equal(rejected?.status === "rejected" ? rejected.reason.code : null, "RESULT_RENAME_CONFLICT");
  const current = (await first.read(ids[0]!))!;
  assert.equal(current.outputs.image?.displayName, "First");
  assert.equal(current.outputs.other?.displayName, undefined);
  assert.deepEqual("value" in current.outputs.image! ? current.outputs.image.value : null, resource);
});
