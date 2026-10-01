import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { gatewayCapabilities } from "./index.ts";
import { gatewayModels, selectBackend } from "./backend.ts";
import { withFactsRevision, validateAndResolve, ModelArgumentError } from "./description.ts";
import type { ModelDescription } from "./description.ts";
import type { ExecuteContext, ResolveContext } from "../core/capability.ts";
import type { Json } from "../core/value.ts";
import { canonicalJson } from "../core/value.ts";
import { localAsrModel, localTranscribeExecutor, transcriptFromTask } from "../asr/backend.ts";
import { frozenRequest, validateRequest } from "./validate.ts";
function descriptor(extra: Partial<ModelDescription> = {}): ModelDescription {
  return withFactsRevision({ descriptionVersion: 1, identity: "p/video", operation: "video", factsComplete: true, arguments: { prompt: { dataType: "string", required: true, minLength: 1 }, audio: { dataType: "boolean", defaultValue: true }, seed: { dataType: "integer", minimum: 0, maximum: 10 }, duration: { dataType: "integer", allowed: [20], minimum: 1, maximum: 5, specialValues: ["auto"] }, aspectRatio: { dataType: "string" }, voice: { dataType: "string", defaultValue: "default" }, voiceReference: { dataType: "mediaList", maxCount: 1 }, images: { dataType: "mediaList", maxCount: 1, maxBytes: 10, minWidth: 2, mimePatterns: ["image/*"] } }, constraints: [{ ruleId: "voice-source", check: "excludeTogether", arguments: ["voice", "voiceReference"] }, { ruleId: "noaudio-needs-seed", when: { equals: { argument: "audio", value: false } }, check: "require", arguments: ["seed"] }], products: { mediaKind: "video" }, lifecycle: { remoteCancel: "unsupported" }, billingInfo: null, ...extra });
}
test("finite rules preserve false/zero and presence through default revalidation", () => {
  const d = descriptor(), source = { source: { $pending: "voice.audio", type: "Audio" }, attributes: {} };
  const args = validateAndResolve(d, { prompt: "hello", audio: false, seed: 0, duration: "auto", voiceReference: [source] });
  assert.equal(args.audio, false); assert.equal(args.seed, 0); assert.equal(args.voice, "default");
  assert.deepEqual(validateAndResolve(d, args, { providedArguments: ["prompt", "audio", "seed", "duration", "voiceReference"] }), args);
  assert.throws(() => validateAndResolve(d, { prompt: "hello", audio: false }), (error: unknown) => error instanceof ModelArgumentError && error.detail.ruleId === "noaudio-needs-seed");
  assert.throws(() => validateAndResolve(d, { prompt: "hello", voice: "explicit", voiceReference: [source] }), { code: "MODEL_CONSTRAINT_FAILED" });
  assert.equal(validateAndResolve(d, { prompt: "hello", duration: 20 }).duration, 20);
  assert.throws(() => validateAndResolve(d, { prompt: "hello", duration: 10 }), { code: "MODEL_ARGUMENT_INVALID" });
});
test("aliases are one input identity and revisions are JCS content hashes", () => {
  const d = descriptor();
  assert.equal(validateAndResolve(d, { prompt: "hello", aspect_ratio: "1:1" }).aspectRatio, "1:1");
  assert.throws(() => validateAndResolve(d, { prompt: "hello", aspect_ratio: "1:1", aspectRatio: "1:1" }), { code: "MODEL_ARGUMENT_DUPLICATE" });
  assert.throws(() => validateAndResolve(d, { prompt: "hello", typo: 0 }), { code: "MODEL_ARGUMENT_UNSUPPORTED" });
  const reverse = Object.fromEntries(Object.entries(d).reverse());
  assert.equal(withFactsRevision(reverse).factsRevision, d.factsRevision);
  assert.notEqual(descriptor({ factsComplete: false }).factsRevision, d.factsRevision);
  assert.throws(() => validateAndResolve({ ...d, factsRevision: "sha256:stale" }, { prompt: "hello" }), { code: "MODEL_DESCRIPTION_INVALID" });
  assert.equal(canonicalJson({ z: -0, a: 1e30 }), '{"a":1e+30,"z":0}');
  assert.throws(() => canonicalJson("\ud800"), /surrogate/);
});
test("Pending delays measured facts only, never known list quotas", () => {
  const d = descriptor(), pending = { source: { $pending: "hero.image", type: "Image" }, attributes: {} };
  validateAndResolve(d, { prompt: "hello", images: [pending] });
  assert.throws(() => validateAndResolve(d, { prompt: "hello", images: [pending, pending] }), { code: "MODEL_ARGUMENT_INVALID" });
  assert.throws(() => validateAndResolve(d, { prompt: "hello", images: [{ source: "/a.png", attributes: {}, mime: "image/png", bytes: 11, width: 2 }] }, { materialized: true }), { code: "MODEL_ARGUMENT_INVALID" });
  assert.throws(() => validateAndResolve(d, { prompt: "hello", images: [{ source: "/a.png", attributes: {}, mime: "image/png", bytes: 2, width: 1 }] }, { materialized: true }), { code: "MODEL_ARGUMENT_INVALID" });
});
test("invalid operations, dangling conditions and cyclic derivation fail before use", () => {
  assert.throws(() => validateAndResolve(descriptor({ constraints: [{ ruleId: "bad", check: "execute", arguments: [] }] }), {}), { code: "MODEL_DESCRIPTION_INVALID" });
  assert.throws(() => validateAndResolve(descriptor({ constraints: [{ ruleId: "bad", check: "require", arguments: ["missing"] }] }), {}), { code: "MODEL_DESCRIPTION_INVALID" });
  assert.throws(() => validateAndResolve(descriptor({ arguments: { a: { dataType: "string", derivedFrom: { operation: "imageAspectRatio", argument: "b" } }, b: { dataType: "string", derivedFrom: { operation: "imageAspectRatio", argument: "a" } } } }), {}), { code: "MODEL_DESCRIPTION_INVALID" });
});
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "dv-gateway-contract-"));
  await mkdir(join(root, ".dsivio-video"));
  const original = { command: process.env.DSIVIO_VIDEO_DSIVIO, dir: process.env.FAKE_DSIVIO_DIR };
  process.env.DSIVIO_VIDEO_DSIVIO = fileURLToPath(new URL("../../test/fixtures/fake-dsivio.mjs", import.meta.url)); process.env.FAKE_DSIVIO_DIR = root;
  t.after(async () => { if (original.command === undefined) delete process.env.DSIVIO_VIDEO_DSIVIO; else process.env.DSIVIO_VIDEO_DSIVIO = original.command; if (original.dir === undefined) delete process.env.FAKE_DSIVIO_DIR; else process.env.FAKE_DSIVIO_DIR = original.dir; await rm(root, { recursive: true, force: true }); });
  const ctx: ExecuteContext = { buildId: "build", commandKey: "video", idempotencyKey: "build/video", projectRoot: root, workDir: join(root, "work"), signal: new AbortController().signal, log() {}, store: { pathOf(ref) { return join(root, ref.$resource); }, async putFile(path, mime) { return { $resource: "result", bytes: (await readFile(path)).length, mime }; } } };
  return { root, ctx, config: async (value: Json) => writeFile(join(root, "config.json"), JSON.stringify(value)), gateway: async (gateway: string) => writeFile(join(root, ".dsivio-video", "config.json"), JSON.stringify({ gateway })) };
}
test("auto falls back only on unreachable App and selected contexts never switch", async t => {
  const f = await fixture(t); await f.config({ exit6: ["models"] });
  const ctx: ResolveContext = { projectRoot: f.root }; assert.equal(await selectBackend(ctx), "standalone");
  await f.config({}); assert.equal(await selectBackend(ctx), "standalone");
  const bad = join(f.root, "bad-host"); await writeFile(bad, "#!/bin/sh\nprintf 'invalid options\\n' >&2\nexit 2\n", { mode: 0o755 }); process.env.DSIVIO_VIDEO_DSIVIO = bad;
  await assert.rejects(selectBackend({ projectRoot: f.root }), { code: "GATEWAY_MODELS_FAILED" });
  await f.gateway("dsivio"); await assert.rejects(gatewayModels({ projectRoot: f.root }), { code: "GATEWAY_MODELS_FAILED" });
});
test("snapshot backend stays fixed after config change and revision changes reject submission", async t => {
  const f = await fixture(t), cap = gatewayCapabilities.find(c => c.name === "gateway/video")!;
  const resolution = await cap.resolve({ model: "volcengine/doubao-seedance-2-5", arguments: { prompt: "hello", generateAudio: false } }, { projectRoot: f.root });
  assert.ok(resolution.ok); if (!resolution.ok) return;
  await f.gateway("standalone"); const fixed = await cap.resolve(resolution.request, { projectRoot: f.root, gatewayBackend: "dsivio" }); assert.ok(fixed.ok); if (fixed.ok) assert.equal(fixed.backend, "dsivio");
  const executor = cap.executor; assert.equal(executor.kind, "async"); if (executor.kind !== "async") return;
  await f.config({ models: [{ id: "volcengine/doubao-seedance-2-5", kind: "video", description: descriptor() as unknown as Json }] });
  await assert.rejects(executor.submit(resolution.request, f.ctx), { code: "MODEL_DESCRIPTION_CHANGED" });
});
test("cancelled task exits seven but never becomes a published output; unsupported is factual", async t => {
  const f = await fixture(t), cap = gatewayCapabilities.find(c => c.name === "gateway/image")!;
  const resolution = await cap.resolve({ model: "openai/gpt-image-2", arguments: { prompt: "hello" } }, { projectRoot: f.root }); assert.ok(resolution.ok); if (!resolution.ok || cap.executor.kind !== "async") return;
  const submitted = await cap.executor.submit(resolution.request, f.ctx);
  await f.config({ cancelOutcome: "unsupported", runningStatuses: 10 }); assert.equal(await cap.executor.cancel!(submitted.handle, f.ctx), "unsupported");
  await f.config({}); assert.equal(await cap.executor.cancel!(submitted.handle, f.ctx), "confirmed"); assert.deepEqual(await cap.executor.poll(submitted.handle, f.ctx), { state: "cancelled", receipt: "remote-task-1" });
});
test("transcript evidence decodes inline or JSON outputs with exact missing measurements", async t => {
  const f = await fixture(t), transcript: Json = { schema: "dsivio.media.transcript/1", language: "zh", sampleRate: 16000, sampleFrames: 16000, engine: { backend: "local", model: "small", protocol: "dsivio-video.asr/1", serviceVersion: "0.2.0", whisperxVersion: "3.8.6" }, segments: [{ text: "今天", words: [{ text: "今", start: 0.123456, end: 0.3, score: 0.9 }, { text: "天" }] }] };
  const task = { kind: "transcribe", status: "succeeded", result: transcript, outputs: [] };
  const inline = await transcriptFromTask(task, "zh", 16000); assert.equal(inline.segments[0]!.words[0]!.start, 0.123456); assert.deepEqual(inline.segments[0]!.words[1], { text: "天" });
  const path = join(f.root, "transcript.json"); await writeFile(path, JSON.stringify(transcript)); assert.deepEqual(await transcriptFromTask({ ...task, result: null, outputs: [{ path, mime: "application/json" }] }, "zh", 16000), inline);
  await assert.rejects(transcriptFromTask(task, "zh", 16001), { code: "ASR_RESPONSE_INVALID" });
});

