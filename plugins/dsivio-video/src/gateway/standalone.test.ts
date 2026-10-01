import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { standaloneModels, standaloneExecutor } from "./standalone.ts";
import { StandaloneLedger } from "./standalone-ledger.ts";
import { readStandaloneConfiguration } from "./standalone-config.ts";
import { saveProviderArtifact } from "./providers/artifacts.ts";
import { validateAndResolve } from "./description.ts";
import { DvError } from "../core/errors.ts";
import type { ExecuteContext } from "../core/capability.ts";
import { isResourceRef, type Json } from "../core/value.ts";
import { validateMedia } from "../modules/media/index.ts";
import { runTool } from "../tools/index.ts";

async function fixture(fn: (home: string, ctx: ExecuteContext) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "dv-standalone-"));
  const ctx: ExecuteContext = { buildId: "build", commandKey: "image", idempotencyKey: "build/image", projectRoot: home, workDir: join(home, "scratch"), signal: new AbortController().signal, log() {}, store: { pathOf(ref) { return join(home, ref.$resource); }, async putFile(path, mime) { const bytes = await readFile(path); return { $resource: createHash("sha256").update(bytes).digest("hex"), mime, bytes: bytes.length }; } } };
  try { await fn(home, ctx); } finally { await rm(home, { recursive: true, force: true }); }
}
const environment = { MINIMAX_API_KEY: "unit-test-placeholder-no-network" };

test("SQLite ownership isolates accounts and rejects conflicting immutable requests", async () => {
  await fixture(async home => {
    const a = await StandaloneLedger.open(join(home, "gateway")); const b = await StandaloneLedger.open(join(home, "gateway"));
    try { const request = { kind: "image" as const, model: "image-01", arguments: { prompt: "one" } }; const first = a.prepare("one", "key", "hash-a", "v1", request); const same = b.prepare("one", "key", "hash-a", "v1", request); assert.equal(same.id, first.id); assert.equal(a.claim(first.id), true); assert.equal(b.claim(first.id), false); assert.throws(() => b.prepare("one", "key", "hash-b", "v1", request), (e: unknown) => e instanceof DvError && e.code === "IDEMPOTENCY_CONFLICT"); assert.notEqual(b.prepare("two", "key", "hash-a", "v1", request).id, first.id); }
    finally { a.close(); b.close(); }
  });
});

test("a crash after durable network intent becomes uncertain without another claim", async () => {
  await fixture(async home => {
    const ledger = await StandaloneLedger.open(join(home, "gateway"));
    try { const task = ledger.prepare("one", "key", "hash", "v1", { kind: "speech", model: "speech-2.8-hd", arguments: { text: "hello" } }); ledger.change(task.id, t => { t.state = "submitting"; t.ownerPid = 2147483647; t.stage = "clone-submitting"; t.stages.uploaded = 123; }); assert.equal(ledger.claim(task.id), false); const recovered = ledger.get(task.id); assert.equal(recovered.state, "uncertain"); assert.equal(recovered.stages.uploaded, 123); assert.equal(ledger.claim(task.id), false); }
    finally { ledger.close(); }
  });
});

test("concurrent synchronous consumers submit once and preserve every artifact in order", async () => {
  await fixture(async (home, ctx) => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#123456" } }).png().toBuffer();
    const secondPng = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#654321" } }).png().toBuffer();
    const original = globalThis.fetch; let calls = 0; const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    globalThis.fetch = async () => { calls++; entered.resolve(); await release.promise; return Response.json({ base_resp: { status_code: 0 }, id: "receipt-one", data: { image_base64: [png.toString("base64"), secondPng.toString("base64")] } }); };
    try {
      const options = { home, environment }; const description = (await standaloneModels("image", options))[0]!.description;
      const request = { model: "minimax/image-01", backend: "standalone", arguments: { prompt: "one", n: 2, seed: 0, promptOptimizer: false }, capabilitySnapshot: description } as unknown as Json;
      const executor = standaloneExecutor("image", options); const first = executor.submit(request, ctx); await entered.promise;
      const b = await executor.submit(request, ctx); release.resolve(); const a = await first;
      assert.equal(a.task, b.task); assert.equal(calls, 1); const result = await executor.poll(a.handle, ctx);
      assert.equal(result.state, "done");
      if (result.state === "done") { assert.equal(result.receipt, "receipt-one"); validateMedia(result.value.data, "image"); assert.ok(isResourceRef(result.value.data)); assert.equal(result.value.data.$resource, createHash("sha256").update(png).digest("hex")); }
      const ledger = await StandaloneLedger.open(join(home, "gateway"));
      try { const saved = ledger.get(a.task!).outputs; assert.deepEqual(saved.map(output => output.sha256), [png, secondPng].map(bytes => createHash("sha256").update(bytes).digest("hex"))); assert.deepEqual(await Promise.all(saved.map(output => readFile(output.path))), [png, secondPng]); } finally { ledger.close(); }
      await assert.rejects(executor.submit({ ...(request as Record<string, Json>), arguments: { prompt: "changed", n: 2 } }, ctx), (e: unknown) => e instanceof DvError && e.code === "IDEMPOTENCY_CONFLICT"); assert.equal(calls, 1);
    }
    finally { globalThis.fetch = original; }
  });
});

