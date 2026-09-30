import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "node:fs";
import type { ExecutionDefinition } from "../core/graph.ts";
import type { CapabilityDef } from "../core/capability.ts";
import { DvError } from "../core/errors.ts";
import { buildId, idempotencyKey, validateBuildId } from "./ids.ts";
import { BuildStore } from "./store.ts";
import { ProjectStore } from "./resources.ts";
import { ResultsRepository } from "./results.ts";
import type { ResultManifest } from "./results.ts";
import { runWorker, stopWorker } from "./worker.ts";
import type { BuildRegistry, BuildWorkspace } from "./worker.ts";
import { activity, buildView, cancelBuild } from "./observe.ts";
import { submitBuild } from "./submit.ts";

const TYPE = "fake@1#Text";
async function fixture(t: test.TestContext): Promise<BuildWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "dv-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, stateDir: join(root, ".dsivio-video") };
}
function definition(names = ["result"]): ExecutionDefinition {
  return {
    schema: "dsivio-video.definition/1", author: "/project/main.dvml", run: "/project/main.dvrun", targets: names,
    seeds: {}, forwarded: {}, reused: {}, modules: ["fake@1"],
    steps: names.map((name) => ({ key: name, label: name, producer: `fake@1#${name}`, inputs: {}, results: { value: name }, resultTypes: { value: TYPE } })),
    outputs: Object.fromEntries(names.map((name) => [name, { record: name, type: TYPE }])),
  };
}
function queue(workspace: BuildWorkspace, def = definition()): string {
  const id = buildId();
  const store = new BuildStore(workspace.stateDir);
  try { store.insert({ id, definition: def, title: "Example", author: def.author, run: def.run, created: new Date().toISOString(), state: "working", outcome: "open", stopReason: null, cancelRequested: false }); }
  finally { store.close(); }
  return id;
}
function registry(capability: CapabilityDef, producer?: BuildRegistry["findProducer"]): BuildRegistry {
  return { findCapability: (name) => name === capability.name ? capability : undefined,
    findProducer: producer ?? (() => ({ inputs: {}, outputs: { value: TYPE }, run: () => ({ needs: { value: { capability: capability.name, request: { model: "fake/model" } } } }) })) };
}
function capability(executor: CapabilityDef["executor"]): CapabilityDef {
  return { name: "fake/run", returns: TYPE, resolve: async (request) => ({ ok: true, request, backend: "fake", summary: {}, cost: "local" }), executor };
}
const fast = { idleTimeoutMs: 0, tickMs: 1, unavailableRetryMs: 1 };

 test("Build IDs validate real UTC dates and stable command keys", () => {
  const id = buildId(new Date("2026-10-01T03:15:02.123Z"));
  assert.match(id, /^bld_20261001T031502123Z_[0-9A-F]{10}$/);
  validateBuildId(id);
  assert.equal(idempotencyKey(id, "fulfil:x"), idempotencyKey(id, "fulfil:x"));
  assert.notEqual(idempotencyKey(id, "fulfil:x"), idempotencyKey(id, "fulfil:y"));
  for (const invalid of [" bld_20261001T031502123Z_A13BC29E04", "bld_20260230T031502123Z_A13BC29E04", "bld_20261001T251502123Z_A13BC29E04", "../x", "bld_20261001T031502123Z_abcdefghij"]) {
    assert.throws(() => validateBuildId(invalid), { code: "BUILD_ID_INVALID" });
  }
});

