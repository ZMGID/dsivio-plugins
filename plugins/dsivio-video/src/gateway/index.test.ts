import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DvError } from "../core/errors.ts";
import type { ExecuteContext } from "../core/capability.ts";
import type { Json } from "../core/value.ts";
import { imageType, videoType, audioType } from "../modules/media/index.ts";
import { gatewayCapabilities } from "./index.ts";
import type { GenerationRequest, MediaKind } from "./request.ts";

const binary = fileURLToPath(new URL("../../test/fixtures/fake-dsivio.mjs", import.meta.url));
const caps: Record<string, Json> = { modes: ["text", "image", "frames", "reference"], durations: [5, 8], resolutions: ["720p"], ratios: ["9:16"], audioToggle: true, firstFrame: true, lastFrame: true, lastFrameNeedsFirst: true, maxReferenceImages: 2, maxReferenceVideos: 2, maxReferenceAudios: 2, referenceAudioNeedsVisual: true, framesExcludeReferences: true, localReferenceMedia: true, maxPromptLength: 10, sizes: ["1K", "2K"], qualities: ["auto", "high"], maxCount: 2, defaults: {} };
const image: Json = { $resource: "image", bytes: 4, mime: "image/png" };
const video: Json = { $resource: "video", bytes: 4, mime: "video/mp4" };
const audio: Json = { $resource: "audio", bytes: 4, mime: "audio/wav" };
function request(kind: MediaKind = "video"): GenerationRequest {
  return { model: `p/${kind}`, prompt: "Morning", params: {}, references: { images: [], videos: [], audios: [] }, options: {} };
}
function capability(kind: MediaKind) { const result = gatewayCapabilities.find((item) => item.name === `gateway/${kind}`); assert.ok(result); return result; }
function executor(kind: MediaKind) { const result = capability(kind).executor; assert.ok(result.kind === "async"); return result; }
function errorCode(expected: string) { return (error: unknown): boolean => error instanceof DvError && error.code === expected; }
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "dv-gateway-"));
  const oldBinary = process.env.DSIVIO_VIDEO_DSIVIO;
  const oldDir = process.env.FAKE_DSIVIO_DIR;
  process.env.DSIVIO_VIDEO_DSIVIO = binary;
  process.env.FAKE_DSIVIO_DIR = dir;
  t.after(async () => {
    if (oldBinary === undefined) delete process.env.DSIVIO_VIDEO_DSIVIO; else process.env.DSIVIO_VIDEO_DSIVIO = oldBinary;
    if (oldDir === undefined) delete process.env.FAKE_DSIVIO_DIR; else process.env.FAKE_DSIVIO_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  });
  const stored: { path: string; mime: string; bytes: Buffer }[] = [];
  const ctx: ExecuteContext = { buildId: "build", commandKey: "command", idempotencyKey: "build:stable-key", projectRoot: dir, workDir: join(dir, "work"), signal: new AbortController().signal, log() {}, store: {
    pathOf(ref) { return join(dir, `${ref.$resource}.bin`); },
    async putFile(path, mime) { const bytes = await readFile(path); stored.push({ path, mime, bytes }); return { $resource: `stored-${stored.length}`, bytes: bytes.length, mime }; },
  } };
  return { dir, ctx, stored, async configure(config: Json) { await writeFile(join(dir, "config.json"), JSON.stringify(config)); } };
}

test("resolve applies published defaults, keeps Pending and snapshots capabilities", async (t) => {
  const f = await fixture(t);
  await f.configure({ models: [{ id: "p/video", kind: "video", known: true, capabilities: { ...caps, defaults: { duration: 5, resolution: "720p", ratio: "9:16" } } }] });
  const input = request(); input.firstFrame = { $pending: "hero.image", type: imageType }; input.prompt = { $pending: "direction", type: "dsivio-video/text@1#Text" };
  for (let index = 0; index < 2; index++) {
    const result = await capability("video").resolve({ ...input }, { projectRoot: f.dir });
    assert.ok(result.ok);
    assert.equal(result.backend, "dsivio"); assert.equal(result.cost, "paid");
    assert.ok(result.request && typeof result.request === "object" && !Array.isArray(result.request));
    assert.deepEqual(result.request.params, { duration: 5, resolution: "720p", ratio: "9:16" });
    assert.deepEqual(result.request.firstFrame, input.firstFrame); assert.deepEqual(result.request.prompt, input.prompt);
    assert.equal(result.request.backend, "dsivio"); assert.deepEqual(result.request.capabilities, { ...caps, defaults: { duration: 5, resolution: "720p", ratio: "9:16" } });
    assert.equal(result.summary.price, "unknown");
  }
});