test("authored aspectRatio binds to the published native ratio slot and enforces its domain", async t => {
  const f = await fixture(t), cap = gatewayCapabilities.find(c => c.name === "gateway/video")!;
  const good = await cap.resolve({ model: "volcengine/doubao-seedance-2-5", arguments: { prompt: "native ratio", aspectRatio: "16:9" } }, { projectRoot: f.root });
  assert.ok(good.ok);
  if (!good.ok || cap.executor.kind !== "async") return;
  const task = await cap.executor.submit(good.request, f.ctx);
  assert.equal((await cap.executor.poll(task.handle, f.ctx)).state, "done");
  const bad = await cap.resolve({ model: "volcengine/doubao-seedance-2-5", arguments: { prompt: "native ratio", aspectRatio: "4:3" } }, { projectRoot: f.root });
  assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.code, "MODEL_ARGUMENT_INVALID");
});

test("frozen canonical defaults accept a runtime alias, but duplicate authored identities remain errors", async () => {
  const d = descriptor({ arguments: { prompt: { dataType: "string", required: true }, outputFormat: { dataType: "string", allowed: ["png"], defaultValue: "png" }, aspectRatio: { dataType: "string", allowed: ["1:1"] } }, constraints: [] });
  const snapshot = validateRequest({ model: d.identity, backend: "dsivio", arguments: { prompt: "alias", output_format: "png", aspect_ratio: "1:1" }, capabilitySnapshot: d as unknown as Json });
  const actual: Json = { model: d.identity, arguments: { prompt: "alias", output_format: "png", aspect_ratio: "1:1" } };
  const cap = gatewayCapabilities.find(c => c.name === "gateway/video")!;
  assert.equal((await cap.resolve(frozenRequest(actual, snapshot as unknown as Json), { projectRoot: "/", gatewayBackend: "dsivio" })).ok, true);
  assert.throws(() => frozenRequest({ model: d.identity, arguments: { prompt: "alias", outputFormat: "png", output_format: "png" } }, snapshot as unknown as Json), { code: "MODEL_ARGUMENT_DUPLICATE" });
});