test("invalid submit JSON remains uncertain across restart and cannot paid-resubmit", async () => {
  await fixture(async (home, ctx) => {
    const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; return new Response("not-json", { status: 200 }); };
    try { const options = { home, environment }; const snapshot = (await standaloneModels("image", options))[0]!.description; const request = { model: "minimax/image-01", backend: "standalone", arguments: { prompt: "one" }, capabilitySnapshot: snapshot } as unknown as Json; const first = await standaloneExecutor("image", options).submit(request, ctx); const second = await standaloneExecutor("image", options).submit(request, ctx); assert.equal(first.task, second.task); const result = await standaloneExecutor("image", options).poll(first.handle, ctx); assert.equal(result.state, "failed"); if (result.state === "failed") { assert.equal(result.code, "GATEWAY_RESPONSE_INVALID"); assert.equal(result.charged, "maybe"); } assert.equal(calls, 1); const ledger = await StandaloneLedger.open(join(home, "gateway")); try { assert.equal(ledger.get(first.task!).state, "uncertain"); } finally { ledger.close(); } }
    finally { globalThis.fetch = original; }
  });
});

test("remote terminal failure preserves its accepted receipt and never retries generation", async () => {
  await fixture(async (home, ctx) => {
    const original = globalThis.fetch; let calls = 0; const corrupt = Buffer.from("not a valid image file at all"); globalThis.fetch = async () => { calls++; return Response.json({ base_resp: { status_code: 0 }, task_id: "video-accepted" }); };
    try { const options = { home, environment }; const snapshot = (await standaloneModels("video", options))[0]!.description; const request = { model: "minimax/MiniMax-H3", backend: "standalone", arguments: { prompt: "one", resolution: "768P", duration: 4, aspectRatio: "16:9" }, capabilitySnapshot: snapshot } as unknown as Json; const executor = standaloneExecutor("video", options); const submitted = await executor.submit(request, ctx); assert.equal(submitted.receipt, "video-accepted"); const ledger = await StandaloneLedger.open(join(home, "gateway")); try { ledger.change(submitted.task!, t => { t.nextPollAt = 0; }); } finally { ledger.close(); } globalThis.fetch = async () => { calls++; return Response.json({ task: { id: "video-accepted", model: "MiniMax-H3", status: "failed", error: { code: "1026", message: "blocked" } } }); }; const failed = await executor.poll(submitted.handle, ctx); assert.equal(failed.state, "failed"); assert.equal(failed.receipt, "video-accepted"); assert.equal(await executor.cancel!(submitted.handle, ctx), "too-late"); await executor.submit(request, ctx); assert.equal(calls, 2); await assert.rejects(saveProviderArtifact(join(home, "bad"), 0, corrupt, "image/png", "image")); }
    finally { globalThis.fetch = original; }
  });
});