test("resolve validates every capability rule and returns stable error codes", async (t) => {
  const f = await fixture(t);
  type Case = { code: string; kind?: MediaKind; change: (request: GenerationRequest) => void; caps?: Record<string, Json>; known?: boolean };
  const cases: Case[] = [
    { code: "GEN_DURATION_UNSUPPORTED", change: (r) => { r.params.duration = 9; } },
    { code: "GEN_RESOLUTION_UNSUPPORTED", change: (r) => { r.params.resolution = "4k"; } },
    { code: "GEN_RATIO_UNSUPPORTED", change: (r) => { r.params.ratio = "1:1"; } },
    { code: "GEN_AUDIO_UNSUPPORTED", caps: { audioToggle: false }, change: (r) => { r.params.audio = false; } },
    { code: "GEN_FIRST_FRAME_UNSUPPORTED", caps: { firstFrame: false }, change: (r) => { r.firstFrame = { $pending: "first", type: imageType }; } },
    { code: "GEN_LAST_FRAME_UNSUPPORTED", caps: { lastFrame: false }, change: (r) => { r.lastFrame = image; } },
    { code: "GEN_LAST_FRAME_NEEDS_FIRST", change: (r) => { r.lastFrame = image; } },
    { code: "GEN_REFERENCE_IMAGES_LIMIT", change: (r) => { r.references.images = [image, image, { $pending: "third", type: imageType }]; } },
    { code: "GEN_REFERENCE_VIDEOS_LIMIT", change: (r) => { r.references.videos = [video, video, { $pending: "third", type: videoType }]; } },
    { code: "GEN_REFERENCE_AUDIOS_LIMIT", change: (r) => { r.references.audios = [audio, audio, { $pending: "third", type: audioType }]; } },
    { code: "GEN_REFERENCE_AUDIO_NEEDS_VISUAL", change: (r) => { r.references.audios = [{ $pending: "voice", type: audioType }]; } },
    { code: "GEN_FRAMES_EXCLUDE_REFERENCES", change: (r) => { r.firstFrame = image; r.references.images = [image]; } },
    { code: "GEN_LOCAL_REFERENCE_UNSUPPORTED", caps: { localReferenceMedia: false }, change: (r) => { r.references.videos = [video]; } },
    { code: "GEN_PROMPT_TOO_LONG", change: (r) => { r.prompt = "01234567890"; } },
    { code: "GEN_SIZE_UNSUPPORTED", kind: "image", change: (r) => { r.params.size = "4K"; } },
    { code: "GEN_QUALITY_UNSUPPORTED", kind: "image", change: (r) => { r.params.quality = "ultra"; } },
    { code: "GEN_COUNT_UNSUPPORTED", kind: "image", change: (r) => { r.params.count = 3; } },
    { code: "GEN_CAPABILITIES_UNKNOWN", known: false, change: (r) => { r.params.audio = false; } },
    { code: "GEN_CAPABILITIES_UNKNOWN", known: false, change: (r) => { r.firstFrame = image; } },
    { code: "GEN_CAPABILITIES_UNKNOWN", known: false, change: (r) => { r.references.images = [image]; } },
    { code: "GEN_OPTION_UNSUPPORTED", change: (r) => { r.options.seed = 0; } },
    { code: "GEN_MODEL_REQUIRED", change: (r) => { r.model = ""; } },
    { code: "GEN_PARAM_INVALID", change: (r) => { r.params.duration = -1; } },
    { code: "GEN_PARAM_UNSUPPORTED", change: (r) => { r.params.seed = 1; } },
    { code: "TYPE_INVALID", change: (r) => { r.firstFrame = video; } },
  ];
  for (const row of cases) {
    const kind = row.kind ?? "video";
    await f.configure({ models: [{ id: `p/${kind}`, kind, known: row.known ?? true, capabilities: row.known === false ? null : { ...caps, ...row.caps } }] });
    const input = request(kind); row.change(input);
    const result = await capability(kind).resolve({ ...input }, { projectRoot: f.dir });
    assert.equal(result.ok, false, row.code);
    if (!result.ok) assert.equal(result.code, row.code);
  }
  await f.configure({ models: [{ id: "p/video", kind: "video", known: true, capabilities: caps }] });
  const input = request(); input.model = "p/not-enabled";
  const unavailable = await capability("video").resolve({ ...input }, { projectRoot: f.dir });
  assert.ok(!unavailable.ok); assert.equal(unavailable.code, "GEN_MODEL_NOT_ENABLED"); assert.match(unavailable.reason, /p\/video/);
});