test("Immediate and independent pure outputs commit, publish, and become reusable history", async (t) => {
  const ws = await fixture(t);
  const id = queue(ws, definition(["local", "remote"]));
  let calls = 0;
  const cap = capability({ kind: "immediate", run: async () => { calls++; return { type: TYPE, data: "remote output" }; } });
  await runWorker(ws, { ...fast, registry: registry(cap, (ref) => ({ inputs: {}, outputs: { value: TYPE }, run: () => ref.endsWith("#local") ? { outputs: { value: { type: TYPE, data: "local output" } } } : { needs: { value: { capability: cap.name, request: {} } } } })) });
  assert.equal(calls, 1);
  const results = new ResultsRepository(ws.stateDir);
  assert.equal((await results.read(id))?.outcome, "complete");
  assert.deepEqual(await results.readOutput(id, "remote"), { type: TYPE, value: { type: TYPE, data: "remote output" } });
  assert.equal((await results.history("remote", { author: "/project/main.dvml" }))[0]?.id, id);
  const view = await buildView(id, ws);
  assert.equal(view?.work.state, "done");
  assert.deepEqual(view?.work.needs, { total: 1, done: 1 });
  assert.equal((await activity(ws)).activeBuilds.length, 0);
  const reused = definition();
  reused.steps = []; reused.outputs = {}; reused.forwarded = { result: { build: id, output: "remote" } };
  const next = queue(ws, reused);
  await runWorker(ws, { ...fast, registry: registry(cap) });
  assert.deepEqual(await results.readOutput(next, "result"), await results.readOutput(id, "remote"));
  assert.equal(calls, 1);
});

test("Async task pends twice; restart polls the saved handle without a duplicate submit", async (t) => {
  const ws = await fixture(t);
  const id = queue(ws);
  const keys: string[] = [];
  let submits = 0, polls = 0;
  const stop = new AbortController();
  const cap = capability({ kind: "async", submit: async (_request, ctx) => { submits++; keys.push(ctx.idempotencyKey); return { handle: { task: "remote-1" }, receipt: "remote-1" }; },
    poll: async (handle, ctx) => {
      assert.deepEqual(handle, { task: "remote-1" }); keys.push(ctx.idempotencyKey); polls++;
      if (polls === 1) stop.abort();
      return polls <= 2 ? { state: "pending", retryAfterMs: 0, progress: `poll ${polls}` } : { state: "done", value: { type: TYPE, data: "finished" } };
    } });
  await runWorker(ws, { ...fast, registry: registry(cap), signal: stop.signal });
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.outcome, "open");
  await runWorker(ws, { ...fast, registry: registry(cap) });
  assert.equal(submits, 1); assert.equal(polls, 3);
  assert.deepEqual([...new Set(keys)], [idempotencyKey(id, "fulfil:result.value")]);
  const manifest = await new ResultsRepository(ws.stateDir).read(id);
  assert.equal(manifest?.outcome, "complete");
  assert.equal(manifest?.operations[0]?.receipt, "remote-1");
});

test("Unavailable submit stays queued then uses the identical idempotency key", async (t) => {
  const ws = await fixture(t); const id = queue(ws); const keys: string[] = [];
  const cap = capability({ kind: "async", submit: async (_request, ctx) => {
    keys.push(ctx.idempotencyKey);
    if (keys.length === 1) throw new DvError("GATEWAY_UNAVAILABLE", "Open the gateway");
    return { handle: "accepted" };
  }, poll: async () => ({ state: "done", value: { type: TYPE, data: "ok" } }) });
  await runWorker(ws, { ...fast, registry: registry(cap) });
  assert.deepEqual(keys, [idempotencyKey(id, "fulfil:result.value"), idempotencyKey(id, "fulfil:result.value")]);
  assert.equal((await buildView(id, ws))?.work.outcome, "complete");
});

test("Failed task records its code and preserves already published outputs", async (t) => {
  const ws = await fixture(t); const id = queue(ws, definition(["local", "remote"]));
  const cap = capability({ kind: "async", submit: async () => ({ handle: "broken", receipt: "charged-task" }), poll: async () => ({ state: "failed", code: "REMOTE_FAILED", message: "Generation failed", charged: "maybe" }) });
  await runWorker(ws, { ...fast, registry: registry(cap, (ref) => ({ inputs: {}, outputs: { value: TYPE }, run: () => ref.endsWith("#local") ? { outputs: { value: { type: TYPE, data: "retained" } } } : { needs: { value: { capability: cap.name, request: {} } } } })) });
  const results = new ResultsRepository(ws.stateDir);
  assert.equal((await results.read(id))?.failure?.code, "REMOTE_FAILED");
  assert.equal((await results.readOutput(id, "local"))?.value.data, "retained");
  assert.equal((await results.read(id))?.operations[0]?.receipt, "charged-task");
});

