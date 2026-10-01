import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { ExecuteContext } from "../core/capability.ts";
import type { ExecutionDefinition } from "../core/graph.ts";
import type { Json } from "../core/value.ts";
import { dsivioExecutor } from "../gateway/dsivio.ts";
import { gatewayCapabilities } from "../gateway/index.ts";
import { imageType } from "../modules/media/index.ts";
import { buildId } from "./ids.ts";
import { BuildStore } from "./store.ts";
import { ProjectStore } from "./resources.ts";
import { ResultsRepository } from "./results.ts";
import type { ResultManifest } from "./results.ts";
import { runWorker } from "./worker.ts";
import type { BuildRegistry, BuildWorkspace } from "./worker.ts";
import { buildView } from "./observe.ts";
import { buildLines, publicBuildView } from "../cli/build-view.ts";
import { parseOptions } from "../cli/options.ts";

const fakeBinary = fileURLToPath(new URL("../../test/fixtures/fake-dsivio.mjs", import.meta.url));
const launcher = fileURLToPath(new URL("../../bin/dsivio-video.mjs", import.meta.url));
const TYPE = "evidence@1#Text";
const fast = { idleTimeoutMs: 0, tickMs: 1 };

async function fixture(t: test.TestContext): Promise<BuildWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "dv-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, stateDir: join(root, ".dsivio-video") };
}
async function gatewayFixture(t: test.TestContext) {
  const ws = await fixture(t);
  const oldBinary = process.env.DSIVIO_VIDEO_DSIVIO, oldDirectory = process.env.FAKE_DSIVIO_DIR;
  process.env.DSIVIO_VIDEO_DSIVIO = fakeBinary;
  process.env.FAKE_DSIVIO_DIR = ws.root;
  t.after(() => {
    if (oldBinary === undefined) delete process.env.DSIVIO_VIDEO_DSIVIO; else process.env.DSIVIO_VIDEO_DSIVIO = oldBinary;
    if (oldDirectory === undefined) delete process.env.FAKE_DSIVIO_DIR; else process.env.FAKE_DSIVIO_DIR = oldDirectory;
  });
  const store = new ProjectStore(ws.stateDir);
  const context: ExecuteContext = { buildId: buildId(), commandKey: "image", idempotencyKey: "evidence-key", projectRoot: ws.root, workDir: join(ws.root, "work"), store, signal: new AbortController().signal, log() {} };
  return { ...ws, store, context, async configure(config: Json): Promise<void> { await writeFile(join(ws.root, "config.json"), JSON.stringify(config)); }, async request(): Promise<Json> {
    const capability = gatewayCapabilities.find(item => item.name === "gateway/image")!;
    const resolved = await capability.resolve({ model: "openai/gpt-image-2", arguments: { prompt: "Generate a product image", aspectRatio: "9:16" } }, { projectRoot: ws.root });
    assert.ok(resolved.ok);
    return resolved.request;
  } };
}
function queue(ws: BuildWorkspace): string {
  const definition: ExecutionDefinition = { schema: "dsivio-video.definition/1", author: "author.dvml", run: "run.dvrun", targets: ["hero.image"], seeds: {}, forwarded: {}, reused: {}, modules: [], steps: [{ key: "image", label: "hero", producer: "evidence@1#generate", inputs: {}, results: { image: "image-result" }, resultTypes: { image: TYPE } }], outputs: { "hero.image": { record: "image-result", type: TYPE } } };
  const id = buildId(), store = new BuildStore(ws.stateDir);
  try { store.insert({ id, definition, title: "Paid evidence", author: definition.author, run: definition.run, created: new Date().toISOString(), state: "working", outcome: "open", stopReason: null, cancelRequested: false }); }
  finally { store.close(); }
  return id;
}
async function inspect(ws: BuildWorkspace, id: string, json = false): Promise<string> {
  const child = spawn(process.execPath, [launcher, "inspect", id, "--workspace", ws.root, "--verbose", ...(json ? ["--json"] : [])], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data: string) => { stdout += data; }); child.stderr.on("data", (data: string) => { stderr += data; });
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  return stdout;
}

test("Dsivio completion collects bytes and includes a provider receipt absent at submit", async (t) => {
  const f = await gatewayFixture(t);
  await f.configure({ remoteId: null });
  const executor = dsivioExecutor("image"), submitted = await executor.submit(await f.request(), f.context);
  await f.configure({ remoteId: "provider-completed-task" });
  const polled = await executor.poll(submitted.handle, f.context);
  assert.equal(polled.receipt, "provider-completed-task");
  assert.ok(polled.state === "done");
  assert.equal(polled.value.type, imageType);
  assert.ok(polled.value.data !== null && typeof polled.value.data === "object" && !Array.isArray(polled.value.data) && typeof polled.value.data.$resource === "string");
  assert.equal(f.store.has({ $resource: polled.value.data.$resource, bytes: Number(polled.value.data.bytes), mime: String(polled.value.data.mime) }), true);
});

test("Dsivio failure exposes the paid provider receipt without implying no charge", async (t) => {
  const f = await gatewayFixture(t);
  await f.configure({ remoteId: null });
  const executor = dsivioExecutor("image"), submitted = await executor.submit(await f.request(), f.context);
  await f.configure({ finalStatus: "failed", remoteId: "provider-failed-task", error: "Generation failed" });
  const polled = await executor.poll(submitted.handle, f.context);
  assert.equal(polled.receipt, "provider-failed-task");
  assert.ok(polled.state === "failed");
  assert.equal(polled.charged, "maybe");
});