test("resolve permits only described exceptions, supported combinations, and prompt-only unknown models", async (t) => {
  const f = await fixture(t);
  const cases: { kind: MediaKind; input: GenerationRequest; known: boolean; extra: Record<string, Json> }[] = [];
  const tail = request(); tail.lastFrame = image;
  cases.push({ kind: "video", input: tail, known: true, extra: { lastFrameNeedsFirst: false } });
  const audioOnly = request(); audioOnly.references.audios = [audio];
  cases.push({ kind: "video", input: audioOnly, known: true, extra: { referenceAudioNeedsVisual: false } });
  const mixed = request(); mixed.firstFrame = image; mixed.references.images = [image];
  cases.push({ kind: "video", input: mixed, known: true, extra: { framesExcludeReferences: false } });
  const boundary = request(); boundary.prompt = "0123456789"; boundary.params = { duration: 5, resolution: "720p", ratio: "9:16", audio: false }; boundary.references.images = [image, image]; boundary.references.audios = [audio];
  cases.push({ kind: "video", input: boundary, known: true, extra: {} });
  const pixel = request("image"); pixel.params = { size: "1234x5678", ratio: "9:16", quality: "auto", count: 2 };
  cases.push({ kind: "image", input: pixel, known: true, extra: { customPixelSize: true } });
  cases.push({ kind: "video", input: request(), known: false, extra: {} });
  for (const row of cases) {
    await f.configure({ models: [{ id: row.input.model, kind: row.kind, known: row.known, capabilities: row.known ? { ...caps, ...row.extra } : null }] });
    const result = await capability(row.kind).resolve({ ...row.input }, { projectRoot: f.dir });
    assert.ok(result.ok, !result.ok ? result.reason : "");
  }
});

test("resolve selects config honestly and surfaces Dsivio unavailable", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.dir, ".dsivio-video"));
  await writeFile(join(f.dir, ".dsivio-video", "config.json"), '{"gateway":"standalone"}');
  let result = await capability("video").resolve({ ...request() }, { projectRoot: f.dir });
  assert.ok(!result.ok); assert.equal(result.code, "GATEWAY_BACKEND_INVALID");
  await writeFile(join(f.dir, ".dsivio-video", "config.json"), '{"gateway":"dsivio"}');
  await f.configure({ exit6: ["models"] });
  result = await capability("video").resolve({ ...request() }, { projectRoot: f.dir });
  assert.ok(!result.ok); assert.equal(result.code, "GATEWAY_UNAVAILABLE"); assert.match(result.reason, /open Dsivio/);
});