test("credential precedence rejects empty env and unsafe files instead of silently replacing a key", async () => {
  await fixture(async home => {
    await writeFile(join(home, "gateway.json"), JSON.stringify({ schemaVersion: 1, providers: [{ id: "account", adapter: "minimax", baseUrl: "https://api.minimax.io", apiKey: "file-placeholder", apiKeyEnv: "CUSTOM_KEY", enabledModels: ["image-01"] }] }), { mode: 0o600 });
    await assert.rejects(readStandaloneConfiguration(home, { CUSTOM_KEY: "" }), (e: unknown) => e instanceof DvError && e.code === "GATEWAY_CREDENTIAL_MISSING"); assert.equal((await readStandaloneConfiguration(home, { CUSTOM_KEY: "env-placeholder" }))[0]!.apiKey, "env-placeholder"); await chmod(join(home, "gateway.json"), 0o644); await assert.rejects(readStandaloneConfiguration(home, {}), (e: unknown) => e instanceof DvError && e.code === "GATEWAY_CONFIG_UNSAFE");
  });
});

test("provider descriptions reject unpaid unsupported controls while retaining zero and false", async () => {
  const models = await standaloneModels(undefined, { home: "/tmp/standalone-no-config-fixture", environment: { ...environment, GEMINI_API_KEY: "unit-test-placeholder-no-network" } });
  const minimax = models.find(m => m.model === "image-01")!.description; const args = validateAndResolve(minimax, { prompt: "flower", seed: 0, promptOptimizer: false }); assert.equal(args.seed, 0); assert.equal(args.promptOptimizer, false);
  assert.throws(() => validateAndResolve(minimax, { prompt: "flower", width: 513, height: 512 }));
  const veo = models.find(m => m.model === "veo-3.1-generate-preview")!.description; assert.throws(() => validateAndResolve(veo, { prompt: "flower", generateAudio: false })); assert.throws(() => validateAndResolve(veo, { prompt: "flower", resolution: "4k", duration: 4 }));
});

test("authorized clone checkpoints survive uncertain TTS without repeating upload or clone", async () => {
  await fixture(async (home, ctx) => {
    const wav = Buffer.alloc(44 + 320000); wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(320000, 40);
    const consent = Buffer.from("Synthetic unit-test authorization fixture, not user consent for a real provider call.");
    await writeFile(join(home, "sample.wav"), wav); await writeFile(join(home, "consent.txt"), consent);
    const sample = { $resource: "sample.wav", bytes: wav.length, mime: "audio/wav" }; const attestation = { $resource: "consent.txt", bytes: consent.length, mime: "text/plain" };
    const original = globalThis.fetch; const paths: string[] = [];
    globalThis.fetch = async url => {
      const path = new URL(String(url)).pathname; paths.push(path);
      if (path.endsWith("/upload")) return Response.json({ base_resp: { status_code: 0 }, file: { file_id: 123 } });
      if (path.endsWith("/voice_clone")) return Response.json({ base_resp: { status_code: 0 } });
      return new Response("lost-tts-response", { status: 200 });
    };
    try {
      const options = { home, environment }; const snapshot = (await standaloneModels("speech", options))[0]!.description;
      const request = { model: "minimax/speech-2.8-hd", backend: "standalone", arguments: { mode: "clone", text: "test", voiceReference: [{ source: sample, attributes: {} }], consentAttestation: attestation }, capabilitySnapshot: snapshot } as unknown as Json;
      const executor = standaloneExecutor("speech", options); const submitted = await executor.submit(request, ctx);
      const result = await executor.poll(submitted.handle, ctx); assert.equal(result.state, "failed"); if (result.state === "failed") assert.equal(result.charged, "maybe");
      await executor.submit(request, ctx); assert.deepEqual(paths, ["/v1/files/upload", "/v1/voice_clone", "/v1/t2a_v2"]);
      const ledger = await StandaloneLedger.open(join(home, "gateway"));
      try { const task = ledger.get(submitted.task!); assert.equal(task.state, "uncertain"); assert.equal(task.stages.uploaded, 123); assert.deepEqual(task.stages.cloned, { voiceId: `Dv${task.id.replaceAll("-", "")}` }); const voice = ledger.db.prepare("SELECT authorization_hash FROM voices WHERE task_id=?").get(task.id); assert.equal(voice?.authorization_hash, createHash("sha256").update(consent).digest("hex")); } finally { ledger.close(); }
    } finally { globalThis.fetch = original; }
  });
});