test("A submitting operation without a handle is interrupted, never resubmitted", async (t) => {
  const ws = await fixture(t); const id = queue(ws);
  const store = new BuildStore(ws.stateDir);
  store.commitFact(id, { kind: "produced", command: "produce:result", outputs: {}, needs: { value: { capability: "fake/run", request: {} } } });
  store.saveOperation({ build: id, command: "fulfil:result.value", phase: "submitting", request: {}, backend: "fake", handle: null, receipt: null, nextWake: 0, progress: null, error: null }); store.close();
  let calls = 0;
  const cap = capability({ kind: "async", submit: async () => { calls++; return { handle: "unexpected" }; }, poll: async () => { throw new Error("unexpected poll"); } });
  await runWorker(ws, { ...fast, registry: registry(cap) });
  assert.equal(calls, 0);
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.failure?.code, "SUBMISSION_INTERRUPTED");
});

test("Cancel waits for in-flight submit, stops polling, and reports remote limitation", async (t) => {
  const ws = await fixture(t); const id = queue(ws, definition(["local", "remote"]));
  let started!: () => void; const submitting = new Promise<void>((resolve) => { started = resolve; });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let polls = 0;
  const cap = capability({ kind: "async", submit: async () => { started(); await gate; return { handle: "still-remote", receipt: "still-remote" }; }, poll: async () => { polls++; return { state: "pending", retryAfterMs: 1000 }; } });
  const worker = runWorker(ws, { ...fast, registry: registry(cap, (ref) => ({ inputs: {}, outputs: { value: TYPE }, run: () => ref.endsWith("#local") ? { outputs: { value: { type: TYPE, data: "published before submission finishes" } } } : { needs: { value: { capability: cap.name, request: {} } } } })) });
  await submitting;
  const open = await new ResultsRepository(ws.stateDir).read(id);
  assert.equal(open?.outcome, "open");
  assert.deepEqual(open?.outputs.local, { type: TYPE, class: "scalar", value: "published before submission finishes" });
  const cancellation = await cancelBuild(id, "Stopped by author", ws);
  assert.equal(cancellation.cancelRequested, true);
  assert.equal(cancellation.buildView?.work.state, "working");
  assert.match(cancellation.buildView!.remoteCancellation, /cannot be cancelled/);
  release(); await worker;
  assert.equal(polls, 0);
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.outcome, "cancelled");
  assert.equal((await cancelBuild(id, "Again", ws)).cancelRequested, false);
});

