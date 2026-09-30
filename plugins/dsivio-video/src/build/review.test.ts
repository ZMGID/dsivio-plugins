import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapabilityDef } from "../core/capability.ts";
import type { ExecutionDefinition } from "../core/graph.ts";
import { DvError } from "../core/errors.ts";
import { buildId } from "./ids.ts";
import { BuildStore } from "./store.ts";
import { ResultsRepository } from "./results.ts";
import type { ResultManifest } from "./results.ts";
import { ensureWorker, submitBuild } from "./submit.ts";
import { runWorker, stopWorker } from "./worker.ts";
import type { BuildRegistry, BuildWorkspace } from "./worker.ts";
import { buildView, workerState } from "./observe.ts";

const TYPE = "review@1#Text";
const fast = { idleTimeoutMs: 0, tickMs: 1, unavailableRetryMs: 0 };
async function fixture(t: test.TestContext): Promise<BuildWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "dv-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, stateDir: join(root, ".dsivio-video") };
}
function definition(): ExecutionDefinition {
  return { schema: "dsivio-video.definition/1", author: "author", run: "run", targets: ["output"], seeds: {}, forwarded: {}, reused: {}, modules: [], steps: [{ key: "step", label: "Generate", producer: "review@1#generate", inputs: {}, results: { value: "record" }, resultTypes: { value: TYPE } }], outputs: { output: { record: "record", type: TYPE } } };
}
function queue(ws: BuildWorkspace): string {
  const id = buildId(), def = definition(), store = new BuildStore(ws.stateDir);
  try { store.insert({ id, definition: def, title: null, author: def.author, run: def.run, created: new Date().toISOString(), state: "working", outcome: "open", stopReason: null, cancelRequested: false }); }
  finally { store.close(); }
  return id;
}
function registry(executor: CapabilityDef["executor"]): BuildRegistry {
  const capability: CapabilityDef = { name: "review/generate", returns: TYPE, resolve: async (request) => ({ ok: true, request, backend: "review", summary: {}, cost: "paid" }), executor };
  return { findProducer: () => ({ inputs: {}, outputs: { value: TYPE }, run: () => ({ needs: { value: { capability: capability.name, request: {} } } }) }), findCapability: () => capability };
}

test("Informational PID files cannot suppress a worker or cause PID reuse decisions", async (t) => {
  const ws = await fixture(t), id = queue(ws);
  await writeFile(join(ws.stateDir, "runtime", "worker.json"), JSON.stringify({ pid: process.pid, startedAt: "not-a-worker" }));
  await runWorker(ws, { ...fast, registry: registry({ kind: "immediate", run: async () => ({ type: TYPE, data: "executed" }) }) });
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.outcome, "complete");
});

test("A result seed is staged and invisible to the worklist until startup succeeds", async (t) => {
  const ws = await fixture(t);
  const original = ResultsRepository.prototype.write;
  let visible: string[] = [], stagedId = "";
  t.mock.method(ResultsRepository.prototype, "write", async function (this: ResultsRepository, manifest: ResultManifest): Promise<void> {
    stagedId = manifest.id;
    const store = new BuildStore(ws.stateDir);
    try { visible = store.working().map((build) => build.id); } finally { store.close(); }
    await original.call(this, manifest);
  });
  await assert.rejects(submitBuild({ plan: { definition: definition(), assets: new Map() }, workspace: ws }, { launcherPath: join(ws.root, "missing.mjs"), startTimeoutMs: 0 }), { code: "WORKER_START_FAILED" });
  assert.deepEqual(visible, []);
  const store = new BuildStore(ws.stateDir);
  try { assert.equal(store.read(stagedId), undefined); } finally { store.close(); }
});

test("A submit aborted after sending is interrupted, never queued for another payment", async (t) => {
  const ws = await fixture(t), id = queue(ws), stop = new AbortController();
  let submits = 0;
  const fake = registry({ kind: "async", submit: async () => {
    submits++;
    stop.abort();
    throw new DvError("GATEWAY_UNAVAILABLE", "Connection closed after sending");
  }, poll: async () => { throw new Error("No handle was received"); } });
  await runWorker(ws, { ...fast, signal: stop.signal, registry: fake });
  const store = new BuildStore(ws.stateDir);
  try { assert.equal(store.operations(id)[0]?.phase, "submitting"); } finally { store.close(); }
  await runWorker(ws, { ...fast, registry: fake });
  assert.equal(submits, 1);
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.failure?.code, "SUBMISSION_INTERRUPTED");
});