test("a confirmed local pre-send cancel is durable and cannot become a late success", async () => {
  await fixture(async (home, ctx) => {
    const ledger = await StandaloneLedger.open(join(home, "gateway")); const task = ledger.prepare("minimax", "cancel-key", "hash", "v1", { kind: "image", model: "image-01", arguments: { prompt: "one" } }); ledger.close();
    const handle = { taskId: task.id, providerId: "minimax", kind: "image" };
    const executor = standaloneExecutor("image", { home, environment }); assert.equal(await executor.cancel!(handle, ctx), "confirmed"); assert.equal(await executor.cancel!(handle, ctx), "confirmed");
    const result = await executor.poll(handle, ctx); assert.equal(result.state, "failed"); if (result.state === "failed") { assert.equal(result.code, "GATEWAY_CANCELLED"); assert.equal(result.charged, "no"); }
    const reopened = await StandaloneLedger.open(join(home, "gateway")); try { assert.equal(reopened.claim(task.id), false); assert.equal(reopened.get(task.id).state, "cancelled"); } finally { reopened.close(); }
  });
});

test("invalid synchronous output preserves provider trace before MIME decoding fails", async () => {
  await fixture(async (home, ctx) => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ base_resp: { status_code: 0 }, id: "bad-artifact-receipt", data: { image_base64: [Buffer.from("not an image container").toString("base64")] } }); };
    try { const options = { home, environment }; const description = (await standaloneModels("image", options))[0]!.description; const request = { model: "minimax/image-01", backend: "standalone", arguments: { prompt: "test" }, capabilitySnapshot: description } as unknown as Json; const executor = standaloneExecutor("image", options); const submitted = await executor.submit(request, ctx); assert.equal(submitted.receipt, "bad-artifact-receipt"); const failure = await executor.poll(submitted.handle, ctx); assert.equal(failure.state, "failed"); assert.equal(failure.receipt, "bad-artifact-receipt"); await executor.submit(request, ctx); assert.equal(calls, 1); } finally { globalThis.fetch = original; }
  });
});

test("malformed private configuration never exposes a credential in thrown or rendered errors", async () => {
  await fixture(async home => {
    const sentinel = "SENTINEL_SECRET_NEVER_RENDER";
    await writeFile(join(home, "gateway.json"), `{\"schemaVersion\":1,\"providers\":[{\"apiKey\":\"${sentinel}\"} invalid]}`, { mode: 0o600 });
    await assert.rejects(readStandaloneConfiguration(home, {}), (error: unknown) => {
      assert.ok(error instanceof DvError); assert.equal(error.code, "GATEWAY_CONFIG_INVALID");
      assert.equal(String(error).includes(sentinel), false); assert.equal(JSON.stringify(error).includes(sentinel), false);
      assert.equal(error.cause, undefined); return true;
    });
  });
});

test("read-only recovery reconnects a lost Build link without credentials, claim or paid retry", async () => {
  await fixture(async (home, ctx) => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ base_resp: { status_code: 0 }, id: "accepted-before-worker-death", data: { image_base64: [Buffer.from("invalid-image").toString("base64")] } }); };
    try {
      const options = { home, environment }; const snapshot = (await standaloneModels("image", options))[0]!.description;
      const request = { model: "minimax/image-01", backend: "standalone", arguments: { prompt: "recover-me" }, capabilitySnapshot: snapshot } as unknown as Json;
      const submitted = await standaloneExecutor("image", options).submit(request, ctx);
      const restarted = standaloneExecutor("image", { home, environment: {} }); const recovered = await restarted.recover(request, ctx);
      assert.deepEqual(recovered, submitted); assert.equal(recovered?.receipt, "accepted-before-worker-death");
      assert.equal(await restarted.recover(request, { ...ctx, idempotencyKey: "other-build" }), null);
      await assert.rejects(restarted.recover({ ...(request as Record<string, Json>), arguments: { prompt: "changed-request" } }, ctx), (error: unknown) => error instanceof DvError && error.code === "IDEMPOTENCY_CONFLICT");
      assert.equal(calls, 1);
      const result = await restarted.poll(recovered!.handle, ctx); assert.equal(result.state, "failed"); assert.equal(result.receipt, "accepted-before-worker-death"); if (result.state === "failed") assert.equal(result.charged, "maybe");
      const ledger = await StandaloneLedger.open(join(home, "gateway"));
      try { assert.equal(ledger.claim(submitted.task!), false); } finally { ledger.close(); }
    } finally { globalThis.fetch = original; }
  });
});