test("old host executes only advertised public parameters and refuses descriptor-dependent extras", async t => {
  const f = await fixture(t), cap = gatewayCapabilities.find(c => c.name === "gateway/image")!;
  await f.config({ models: [{ id: "old/image", kind: "image", known: true, capabilities: { maxCount: 2, ratios: ["1:1"] }, description: null }] });
  const rejected = await cap.resolve({ model: "old/image", arguments: { prompt: "old", quality: "high" } }, { projectRoot: f.root });
  assert.equal(rejected.ok, false); if (!rejected.ok) assert.equal(rejected.code, "MODEL_DESCRIPTION_UNAVAILABLE");
  const allowed = await cap.resolve({ model: "old/image", arguments: { prompt: "old", n: 2 } }, { projectRoot: f.root });
  assert.ok(allowed.ok); if (!allowed.ok || cap.executor.kind !== "async") return;
  const submitted = await cap.executor.submit(allowed.request, f.ctx);
  assert.equal((await cap.executor.poll(submitted.handle, f.ctx)).state, "done");
});

test("a default voice is not misclassified as an authored clone exclusion by native options", async t => {
  const f = await fixture(t), cap = gatewayCapabilities.find(c => c.name === "gateway/speech")!;
  const voiceReference = join(f.root, "reference.wav"), consentAttestation = join(f.root, "consent.txt");
  const wav = Buffer.alloc(46); wav.write("RIFF"); wav.writeUInt32LE(38, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(2, 40);
  await writeFile(voiceReference, wav); await writeFile(consentAttestation, "Explicit fixture voice-cloning consent");
  const d = descriptor({ identity: "presence/speech", operation: "speech", arguments: { text: { dataType: "string", required: true }, voice: { dataType: "string", defaultValue: "preset" }, voiceReference: { dataType: "string", resource: true }, consentAttestation: { dataType: "string", resource: true } }, constraints: [{ ruleId: "voice-or-clone", check: "excludeTogether", arguments: ["voice", "voiceReference"] }, { ruleId: "clone-consent", when: { provided: "voiceReference" }, check: "require", arguments: ["consentAttestation"] }] });
  await f.config({ models: [{ id: d.identity, kind: "speech", known: true, capabilities: null, description: d as unknown as Json }], runningStatuses: 10 });
  const raw = { model: d.identity, arguments: { text: "Clone boundary", voiceReference, consentAttestation } }, resolution = await cap.resolve(raw, { projectRoot: f.root });
  assert.ok(resolution.ok); if (!resolution.ok || cap.executor.kind !== "async") return;
  const task = await cap.executor.submit(resolution.request, f.ctx);
  assert.equal((await cap.executor.poll(task.handle, f.ctx)).state, "pending");
  const conflict = await cap.resolve({ ...raw, arguments: { ...raw.arguments, voice: "preset" } }, { projectRoot: f.root });
  assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.code, "MODEL_CONSTRAINT_FAILED");
});