test("Late provider evidence survives restart and is linked to public outputs in status and inspect", async (t) => {
  const ws = await fixture(t), id = queue(ws), stopped = new AbortController();
  let submits = 0, polls = 0;
  const summary = { model: "vendor/image-model", params: { ratio: "9:16", quality: "high" }, prompt: "A perfume bottle" };
  const registry: BuildRegistry = {
    findProducer: () => ({ inputs: {}, outputs: { image: TYPE }, run: () => ({ needs: { image: { capability: "evidence/image", request: { ...summary, apiKey: "DO_NOT_PUBLISH" } } } }) }),
    findCapability: () => ({ name: "evidence/image", returns: TYPE, resolve: async (request) => ({ ok: true, request, backend: "arbitrary-backend", summary, cost: "paid" }), executor: { kind: "async", submit: async () => { submits++; return { handle: { private: "DO_NOT_PUBLISH", taskId: "opaque-backend-field" }, task: "local-task-45397", receipt: undefined }; }, poll: async () => {
      polls++;
      if (polls === 1) { stopped.abort(); return { state: "pending", retryAfterMs: 0, receipt: "provider-pending" }; }
      return { state: "done", value: { type: TYPE, data: "generated output" }, receipt: "provider-final" };
    } } }),
  };
  await runWorker(ws, { ...fast, registry, signal: stopped.signal });
  const results = new ResultsRepository(ws.stateDir), open = await results.read(id);
  assert.equal(open?.operations[0]?.receipt, "provider-pending");
  assert.equal(open?.operations[0]?.task, "local-task-45397");
  await runWorker(ws, { ...fast, registry });
  assert.equal(submits, 1);
  const finished = await results.read(id);
  assert.deepEqual(finished?.operations[0], { outputs: ["hero.image"], backend: "arbitrary-backend", model: "vendor/image-model", task: "local-task-45397", receipt: "provider-final", phase: "done", progress: null, error: null, summary });
  const options = parseOptions(["--verbose"], { usage: "status", min: 0, max: 0 });
  const view = await buildView(id, ws);
  assert.ok(view);
  const publicView = publicBuildView(view, options);
  assert.deepEqual(publicView?.operations?.[0], finished?.operations[0]);
  assert.doesNotMatch(JSON.stringify(publicView), /DO_NOT_PUBLISH|opaque-backend-field/);
  const human = buildLines(view, options).join("\n");
  assert.match(human, /hero\.image.*arbitrary-backend.*vendor\/image-model.*task local-task-45397.*receipt provider-final.*done/);
  const inspected = await inspect(ws, id);
  assert.match(inspected, /hero\.image.*arbitrary-backend.*vendor\/image-model.*task local-task-45397.*receipt provider-final.*done/);
  assert.match(inspected, /ratio=.*9:16/);
  const json = JSON.parse(await inspect(ws, id, true));
  assert.deepEqual(json.resultView.evidence[0], finished?.operations[0]);
});

test("A terminal failed poll replaces earlier evidence with its final provider receipt", async (t) => {
  const ws = await fixture(t), id = queue(ws);
  const registry: BuildRegistry = {
    findProducer: () => ({ inputs: {}, outputs: { image: TYPE }, run: () => ({ needs: { image: { capability: "evidence/image", request: {} } } }) }),
    findCapability: () => ({ name: "evidence/image", returns: TYPE, resolve: async (request) => ({ ok: true, request, backend: "test", summary: {}, cost: "paid" }), executor: { kind: "async", submit: async () => ({ handle: "opaque", task: "failed-local-task", receipt: "initial-provider-receipt" }), poll: async () => ({ state: "failed", code: "GENERATION_FAILED", message: "Provider failed", charged: "maybe", receipt: "final-provider-receipt" }) } }),
  };
  await runWorker(ws, { ...fast, registry });
  const evidence = (await new ResultsRepository(ws.stateDir).read(id))?.operations[0];
  assert.equal(evidence?.receipt, "final-provider-receipt");
  assert.equal(evidence?.task, "failed-local-task");
  assert.deepEqual(evidence?.outputs, ["hero.image"]);
  assert.equal(evidence?.error?.code, "GENERATION_FAILED");
});

test("Verbose inspect identifies each paid task even without a provider receipt yet", async (t) => {
  const ws = await fixture(t), id = buildId(), results = new ResultsRepository(ws.stateDir);
  const manifest: ResultManifest = { id, title: null, author: "author", run: "run", targets: ["hero.image"], createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), outcome: "failed", failure: { code: "UNKNOWN", message: "Task is still remote" }, outputs: {}, operations: [{ outputs: ["hero.image"], backend: "dsivio", model: "gpt-image-2.5-flare", task: "45397ece-remote-task", receipt: null, phase: "submitted", progress: null, error: null, summary: { params: { ratio: "9:16" } } }] };
  await results.write(manifest);
  const human = await inspect(ws, id);
  assert.match(human, /hero\.image.*dsivio.*gpt-image-2\.5-flare.*task 45397ece-remote-task.*submitted/);
});