test("query leases prevent overlapping polls and stale pending or errors cannot overwrite verified success", async t => {
  for (const late of ["pending", "error"] as const) await t.test(late, async () => {
    await fixture(async (home, ctx) => {
      const generated = join(home, "local-fixture.mp4");
      await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=1", "-t", "1", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-an", generated], { cwd: home, timeoutMs: 10_000 });
      const saved = await saveProviderArtifact(join(home, "verified"), 0, await readFile(generated), "video/mp4", "video");
      const original = globalThis.fetch; let queries = 0; const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
      globalThis.fetch = async url => {
        if (!String(url).includes("/query/")) return Response.json({ base_resp: { status_code: 0 }, task_id: "lease-video" });
        queries++; entered.resolve(); await release.promise;
        if (late === "error") throw new Error("late transport failure");
        return Response.json({ task: { id: "lease-video", model: "MiniMax-H3", status: "running" } });
      };
      try {
        const options = { home, environment }; const snapshot = (await standaloneModels("video", options))[0]!.description;
        const request = { model: "minimax/MiniMax-H3", backend: "standalone", arguments: { prompt: "lease", resolution: "768P", duration: 4, aspectRatio: "16:9" }, capabilitySnapshot: snapshot } as unknown as Json;
        const executor = standaloneExecutor("video", options); const submitted = await executor.submit(request, ctx);
        const ledger = await StandaloneLedger.open(join(home, "gateway"));
        try {
          ledger.change(submitted.task!, current => { current.nextPollAt = 0; });
          const first = executor.poll(submitted.handle, ctx); await entered.promise;
          ledger.change(submitted.task!, current => { current.nextPollAt = 0; });
          const blocked = await standaloneExecutor("video", options).poll(submitted.handle, ctx); assert.equal(blocked.state, "pending"); assert.equal(queries, 1);
          ledger.change(submitted.task!, current => { current.queryClaim!.startedAt = Date.now() - 10 * 60_000 - 1; current.nextPollAt = 0; });
          const successor = ledger.claimQuery(submitted.task!); assert.ok(successor);
          assert.equal(ledger.changeQuery(submitted.task!, successor, current => { current.state = "succeeded"; current.stage = "downloaded"; current.outputs = [saved]; delete current.queryClaim; }), true);
          release.resolve(); const stale = await first;
          assert.equal(stale.state, "done"); if (stale.state === "done") { validateMedia(stale.value.data, "video"); assert.ok(isResourceRef(stale.value.data)); assert.equal(stale.value.data.$resource, saved.sha256); }
          assert.equal(ledger.get(submitted.task!).state, "succeeded"); assert.equal(ledger.get(submitted.task!).error, undefined);
          assert.equal(queries, 1);
        } finally { release.resolve(); ledger.close(); }
      } finally { globalThis.fetch = original; }
    });
  });
});

test("MiniMax expiry terminates an orphaned query while retaining receipt and forbidding regeneration", async () => {
  await fixture(async (home, ctx) => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ base_resp: { status_code: 0 }, task_id: "expired-receipt" }); };
    try {
      const options = { home, environment }; const snapshot = (await standaloneModels("video", options))[0]!.description;
      const request = { model: "minimax/MiniMax-H3", backend: "standalone", arguments: { prompt: "expiry", resolution: "768P", duration: 4, aspectRatio: "16:9" }, capabilitySnapshot: snapshot } as unknown as Json;
      const executor = standaloneExecutor("video", options); const submitted = await executor.submit(request, ctx);
      const ledger = await StandaloneLedger.open(join(home, "gateway"));
      try { ledger.change(submitted.task!, current => { current.acceptedAt = new Date(Date.now() - 8 * 86400_000).toISOString(); current.queryClaim = { token: "orphaned-query", pid: 2_147_483_647, startedAt: Date.now() - 11 * 60_000 }; current.nextPollAt = 0; }); } finally { ledger.close(); }
      const result = await executor.poll(submitted.handle, ctx); assert.equal(result.state, "failed");
      if (result.state === "failed") { assert.equal(result.code, "GATEWAY_RECEIPT_EXPIRED"); assert.equal(result.receipt, "expired-receipt"); assert.equal(result.charged, "maybe"); }
      assert.equal((await executor.submit(request, ctx)).task, submitted.task); assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
  });
});
