import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, WHISPERX_VERSION } from "../../asr/install.ts";
import { standardWavSamples, transcriptFromReply } from "./transcribe.ts";

const bin = fileURLToPath(new URL("../../../bin/dsivio-video.mjs", import.meta.url));
const ffmpeg = process.env.DSIVIO_VIDEO_FFMPEG ?? "/Users/zmmini/zmdata/work/Dsivio/src-tauri/resources/video-runtime/analyzer/node_modules/ffmpeg-static/ffmpeg";
async function execute(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(command, args, { env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer) => { stdout += data; });
  child.stderr.on("data", (data: Buffer) => { stderr += data; });
  const completion = Promise.withResolvers<{ code: number; stdout: string; stderr: string }>();
  child.once("error", completion.reject);
  child.once("close", (code) => completion.resolve({ code: code ?? -1, stdout, stderr }));
  return completion.promise;
}

test("sample-domain conversion drops invalid boundaries and preserves missing measurements", () => {
  const document = transcriptFromReply({ language: "en", segments: [{ text: "ignored", start: 0, end: 1, words: [{ text: "one", start: 0.12345, end: 0.3, score: 0.8 }, { text: "missing" }, { text: "reversed", start: 0.9, end: 0.8, score: 2 }, { text: "outside", start: -0.00001, end: 1.00001 }] }] }, "/a.wav", "zh", 16000, "test");
  assert.equal(document.language, "zh");
  assert.deepEqual(document.blocks[0], { text: "one missing reversed outside", startSec: 0, endSec: 1, tokens: [{ text: "one", startSec: 0.123, endSec: 0.3, confidence: 0.8 }, { text: "missing" }, { text: "reversed" }, { text: "outside" }] });
  const fallback = transcriptFromReply({ language: "en", segments: [{ text: "segment", words: [] }], words: [{ text: "fallback", end: 0.5 }] }, "/a.wav", "en", 16000, "test");
  assert.deepEqual(fallback.blocks, [{ text: "fallback", tokens: [{ text: "fallback", endSec: 0.5 }] }]);
});

test("CLI falls back from unavailable Dsivio to fake HTTP ASR and publishes without overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "dv-transcribe-test-"));
  const config = { model: "small", device: "cpu", compute: "int8", batchSize: 8 };
  let seenAudio: Buffer | undefined;
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/health") { response.end(JSON.stringify({ ok: true, protocol: ASR_PROTOCOL, serviceVersion: ASR_SERVICE_VERSION, whisperxVersion: WHISPERX_VERSION, ...config })); return; }
    let body = "";
    request.on("data", (part: Buffer) => { body += part; });
    request.on("end", async () => {
      requests++;
      const value = JSON.parse(body);
      assert.equal(value.language, "zh");
      assert.equal(await standardWavSamples(value.audio_path), 16000);
      seenAudio = await readFile(value.audio_path);
      response.end(JSON.stringify({ language: "zh", segments: [{ text: "今天", start: 0, end: 1, words: [{ text: "今", start: 0.125, end: 0.3, score: 0.9 }, { text: "天" }] }] }));
    });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const installation = join(root, ".dsivio-video", "asr", ASR_SERVICE_VERSION);
    const python = join(installation, "venv", "bin", "python");
    await mkdir(dirname(python), { recursive: true });
    await writeFile(python, "fake installation marker");
    await writeFile(join(installation, "config.json"), JSON.stringify({ ...config, languages: ["zh"], cache: join(installation, "cache"), serviceVersion: ASR_SERVICE_VERSION }));
    await writeFile(join(dirname(installation), "run.json"), JSON.stringify({ pid: process.pid, port: address.port }));
    const dsivio = join(root, "dsivio");
    await writeFile(dsivio, "#!/bin/sh\nprintf 'unknown subcommand transcribe\\n' >&2\nexit 2\n", { mode: 0o755 });
    const input = join(root, "input.wav");
    const generated = await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", input], process.env);
    assert.equal(generated.code, 0, generated.stderr);
    const env = { ...process.env, HOME: root, DSIVIO_VIDEO_DSIVIO: dsivio, DSIVIO_VIDEO_FFMPEG: ffmpeg };
    const output = join(root, "nested", "transcript.json");
    const command = await execute(process.execPath, [bin, "transcribe", input, "--language", "zh", "--to", output, "--json"], env);
    assert.equal(command.code, 0, command.stdout + command.stderr);
    const summary = JSON.parse(command.stdout);
    assert.equal(summary.extracted, false);
    assert.equal(summary.words, 2);
    assert.equal(summary.durationSec, 1);
    assert.deepEqual(seenAudio, await readFile(input));
    const document = JSON.parse(await readFile(output, "utf8"));
    assert.equal(document.format, "dsivio-video.transcript/1");
    assert.deepEqual(document.blocks[0].tokens, [{ text: "今", startSec: 0.125, endSec: 0.3, confidence: 0.9 }, { text: "天" }]);
    const second = await execute(process.execPath, [bin, "transcribe", input, "--language", "zh", "--to", output, "--json"], env);
    assert.equal(second.code, 1);
    assert.equal(requests, 1);
    assert.equal(await readFile(output, "utf8"), JSON.stringify(document, null, 2) + "\n");
    const mp3 = join(root, "input.mp3");
    assert.equal((await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", input, mp3], process.env)).code, 0);
    const converted = await execute(process.execPath, [bin, "transcribe", mp3, "--language", "zh", "--to", join(root, "converted.json"), "--json"], env);
    assert.equal(converted.code, 0, converted.stdout + converted.stderr);
    assert.equal(JSON.parse(converted.stdout).extracted, true);
  } finally {
    server.closeAllConnections();
    const closing = Promise.withResolvers<void>();
    server.close((error) => error ? closing.reject(error) : closing.resolve());
    await closing.promise;
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI rejects language auto and unavailable backends with actionable errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "dv-transcribe-unavailable-"));
  try {
    const input = join(root, "input.wav");
    assert.equal((await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.2", "-ac", "1", "-ar", "16000", input], process.env)).code, 0);
    const env = { ...process.env, HOME: root, DSIVIO_VIDEO_DSIVIO: join(root, "missing") };
    const automatic = await execute(process.execPath, [bin, "transcribe", input, "--language", "auto", "--to", join(root, "auto.json"), "--json"], env);
    assert.equal(automatic.code, 2);
    assert.equal(JSON.parse(automatic.stdout).error.code, "CLI_USAGE");
    const unavailable = await execute(process.execPath, [bin, "transcribe", input, "--language", "en", "--to", join(root, "missing.json"), "--json"], env);
    assert.equal(unavailable.code, 1);
    assert.equal(JSON.parse(unavailable.stdout).error.code, "TRANSCRIBE_UNAVAILABLE");
    assert.match(JSON.parse(unavailable.stdout).error.hint, /dsivio-video setup asr/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