test("An ABORTED poll retains the submitted task handle without a failed fact", async (t) => {
  const ws = await fixture(t), id = queue(ws);
  await runWorker(ws, { ...fast, registry: registry({ kind: "async", submit: async () => ({ handle: "existing-task" }), poll: async () => { throw new DvError("ABORTED", "Poll interrupted"); } }) });
  const store = new BuildStore(ws.stateDir);
  try {
    assert.equal(store.operations(id)[0]?.phase, "submitted");
    assert.equal(store.operations(id)[0]?.handle, "existing-task");
    assert.equal(store.facts(id).some((fact) => fact.kind === "failed"), false);
  } finally { store.close(); }
});

test("Concurrent exporters publish exactly once and never replace an existing file or directory", async (t) => {
  const ws = await fixture(t), id = buildId(), results = new ResultsRepository(ws.stateDir);
  const resource = { $resource: "res_0123456789abcdef0123456789abcdef", bytes: 5, mime: "application/octet-stream" };
  await mkdir(join(ws.stateDir, "store"), { recursive: true });
  await writeFile(join(ws.stateDir, "store", resource.$resource), "bytes");
  await results.write({ id, title: null, author: "author", run: "run", targets: [], createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), outcome: "complete", failure: null, operations: [], outputs: { scalar: { type: TYPE, class: "scalar", value: "winner" }, composite: { type: TYPE, class: "composite", value: { attachment: resource } } } });
  for (const output of ["scalar", "composite"]) {
    const destination = join(ws.root, output);
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => results.exportOutput(id, output, destination)));
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    for (const attempt of attempts) if (attempt.status === "rejected") assert.equal(attempt.reason.code, "EXPORT_EXISTS");
    if (output === "scalar") assert.equal(await readFile(destination, "utf8"), '"winner"\n');
    else assert.equal(await readFile(join(destination, "files", resource.$resource), "utf8"), "bytes");
  }
});

test("Lease freshness, not a live or malformed PID file, governs startup and status", async (t) => {
  const ws = await fixture(t), store = new BuildStore(ws.stateDir);
  try {
    assert.equal(store.acquireWorker("existing-owner", 7654321), true);
    await writeFile(join(ws.stateDir, "runtime", "worker.json"), "{invalid informational JSON");
    await ensureWorker(ws, { launcherPath: join(ws.root, "missing.mjs"), startTimeoutMs: 0 });
    assert.equal((await workerState(ws)).running, true);
    store.db.prepare("UPDATE worker_owner SET heartbeat_at=0").run();
    assert.equal((await workerState(ws)).running, false);
    assert.equal(await stopWorker(ws), false);
  } finally { store.close(); }
});

test("A replaced owner cannot submit after an asynchronous payment gate resolves", async (t) => {
  const ws = await fixture(t), id = queue(ws);
  let entered!: () => void, release!: () => void;
  const resolving = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let submits = 0;
  const fake = registry({ kind: "immediate", run: async () => { submits++; return { type: TYPE, data: "once" }; } });
  const capability = fake.findCapability("review/generate")!;
  const originalResolve = capability.resolve;
  capability.resolve = async (request, context) => { entered(); await gate; return originalResolve(request, context); };
  const first = runWorker(ws, { ...fast, registry: fake });
  await resolving;
  const store = new BuildStore(ws.stateDir);
  try { store.db.prepare("UPDATE worker_owner SET heartbeat_at=0").run(); } finally { store.close(); }
  try {
    await runWorker(ws, { ...fast, registry: registry({ kind: "immediate", run: async () => { submits++; return { type: TYPE, data: "new owner" }; } }) });
    assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.outcome, "complete");
  } finally { release(); await first; }
  assert.equal(submits, 1);
});