test("Resource adoption, all export classes, open get, history gate and missing bytes", async (t) => {
  const ws = await fixture(t); const source = join(ws.root, "source.bin"); await writeFile(source, "original bytes");
  const resources = new ProjectStore(ws.stateDir); const ref = await resources.putFile(source, "application/octet-stream");
  await writeFile(source, "changed bytes");
  assert.equal(await readFile(resources.pathOf(ref), "utf8"), "original bytes");
  assert.equal(resources.has(ref), true);
  const id = buildId(); const results = new ResultsRepository(ws.stateDir);
  const manifest: ResultManifest = { id, title: null, author: "author", run: "run", targets: ["resource"], createdAt: new Date().toISOString(), completedAt: null, outcome: "open", failure: null, operations: [], outputs: {
    scalar: { type: TYPE, class: "scalar", value: "a string" }, resource: { type: "fake@1#File", class: "resource", value: { ...ref } }, composite: { type: "fake@1#Document", class: "composite", value: { nested: [{ ...ref }, { ...ref }] } },
  } };
  await results.write(manifest);
  await assert.rejects(results.readOutput(id, "scalar"), { code: "HISTORY_OPEN" });
  assert.deepEqual(await results.list(), []);
  await results.exportOutput(id, "scalar", join(ws.root, "scalar.json"));
  assert.equal(await readFile(join(ws.root, "scalar.json"), "utf8"), '"a string"\n');
  await results.exportOutput(id, "resource", join(ws.root, "file.bin"));
  assert.equal(await readFile(join(ws.root, "file.bin"), "utf8"), "original bytes");
  await results.exportOutput(id, "composite", join(ws.root, "composite"));
  const doc = JSON.parse(await readFile(join(ws.root, "composite", "value.json"), "utf8"));
  assert.deepEqual(doc.data.nested.map((item: { $resource: string }) => item.$resource), [`files/${ref.$resource}`, `files/${ref.$resource}`]);
  assert.deepEqual(await readdir(join(ws.root, "composite", "files")), [ref.$resource]);
  await assert.rejects(results.exportOutput(id, "scalar", join(ws.root, "scalar.json")), { code: "EXPORT_EXISTS" });
  manifest.outcome = "failed"; manifest.completedAt = new Date().toISOString(); await results.write(manifest);
  assert.equal((await results.readOutput(id, "scalar"))?.value.data, "a string");
  await rm(resources.pathOf(ref));
  await assert.rejects(results.exportOutput(id, "resource", join(ws.root, "missing.bin")), { code: "EXPORT_FAILED" });
});

test("Historical forwarding detects cycles and follows finished owners", async (t) => {
  const ws = await fixture(t); const results = new ResultsRepository(ws.stateDir); const a = buildId(), b = buildId();
  const manifest = (id: string, target: string): ResultManifest => ({ id, title: null, author: "author", run: "run", targets: ["result"], createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), outcome: "complete", failure: null, operations: [], outputs: { result: { forward: { build: target, output: "result" } } } });
  await results.write(manifest(a, b)); await results.write(manifest(b, a));
  await assert.rejects(results.readOutput(a, "result"), { code: "HISTORY_CYCLE" });
});

test("submitBuild adopts assets and launches a detached stub; failed launch queues no Build", async (t) => {
  const ws = await fixture(t); const launcher = join(ws.root, "stub.mjs");
  // This integration stub exercises the actual cross-process SQLite heartbeat protocol.
  const storeModule = new URL("./store.ts", import.meta.url).href;
  await writeFile(launcher, `import {writeFile} from 'node:fs/promises'; import {join} from 'node:path'; import {BuildStore} from ${JSON.stringify(storeModule)}; const root=process.argv[process.argv.indexOf('--workspace')+1]; const state=join(root,'.dsivio-video'); const store=new BuildStore(state); if(!store.acquireWorker('stub-owner',process.pid)) process.exit(0); const heartbeat=setInterval(async()=>{if(!store.heartbeatWorker('stub-owner')){clearInterval(heartbeat);store.releaseWorker('stub-owner');store.close();await writeFile(join(state,'runtime','stub.stopped'),'stopped');}},5);`);
  const path = join(ws.root, "asset.bin"); await writeFile(path, "source");
  const ref = { $resource: "res_0123456789abcdef0123456789abcdef", bytes: 6, mime: "application/octet-stream" };
  const id = await submitBuild({ plan: { definition: definition(), assets: new Map([[ref.$resource, { path, ref }]]) }, workspace: ws, title: "Spawned" }, { launcherPath: launcher, startTimeoutMs: 1000 });
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.title, "Spawned");
  assert.equal(await readFile(new ProjectStore(ws.stateDir).pathOf(ref), "utf8"), "source");
  const stopped = new Promise<void>((resolve, reject) => {
    const watcher = watch(join(ws.stateDir, "runtime"), (_event, filename) => {
      if (filename !== "stub.stopped") return;
      watcher.close();
      resolve();
    });
    watcher.on("error", reject);
  });
  await stopWorker(ws);
  await stopped;
  const before = new BuildStore(ws.stateDir); const count = before.working().length; before.close();
  await assert.rejects(submitBuild({ plan: { definition: definition(), assets: new Map() }, workspace: ws }, { launcherPath: join(ws.root, "missing.mjs"), startTimeoutMs: 50 }), { code: "WORKER_START_FAILED", message: "Worker could not start; no Build was queued" });
  const after = new BuildStore(ws.stateDir); assert.equal(after.working().length, count); after.close();
});