test("local idempotency and recovery bind WAV contents, not just a same-size filename", { timeout: 10_000 }, async t => {
  const f = await fixture(t), oldHome = process.env.HOME; process.env.HOME = f.root;
  t.after(() => { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; });
  await writeFile(join(f.root, ".dsivio-video", "config.json"), JSON.stringify({ gateway: "standalone", asr: { autoInstall: false } }));
  const audioFile = join(f.root, "sample.wav"), wav = Buffer.alloc(46);
  wav.write("RIFF"); wav.writeUInt32LE(38, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(2, 40);
  await writeFile(audioFile, wav);
  const request: Json = { model: "local/whisperx-small", backend: "standalone", capabilitySnapshot: localAsrModel().description as unknown as Json, arguments: { audioFile, language: "en" } };
  const task = await localTranscribeExecutor.submit(request, f.ctx);
  for (;;) {
    const state = await localTranscribeExecutor.poll(task.handle, f.ctx);
    if (state.state === "failed") { assert.equal(state.code, "ASR_INSTALL_REQUIRED"); break; }
    assert.equal(state.state, "pending");
    await yieldTurn();
  }
  assert.ok(await localTranscribeExecutor.recover!(request, f.ctx));
  wav[44] = 1; await writeFile(audioFile, wav);
  await assert.rejects(localTranscribeExecutor.submit(request, f.ctx), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(localTranscribeExecutor.recover!(request, f.ctx), { code: "IDEMPOTENCY_CONFLICT" });
});