test("submit and poll use stable idempotency, prompt files, media flags and first matching output", async (t) => {
  const f = await fixture(t);
  for (const kind of ["image", "video"] as const) {
    await f.configure({ runningStatuses: 1 });
    const exec = executor(kind);
    const input = request(kind);
    input.prompt = "中文 Morning\nwith exact bytes";
    if (kind === "image") input.params = { size: "2K", quality: "high", ratio: "9:16", count: 2 };
    else { input.params = { duration: 5, resolution: "720p", ratio: "9:16", audio: false }; input.firstFrame = image; input.lastFrame = image; input.references.videos = [video]; input.references.audios = [audio]; }
    input.references.images = [image];
    f.ctx.idempotencyKey = `build:${kind}-key`;
    const submitted = await exec.submit({ ...input }, f.ctx);
    const same = await exec.submit({ ...input }, f.ctx);
    assert.deepEqual(same.handle, submitted.handle); assert.equal(same.receipt, submitted.receipt);
    const running = await exec.poll(submitted.handle, f.ctx);
    assert.deepEqual(running, { state: "pending", retryAfterMs: kind === "image" ? 5000 : 10000 });
    const done = await exec.poll(submitted.handle, f.ctx);
    assert.ok(done.state === "done"); assert.equal(done.value.type, kind === "image" ? imageType : videoType);
    assert.equal(f.stored.at(-1)!.mime, `${kind}/${kind === "image" ? "png" : "mp4"}`);
    assert.deepEqual(f.stored.at(-1)!.bytes.subarray(0, kind === "image" ? 8 : 12), kind === "image" ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom")]));
  }
  const calls = (await readFile(join(f.dir, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const imageCall = calls.find((call) => call.args[1] === "image"); const videoCall = calls.find((call) => call.args[1] === "video");
  assert.equal(imageCall.prompt, "中文 Morning\nwith exact bytes");
  assert.ok(imageCall.args.includes("build:image-key")); assert.ok(imageCall.args.includes("--n"));
  assert.ok(videoCall.args.includes("build:video-key")); assert.ok(videoCall.args.includes('{"generateAudio":false}'));
  assert.ok(videoCall.args.includes(join(f.dir, "image.bin"))); assert.ok(videoCall.args.includes(join(f.dir, "video.bin"))); assert.ok(videoCall.args.includes(join(f.dir, "audio.bin")));
});

test("submit classifies rejection, uncertainty and closed Dsivio without losing the key", async (t) => {
  const f = await fixture(t);
  const exec = executor("image");
  for (const [exit, code] of [[2, "GATEWAY_REJECTED"], [3, "GATEWAY_REJECTED"], [5, "GATEWAY_UNCERTAIN"], [6, "GATEWAY_UNAVAILABLE"]] as const) {
    await f.configure({ submitExit: exit });
    await assert.rejects(exec.submit({ ...request("image") }, f.ctx), errorCode(code));
  }
  await f.configure({});
  const submitted = await exec.submit({ ...request("image") }, f.ctx);
  assert.ok(submitted.handle);
  const state = JSON.parse(await readFile(join(f.dir, "state.json"), "utf8"));
  assert.equal(Object.keys(state.tasks).length, 1); assert.equal(state.keys[f.ctx.idempotencyKey], "task-1");
});

test("poll closed Dsivio waits, terminal failures preserve charge uncertainty", async (t) => {
  const f = await fixture(t);
  const exec = executor("video");
  await f.configure({});
  const submitted = await exec.submit({ ...request() }, f.ctx);
  await f.configure({ exit6: ["status"] });
  const closed = await exec.poll(submitted.handle, f.ctx);
  assert.ok(closed.state === "pending"); assert.equal(closed.retryAfterMs, 10000); assert.match(closed.progress!, /Dsivio is closed/);
  for (const [remoteId, canResume, charged] of [[null, false, "maybe"], ["receipt", false, "maybe"], [null, true, "maybe"]] as const) {
    await f.configure({ finalStatus: "failed", remoteId, canResume, error: "Vendor rejected output" });
    assert.deepEqual(await exec.poll(submitted.handle, f.ctx), { state: "failed", code: "GATEWAY_FAILED", message: "Vendor rejected output", charged });
  }
});

test("poll imports only the first output of the requested media kind", async (t) => {
  const f = await fixture(t);
  const exec = executor("image");
  await f.configure({});
  const submitted = await exec.submit({ ...request("image") }, f.ctx);
  const first = join(f.dir, "first.png");
  const second = join(f.dir, "second.png");
  await writeFile(first, Buffer.from([137, 80, 78, 71, 1]));
  await writeFile(second, Buffer.from([137, 80, 78, 71, 2]));
  await f.configure({ outputs: [{ path: join(f.dir, "ignored.mp4"), mime: "video/mp4" }, { path: first, mime: "image/png" }, { path: second, mime: "image/png" }] });
  const result = await exec.poll(submitted.handle, f.ctx);
  assert.ok(result.state === "done");
  assert.equal(f.stored.length, 1);
  assert.equal(f.stored[0]!.path, first);
  assert.deepEqual(f.stored[0]!.bytes, Buffer.from([137, 80, 78, 71, 1]));
});

test("regression: paid uncertainty stays maybe unless Dsivio explicitly rejects", async (t) => {
  const f = await fixture(t);
  const exec = executor("video");
  const submitted = await exec.submit({ ...request() }, f.ctx);
  for (const row of [
    { submissionState: "uncertain", statusExit: 5, remoteId: null, charged: "maybe" },
    { submissionState: null, statusExit: 4, remoteId: null, charged: "maybe" },
    { submissionState: "rejected", statusExit: 3, remoteId: null, charged: "no" },
    { submissionState: "rejected", statusExit: 5, remoteId: null, charged: "maybe" },
  ]) {
    await f.configure({ finalStatus: "failed", ...row });
    const result = await exec.poll(submitted.handle, f.ctx);
    assert.ok(result.state === "failed");
    assert.equal(result.charged, row.charged);
  }
});

test("regression: nonzero submissions preserve recoverable task handles and receipts", async (t) => {
  const f = await fixture(t);
  const exec = executor("video");
  for (const exit of [5, 124, 4]) {
    f.ctx.idempotencyKey = `recover:${exit}`;
    await f.configure({ submitExit: exit, submitReply: true, remoteId: `receipt-${exit}` });
    const submitted = await exec.submit({ ...request() }, f.ctx);
    assert.equal(submitted.receipt, `receipt-${exit}`);
    await f.configure(exit === 4 ? { finalStatus: "failed" } : { runningStatuses: 1 });
    const result = await exec.poll(submitted.handle, f.ctx);
    assert.equal(result.state, exit === 4 ? "failed" : "pending");
  }
  const state = JSON.parse(await readFile(join(f.dir, "state.json"), "utf8"));
  assert.equal(Object.keys(state.tasks).length, 3);
});

test("regression: resolve derives video modes with reference and tail-frame precedence", async (t) => {
  const f = await fixture(t);
  for (const mode of ["text", "image", "frames", "reference"]) {
    const input = request();
    if (mode === "image") input.firstFrame = { $pending: "first", type: imageType };
    if (mode === "frames") { input.firstFrame = image; input.lastFrame = { $pending: "last", type: imageType }; }
    if (mode === "reference") { input.firstFrame = image; input.lastFrame = image; input.references.images = [{ $pending: "ref", type: imageType }]; }
    for (const allowed of [true, false]) {
      await f.configure({ models: [{ id: input.model, kind: "video", known: true, capabilities: { ...caps, framesExcludeReferences: false, modes: allowed ? [mode] : ["different"] } }] });
      const result = await capability("video").resolve({ ...input }, { projectRoot: f.dir });
      assert.equal(result.ok, allowed, mode);
      if (!result.ok) assert.equal(result.code, "GEN_MODE_UNSUPPORTED");
    }
  }
});

test("regression: prompt limits count Unicode scalars except Runway UTF-16", async (t) => {
  const f = await fixture(t);
  for (const protocol of ["seedance", "runway"]) {
    await f.configure({ models: [{ id: "p/video", kind: "video", known: true, capabilities: { ...caps, protocol, maxPromptLength: 2 } }] });
    const input = request(); input.prompt = "😀😀";
    const result = await capability("video").resolve({ ...input }, { projectRoot: f.dir });
    assert.equal(result.ok, protocol !== "runway");
    if (!result.ok) assert.equal(result.code, "GEN_PROMPT_TOO_LONG");
  }
});

test("regression: aborting an accepted slow submit is not safe gateway unavailability", async (t) => {
  const f = await fixture(t);
  await f.configure({ submitDelayMs: 60_000 });
  const controller = new AbortController();
  t.after(async () => { controller.abort(); });
  f.ctx.signal = controller.signal;
  const outcome = executor("video").submit({ ...request() }, f.ctx).then(() => null, (error: unknown) => error);
  const deadline = Date.now() + 5_000;
  let accepted = false;
  while (Date.now() < deadline) {
    try {
      accepted = (await readFile(join(f.dir, "state.json"), "utf8")).includes(f.ctx.idempotencyKey);
      if (accepted) break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await delay(10);
  }
  assert.ok(accepted, "Fake Dsivio must accept the paid task before interruption");
  controller.abort();
  const error = await outcome;
  assert.ok(error instanceof DvError);
  assert.equal(error.code, "ABORTED");
  assert.notEqual(error.code, "GATEWAY_UNAVAILABLE");
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.name, "AbortError");
  const state = JSON.parse(await readFile(join(f.dir, "state.json"), "utf8"));
  assert.equal(Object.keys(state.tasks).length, 1);
});

test("only missing commands, not permission failures, are gateway unavailable", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  process.env.DSIVIO_VIDEO_DSIVIO = join(f.dir, "missing");
  await assert.rejects(executor("video").submit({ ...request() }, f.ctx), errorCode("GATEWAY_UNAVAILABLE"));
  const inaccessible = join(f.dir, "nonexecutable");
  await writeFile(inaccessible, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
  process.env.DSIVIO_VIDEO_DSIVIO = inaccessible;
  await assert.rejects(executor("video").submit({ ...request() }, f.ctx), errorCode("GATEWAY_COMMAND_FAILED"));
});