test("Short actions share a global concurrency bound and malformed values never enter facts", async (t) => {
  const ws = await fixture(t);
  const id = queue(ws, definition(Array.from({ length: 9 }, (_, index) => `request-${index}`)));
  let active = 0, peak = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const cap = capability({ kind: "immediate", run: async () => {
    active++; peak = Math.max(peak, active);
    if (active === 3) release();
    await barrier;
    active--;
    return { type: TYPE, data: "ok" };
  } });
  await runWorker(ws, { ...fast, concurrency: 3, registry: registry(cap) });
  assert.ok(peak > 1 && peak <= 3);
  assert.equal((await buildView(id, ws))?.work.needs.done, 9);
  const broken = queue(ws);
  await runWorker(ws, { ...fast, registry: registry(cap, () => ({ inputs: {}, outputs: { value: TYPE }, run: () => ({ outputs: { value: { type: "wrong@1#Type", data: null } } }) })) });
  const store = new BuildStore(ws.stateDir);
  try {
    const facts = store.facts(broken);
    assert.equal(facts.length, 1);
    assert.equal(facts[0]?.kind, "failed");
    assert.ok(facts[0]?.kind === "failed" && facts[0].code === "MACHINE_OUTPUT_TYPE_MISMATCH");
  }
  finally { store.close(); }
});

test("Final result write failure preserves the outcome and retries storage, not generation", async (t) => {
  const ws = await fixture(t);
  const id = queue(ws);
  let runs = 0;
  const cap = capability({ kind: "immediate", run: async () => {
    runs++;
    return { type: TYPE, data: "already generated" };
  } });
  const original = ResultsRepository.prototype.write;
  const mocked = t.mock.method(ResultsRepository.prototype, "write", async function (this: ResultsRepository, manifest: ResultManifest): Promise<void> {
    if (manifest.outcome !== "open") throw new DvError("RESULT_WRITE", "Simulated storage outage");
    await original.call(this, manifest);
  });
  await assert.rejects(runWorker(ws, { ...fast, registry: registry(cap) }), { code: "RESULT_WRITE" });
  mocked.mock.restore();
  const view = await buildView(id, ws);
  assert.equal(view?.work.state, "working");
  assert.equal(view?.work.outcome, "complete");
  assert.ok(view?.attention.some((message) => message.includes("generation will not run again")));
  assert.equal((await cancelBuild(id, "Too late", ws)).cancelRequested, false);
  await runWorker(ws, { ...fast, registry: registry(cap) });
  assert.equal(runs, 1);
  assert.equal((await buildView(id, ws))?.result.state, "complete");
});

test("Aborting an in-flight poll preserves its handle for the next worker", async (t) => {
  const ws = await fixture(t);
  const id = queue(ws);
  const stop = new AbortController();
  let submits = 0, polls = 0;
  const cap = capability({ kind: "async", submit: async () => {
    submits++;
    return { handle: "same-remote-task" };
  }, poll: async (handle) => {
    assert.equal(handle, "same-remote-task");
    polls++;
    if (polls === 1) {
      stop.abort();
      throw new DOMException("Worker stopped", "AbortError");
    }
    return { state: "done", value: { type: TYPE, data: "resumed" } };
  } });
  await runWorker(ws, { ...fast, registry: registry(cap), signal: stop.signal });
  assert.equal((await buildView(id, ws))?.work.outcome, "open");
  await runWorker(ws, { ...fast, registry: registry(cap) });
  assert.equal(submits, 1);
  assert.equal((await new ResultsRepository(ws.stateDir).readOutput(id, "result"))?.value.data, "resumed");
  assert.equal(await new ResultsRepository(ws.stateDir).readOutput(id, "constructor"), undefined);
});
