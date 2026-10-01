import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { DvError } from "../core/errors.ts";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, WHISPERX_VERSION } from "./install.ts";
import { healthAsr, transcribeAsr } from "./client.ts";

const config = { model: "small", device: "cpu", compute: "int8", batchSize: 8 };
const health = { ok: true, protocol: ASR_PROTOCOL, serviceVersion: ASR_SERVICE_VERSION, whisperxVersion: WHISPERX_VERSION, ...config };
async function fixture(run: (port: number) => Promise<void>, respond: (path: string, response: ServerResponse, body: string) => void): Promise<void> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (part: string) => { body += part; });
    request.on("end", () => respond(request.url ?? "", response, body));
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    await run(address.port);
  } finally {
    server.closeAllConnections();
    const closing = Promise.withResolvers<void>();
    server.close((error) => error ? closing.reject(error) : closing.resolve());
    await closing.promise;
  }
}

test("client verifies identity and preserves measured versus missing word boundaries", async () => {
  await fixture(async (port) => {
    const actual = await transcribeAsr(port, config, "/tmp/audio.wav", "zh");
    assert.deepEqual(actual.reply.segments[0]?.words, [{ text: "今", start: 0.125, end: 0.3, score: 0.9 }, { text: "天" }]);
  }, (path, response, body) => {
    response.setHeader("Content-Type", "application/json");
    if (path === "/health") response.end(JSON.stringify(health));
    else {
      assert.deepEqual(JSON.parse(body), { audio_path: "/tmp/audio.wav", language: "zh" });
      response.end(JSON.stringify({ language: "zh", segments: [{ text: "今天", words: [{ text: "今", start: 0.125, end: 0.3, score: 0.9 }, { text: "天" }] }] }));
    }
  });
});

test("client rejects health configuration mismatch before inference", async () => {
  await fixture(async (port) => {
    await assert.rejects(healthAsr(port, config), (error: unknown) => error instanceof DvError && error.code === "ASR_CONFIG_MISMATCH");
  }, (path, response) => { assert.equal(path, "/health"); response.end(JSON.stringify({ ...health, model: "large-v3" })); });
});

for (const code of ["BUSY", "RESOURCE_NOT_PREPARED", "INVALID_INPUT", "INFERENCE_FAILED"]) {
  test(`client exposes service error ${code} without retry`, async () => {
    let calls = 0;
    await fixture(async (port) => {
      await assert.rejects(transcribeAsr(port, config, "/tmp/a.wav", "en"), (error: unknown) => error instanceof DvError && error.code === code);
      assert.equal(calls, 1);
    }, (path, response) => {
      if (path === "/health") response.end(JSON.stringify(health));
      else { calls++; response.statusCode = code === "INFERENCE_FAILED" ? 500 : 503; response.end(JSON.stringify({ error: { code, message: "test rejection" } })); }
    });
  });
}

test("client timeout covers inference after health", async () => {
  // Real fetch/AbortSignal integration: a deliberately silent HTTP peer must time out.
  await fixture(async (port) => {
    await assert.rejects(transcribeAsr(port, config, "/tmp/a.wav", "en", 100), (error: unknown) => error instanceof DvError && error.code === "ASR_TIMEOUT");
  }, (path, response) => {
    if (path === "/health") response.end(JSON.stringify(health));
    // Leave inference unanswered; the client's platform timeout aborts its socket.
  });
});

test("client rejects malformed success responses", async () => {
  await fixture(async (port) => {
    await assert.rejects(transcribeAsr(port, config, "/tmp/a.wav", "en"), (error: unknown) => error instanceof DvError && error.code === "ASR_RESPONSE_INVALID");
  }, (path, response) => response.end(JSON.stringify(path === "/health" ? health : { language: "en", segments: [{ words: [] }] })));
});

test("caller cancellation interrupts inference without becoming a timeout", async () => {
  const controller = new AbortController();
  await fixture(async (port) => {
    await assert.rejects(transcribeAsr(port, config, "/tmp/a.wav", "en", 600_000, controller.signal), (error: unknown) => error instanceof DvError && error.code === "ABORTED");
  }, (path, response) => {
    if (path === "/health") response.end(JSON.stringify(health));
    else controller.abort();
  });
});