test("Idle release rechecks the worklist, and activation cannot target a retired owner", async (t) => {
  const ws = await fixture(t), store = new BuildStore(ws.stateDir);
  try {
    assert.equal(store.acquireWorker("first-owner", process.pid), true);
    assert.equal(store.acquireWorker("competitor", process.pid), false);
    assert.deepEqual(store.working(), []);
    const id = queue(ws);
    assert.equal(store.releaseWorkerIfIdle("first-owner"), false);
    assert.equal(store.workerOwner()?.token, "first-owner");
    store.db.prepare("UPDATE builds SET state='staged' WHERE id=?").run(id);
    assert.equal(store.releaseWorkerIfIdle("first-owner"), true);
    assert.equal(store.activate(id), false);
    assert.equal(store.read(id)?.state, "staged");
    assert.equal(store.acquireWorker("next-owner", process.pid), true);
    assert.equal(store.activate(id), true);
    assert.equal(store.releaseWorkerIfIdle("next-owner"), false);
    assert.equal(store.read(id)?.state, "working");
  } finally { store.close(); }
});

test("Post-activation reporting failure never deletes a queued Build or its result", async (t) => {
  const ws = await fixture(t), owner = new BuildStore(ws.stateDir);
  owner.acquireWorker("existing-owner", process.pid);
  owner.close();
  const original = BuildStore.prototype.activate;
  let id = "";
  t.mock.method(BuildStore.prototype, "activate", function (this: BuildStore, build: string): boolean {
    const activated = original.call(this, build);
    if (activated) { id = build; throw new DvError("REPORTING_FAILED", "Connection closed after commit"); }
    return activated;
  });
  await assert.rejects(submitBuild({ plan: { definition: definition(), assets: new Map() }, workspace: ws }), { code: "REPORTING_FAILED" });
  const store = new BuildStore(ws.stateDir);
  try { assert.equal(store.read(id)?.state, "working"); } finally { store.close(); }
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.outcome, "open");
});

test("Stop is a durable request that interrupts a paid submit without signalling its PID", async (t) => {
  const ws = await fixture(t), id = queue(ws);
  let entered!: () => void;
  const submitting = new Promise<void>((resolve) => { entered = resolve; });
  let submits = 0;
  const worker = runWorker(ws, { ...fast, registry: registry({ kind: "async", submit: async (_request, context) => {
    submits++;
    entered();
    await new Promise<void>((_resolve, reject) => { context.signal.addEventListener("abort", () => reject(new DvError("ABORTED", "Stopped after submission began")), { once: true }); });
    throw new Error("Unreachable");
  }, poll: async () => { throw new Error("No task handle"); } }) });
  await submitting;
  assert.equal((await workerState(ws)).running, true);
  assert.equal(await stopWorker(ws), true);
  await worker;
  assert.equal((await workerState(ws)).running, false);
  const store = new BuildStore(ws.stateDir);
  try { assert.equal(store.operations(id)[0]?.phase, "submitting"); } finally { store.close(); }
  await runWorker(ws, { ...fast, registry: registry({ kind: "async", submit: async () => { submits++; return { handle: "must-not-submit" }; }, poll: async () => { throw new Error("No task handle"); } }) });
  assert.equal(submits, 1);
  assert.equal((await new ResultsRepository(ws.stateDir).read(id))?.failure?.code, "SUBMISSION_INTERRUPTED");
});

test("Progress has a stable step total and only counts fully realized steps", async (t) => {
  const ws = await fixture(t), id = queue(ws), store = new BuildStore(ws.stateDir);
  try {
    assert.deepEqual((await buildView(id, ws))?.work.steps, { total: 1, done: 0 });
    store.commitFact(id, { kind: "produced", command: "produce:step", outputs: {}, needs: { value: { capability: "review/generate", request: {} } } });
    assert.deepEqual((await buildView(id, ws))?.work.steps, { total: 1, done: 0 });
    store.commitFact(id, { kind: "fulfilled", command: "fulfil:step.value", value: { type: TYPE, data: "realized" } });
    assert.deepEqual((await buildView(id, ws))?.work.steps, { total: 1, done: 1 });
  } finally { store.close(); }
});
