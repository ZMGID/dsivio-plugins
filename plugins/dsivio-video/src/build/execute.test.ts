import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BuildMachine } from "../core/machine.ts";
import { DvError } from "../core/errors.ts";
import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import type { ExecutionDefinition } from "../core/graph.ts";
import { ProjectStore } from "./resources.ts";
import { executeCommand, studioExecutionPolicy } from "./execute.ts";
import type { ExecutionRegistry } from "./execute.ts";

const TYPE = "test@1#Text";
function machine(): BuildMachine {
  const definition: ExecutionDefinition = {
    schema: "dsivio-video.definition/1", author: "a.dvml", run: "a.dvrun", modules: ["test@1"],
    targets: ["out"], seeds: {}, forwarded: {}, reused: {},
    steps: [{ key: "owner", label: "owner", producer: "test@1#producer", inputs: {}, results: { value: "result" }, resultTypes: { value: TYPE } }],
    outputs: { out: { record: "result", type: TYPE } },
  };
  return new BuildMachine(definition);
}
async function context(t: test.TestContext): Promise<ExecuteContext> {
  const root = await mkdtemp(join(tmpdir(), "dv-execute-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { buildId: "studio", commandKey: "command", idempotencyKey: "command", projectRoot: root, store: new ProjectStore(join(root, ".dsivio-video")), workDir: join(root, "scratch"), signal: new AbortController().signal, log() {} };
}
function registry(capability: CapabilityDef, badOutput = false): ExecutionRegistry {
  return {
    findCapability: name => name === capability.name ? capability : undefined,
    findProducer: () => ({ inputs: {}, outputs: { value: TYPE }, run: () => badOutput ? { outputs: { value: { type: TYPE, data: 12 } } } : { needs: { value: { capability: capability.name, request: {} } } } }),
    findModule: () => ({ id: "test@1", summary: "test", surfaces: {}, producers: {}, types: { Text: { summary: "text", validate(data) { if (typeof data !== "string") throw new DvError("TYPE_INVALID", "Text requires a string"); } } } }),
  };
}
function capability(name = "local/inspect"): CapabilityDef {
  return { name, returns: TYPE, async resolve(request) { return { ok: true, cost: "local", backend: "local", request, summary: {} }; }, executor: { kind: "immediate", async run() { return { type: TYPE, data: "prepared" }; } } };
}

test("Studio rejects paid and unapproved requests before registry lookup or resolve", async t => {
  const executeContext = await context(t);
  for (const name of ["gateway/video", "local/third-party"]) {
    const cap = capability(name);
    let lookups = 0, resolves = 0;
    cap.resolve = async () => { resolves++; throw new Error("must not resolve"); };
    const reg = registry(cap);
    const m = machine();
    const producerFact = await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext });
    m.accept(producerFact);
    reg.findCapability = () => { lookups++; return cap; };
    const fact = await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext, policy: studioExecutionPolicy });
    assert.equal(fact.kind, "failed");
    if (fact.kind !== "failed") throw new Error("expected failure");
    assert.equal(fact.code, "STUDIO_CAPABILITY_MISSING");
    assert.match(fact.message, /owner\.value/);
    assert.equal(lookups, 0);
    assert.equal(resolves, 0);
    m.accept(fact);
    assert.equal(m.state, "failed");
  }
});

test("Studio verifies local cost and immediate execution after resolving approved names", async t => {
  const executeContext = await context(t);
  for (const mode of ["paid", "async"] as const) {
    const cap = capability();
    let executed = false;
    if (mode === "paid") cap.resolve = async request => ({ ok: true, cost: "paid", backend: "gateway", request, summary: {} });
    cap.executor = mode === "async"
      ? { kind: "async", async submit() { executed = true; return { handle: {} }; }, async poll() { throw new Error("must not poll"); } }
      : { kind: "immediate", async run() { executed = true; return { type: TYPE, data: "wrong" }; } };
    const reg = registry(cap);
    const m = machine();
    m.accept(await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext }));
    const fact = await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext, policy: studioExecutionPolicy });
    assert.equal(fact.kind, "failed");
    if (fact.kind === "failed") assert.equal(fact.code, "STUDIO_CAPABILITY_MISSING");
    assert.equal(executed, false);
  }
});

test("Invalid producer data and thrown executor errors return validated failed facts", async t => {
  const executeContext = await context(t);
  const cap = capability();
  const bad = machine();
  const invalid = await executeCommand(bad, bad.ready()[0]!, { registry: registry(cap, true), resolveContext: { projectRoot: executeContext.projectRoot }, executeContext });
  assert.equal(invalid.kind, "failed");
  if (invalid.kind === "failed") assert.equal(invalid.code, "TYPE_INVALID");
  bad.accept(invalid);
  const m = machine();
  const reg = registry(cap);
  m.accept(await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext }));
  cap.executor = { kind: "immediate", async run() { throw new DvError("TOOL_FAILED", "specific failure"); } };
  const failed = await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext });
  assert.deepEqual(failed, { kind: "failed", command: m.ready()[0]!.key, code: "TOOL_FAILED", message: "specific failure" });
  m.accept(failed);
  assert.equal(m.state, "failed");
});

test("Produced and fulfilled facts retain machine typing and do not accept themselves", async t => {
  const executeContext = await context(t);
  const reg = registry(capability());
  const m = machine();
  const produced = await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext });
  assert.equal(m.ready()[0]?.kind, "produce");
  m.accept(produced);
  const fulfilled = await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext, policy: studioExecutionPolicy });
  assert.equal(fulfilled.kind, "fulfilled");
  m.accept(fulfilled);
  assert.deepEqual(m.valueOf("result"), { type: TYPE, data: "prepared" });
  assert.equal(m.state, "complete");
});

test("Native tool AbortError remains a cancellation fact for the worker", async t => {
  const executeContext = await context(t);
  const cap = capability();
  cap.executor = { kind: "immediate", async run() { throw Object.assign(new Error("Tool stopped"), { name: "AbortError" }); } };
  const reg = registry(cap);
  const m = machine();
  m.accept(await executeCommand(m, m.ready()[0]!, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext }));
  const command = m.ready()[0]!;
  const fact = await executeCommand(m, command, { registry: reg, resolveContext: { projectRoot: executeContext.projectRoot }, executeContext });
  assert.deepEqual(fact, { kind: "failed", command: command.key, code: "ABORTED", message: "Tool stopped" });
  m.accept(fact);
});
