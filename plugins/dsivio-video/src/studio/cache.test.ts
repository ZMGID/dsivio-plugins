import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import type { Json, ResourceRef, Value } from "../core/value.ts";
import { isResourceRef } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import type { ExecutionRegistry } from "../build/execute.ts";
import { validateExecutionValue } from "../build/execute.ts";
import { ProjectStore } from "../build/resources.ts";
import { StudioCache } from "./cache.ts";

const TYPE = "test@1#Bytes";
const registry: ExecutionRegistry = {
  findProducer() { return undefined; }, findCapability() { return undefined; },
  findModule: id => id === "test@1" ? { id, summary: "test", producers: {}, surfaces: {}, types: {
    Bytes: { summary: "resource", validate(data) { if (!isResourceRef(data) || !Number.isSafeInteger(data.bytes) || typeof data.mime !== "string") throw new DvError("TYPE_INVALID", "Expected resource"); } },
  } } : undefined,
};
const cap: CapabilityDef = {
  name: "local/inspect", returns: TYPE,
  async resolve(request) { return { ok: true, cost: "local", backend: "local", request, summary: {} }; },
  executor: { kind: "immediate", async run() { throw new Error("injected runner required"); } },
};
async function fixture(t: test.TestContext): Promise<{ root: string; cache: StudioCache; context: ExecuteContext; store: ProjectStore }> {
  const root = await mkdtemp(join(tmpdir(), "dv-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(join(root, ".dsivio-video"));
  const cache = new StudioCache({ stateDir: join(root, ".dsivio-video"), resources: store, registry, implementationVersions: { [cap.name]: "test/1;tool/1" } });
  const context: ExecuteContext = { buildId: "studio", commandKey: "one", idempotencyKey: "one", projectRoot: root, store, workDir: join(root, "scratch"), signal: new AbortController().signal, log() {} };
  return { root, cache, context, store };
}
const validate = (value: Value): void => validateExecutionValue(registry, value);

async function output(root: string, store: ProjectStore, text: string): Promise<Value> {
  const file = join(root, "output.bin");
  await writeFile(file, text);
  const ref = await store.putFile(file, "application/octet-stream");
  return { type: TYPE, data: ref as unknown as Json };
}

test("Content-identical random resources persistently hit; exact request, bytes, MIME and pins invalidate", async t => {
  const { root, cache, context, store } = await fixture(t);
  const file = join(root, "source.bin");
  await writeFile(file, "same");
  const first = await store.putFile(file, "application/octet-stream");
  const second = await store.putFile(file, "application/octet-stream");
  let calls = 0;
  const run = async (): Promise<Value> => { calls++; return output(root, store, `output ${calls}`); };
  const one = await cache.execute(cap, { source: first as unknown as Json, exact: 1 }, context, validate, run);
  const restored = new StudioCache({ stateDir: join(root, ".dsivio-video"), resources: store, registry, implementationVersions: { [cap.name]: "test/1;tool/1" } });
  assert.deepEqual(await restored.execute(cap, { exact: 1, source: second as unknown as Json }, context, validate, run), one);
  assert.equal(calls, 1);
  await cache.execute(cap, { source: first as unknown as Json, exact: 2 }, context, validate, run);
  assert.equal(calls, 2);
  await writeFile(store.pathOf(first), "diff");
  await cache.execute(cap, { source: first as unknown as Json, exact: 1 }, context, validate, run);
  assert.equal(calls, 3);
  await cache.execute(cap, { source: { ...second, mime: "image/png" }, exact: 1 }, context, validate, run);
  assert.equal(calls, 4);
  const versioned = new StudioCache({ stateDir: join(root, ".dsivio-video"), resources: store, registry, implementationVersions: { [cap.name]: "test/1;tool/2" } });
  await versioned.execute(cap, { source: second as unknown as Json, exact: 1 }, context, validate, run);
  assert.equal(calls, 5);
});

test("Missing or altered cached bytes and invalid TypeDef data are prepared again", async t => {
  const { root, cache, context, store } = await fixture(t);
  let calls = 0;
  const run = async (): Promise<Value> => { calls++; return output(root, store, `data${calls}`); };
  const one = await cache.execute(cap, {}, context, validate, run);
  await rm(store.pathOf(one.data as unknown as ResourceRef));
  const two = await cache.execute(cap, {}, context, validate, run);
  assert.equal(calls, 2);
  assert.notDeepEqual(two, one);
  await writeFile(store.pathOf(two.data as unknown as ResourceRef), "other");
  await cache.execute(cap, {}, context, validate, run);
  assert.equal(calls, 3);
  const entryFile = join(cache.directory, (await readdir(cache.directory)).find(name => name.endsWith(".json"))!);
  const entry = JSON.parse(await readFile(entryFile, "utf8"));
  entry.value.data = "not a resource";
  await writeFile(entryFile, JSON.stringify(entry));
  const four = await cache.execute(cap, {}, context, validate, run);
  assert.equal(calls, 4);
  validate(four);
});

test("Source ingestion reuses content identity and preserves readable owned bytes", async t => {
  const { root, cache, store } = await fixture(t);
  const file = join(root, "source.bin");
  await writeFile(file, "source");
  const ref: ResourceRef = { $resource: "compile-random", bytes: 6, mime: "application/octet-stream" };
  const first = await cache.ingestSource(ref, file);
  const second = await cache.ingestSource({ ...ref, $resource: "another-random" }, file);
  assert.deepEqual(second, first);
  assert.equal(await readFile(store.pathOf(second), "utf8"), "source");
  await writeFile(file, "change");
  assert.notDeepEqual(await cache.ingestSource(ref, file), first);
  await rm(file);
  await assert.rejects(cache.ingestSource(ref, file), { code: "RESOURCE_READ" });
});

test("Single-flight keeps work alive when one consumer leaves, and cancels only the last", async t => {
  const { root, cache, context, store } = await fixture(t);
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const a = new AbortController(), b = new AbortController();
  let calls = 0;
  let workSignal: AbortSignal | undefined;
  const run = async (execution: ExecuteContext): Promise<Value> => {
    calls++; workSignal = execution.signal;
    await mkdir(execution.workDir, { recursive: true });
    await writeFile(join(execution.workDir, "preparation.bin"), "shared");
    started.resolve();
    await gate.promise;
    return output(root, store, await readFile(join(execution.workDir, "preparation.bin"), "utf8"));
  };
  const first = cache.execute(cap, { shared: 1 }, { ...context, signal: a.signal }, validate, run);
  const second = cache.execute(cap, { shared: 1 }, { ...context, signal: b.signal }, validate, run);
  await started.promise;
  const cancelled = assert.rejects(first, { code: "ABORTED" });
  a.abort();
  await cancelled;
  await rm(context.workDir, { recursive: true, force: true });
  assert.equal(workSignal?.aborted, false);
  gate.resolve();
  assert.equal(await readFile(store.pathOf((await second).data as unknown as ResourceRef), "utf8"), "shared");
  assert.equal(calls, 1);
  assert.equal((await readdir(cache.directory)).filter(name => name.endsWith(".json")).length, 1);

  const last = new AbortController();
  const lastStarted = Promise.withResolvers<void>();
  const workAborted = Promise.withResolvers<void>();
  const blocked = cache.execute(cap, { shared: 2 }, { ...context, signal: last.signal }, validate, async execution => {
    lastStarted.resolve();
    execution.signal.addEventListener("abort", () => { workAborted.resolve(); }, { once: true });
    await workAborted.promise;
    throw new DvError("ABORTED", "last consumer left");
  });
  await lastStarted.promise;
  const rejected = assert.rejects(blocked, { code: "ABORTED" });
  last.abort();
  await Promise.all([rejected, workAborted.promise]);
  const replacement = await cache.execute(cap, { shared: 2 }, context, validate, () => output(root, store, "replacement"));
  assert.equal(await readFile(store.pathOf(replacement.data as unknown as ResourceRef), "utf8"), "replacement");
  assert.equal((await readdir(cache.directory)).filter(name => name.endsWith(".json")).length, 2);
});
