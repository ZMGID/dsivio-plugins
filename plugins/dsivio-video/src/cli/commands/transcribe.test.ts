import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { standardWavSamples } from "../../asr/wav.ts";
import { localAsrModel } from "../../asr/backend.ts";
import { transcriptFromReply } from "./transcribe.ts";
const bin = fileURLToPath(new URL("../../../bin/dsivio-video.mjs", import.meta.url));
function wav(samples = 16000): Buffer {
  const data = Buffer.alloc(44 + samples * 2); data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(samples * 2, 40); return data;
}
async function execute(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [bin, ...args], { env, cwd, timeout: 10000 }); let stdout = "", stderr = "";
  child.stdout.on("data", (data: Buffer) => { stdout += data; }); child.stderr.on("data", (data: Buffer) => { stderr += data; });
  const completion = Promise.withResolvers<{ code: number; stdout: string; stderr: string }>(); child.once("error", completion.reject); child.once("close", code => completion.resolve({ code: code ?? -1, stdout, stderr })); return completion.promise;
}
test("sample-domain conversion preserves 16kHz precision without invented measurements", () => {
  const document = transcriptFromReply({ language: "en", segments: [{ text: "ignored", start: 0, end: 1, words: [{ text: "one", start: 0.12345, end: 0.3, score: 0.8 }, { text: "missing" }, { text: "reversed", start: 0.9, end: 0.8, score: 2 }, { text: "outside", start: -0.00001, end: 1.00001 }] }] }, "/a.wav", "en", 16000, "test");
  assert.deepEqual(document.blocks[0], { text: "one missing reversed outside", startSec: 0, endSec: 1, tokens: [{ text: "one", startSec: 1975 / 16000, endSec: 0.3, confidence: 0.8 }, { text: "missing" }, { text: "reversed" }, { text: "outside" }] });
  assert.equal(transcriptFromReply({ language: "en", segments: [] }, "/a.wav", "en", 1, "test").durationSec, 1 / 16000);
});
test("standard WAV rejects trailing bytes, duplicate data and nonstandard format", async t => {
  const root = await mkdtemp(join(tmpdir(), "dv-wav-boundaries-")); t.after(() => rm(root, { recursive: true, force: true })); const file = join(root, "audio.wav");
  await writeFile(file, wav(3)); assert.equal(await standardWavSamples(file), 3);
  await writeFile(file, Buffer.concat([wav(3), Buffer.from([0])])); assert.equal(await standardWavSamples(file), undefined);
  const stereo = wav(); stereo.writeUInt16LE(2, 22); await writeFile(file, stereo); assert.equal(await standardWavSamples(file), undefined);
  const duplicate = Buffer.concat([wav(3), Buffer.from("data"), Buffer.from([2, 0, 0, 0, 0, 0])]); duplicate.writeUInt32LE(duplicate.length - 8, 4); await writeFile(file, duplicate); assert.equal(await standardWavSamples(file), undefined);
});
test("CLI decodes standard MediaTask transcript and never overwrites published output", async t => {
  const root = await mkdtemp(join(tmpdir(), "dv-transcribe-task-")); t.after(() => rm(root, { recursive: true, force: true })); await mkdir(join(root, ".dsivio-video")); await writeFile(join(root, ".dsivio-video", "config.json"), JSON.stringify({ gateway: "dsivio" }));
  const input = join(root, "input.wav"), output = join(root, "transcript.json"); await writeFile(input, wav());
  const transcript = { schema: "dsivio.media.transcript/1", language: "zh", sampleRate: 16000, sampleFrames: 16000, engine: { backend: "local", model: "small", protocol: "dsivio-video.asr/1", serviceVersion: "0.2.0", whisperxVersion: "3.8.6" }, segments: [{ text: "今天", start: 0, end: 1, words: [{ text: "今", start: 0.12345, end: 0.3, score: 0.9 }, { text: "天" }] }] };
  await writeFile(join(root, "config.json"), JSON.stringify({ models: [localAsrModel()], transcript }));
  const env = { ...process.env, HOME: root, FAKE_DSIVIO_DIR: root, DSIVIO_VIDEO_DSIVIO: fileURLToPath(new URL("../../../test/fixtures/fake-dsivio.mjs", import.meta.url)) };
  const reply = await execute(root, ["transcribe", input, "--language", "zh", "--to", output, "--json"], env); assert.equal(reply.code, 0, reply.stdout + reply.stderr);
  const document = JSON.parse(await readFile(output, "utf8")); assert.equal(document.durationSec, 1); assert.deepEqual(document.blocks[0].tokens, [{ text: "今", startSec: 1975 / 16000, endSec: 0.3, confidence: 0.9 }, { text: "天" }]);
  const original = await readFile(output, "utf8"), second = await execute(root, ["transcribe", input, "--language", "zh", "--to", output, "--json"], env); assert.equal(second.code, 1); assert.equal(await readFile(output, "utf8"), original);
});
test("CLI business/old-host errors cannot start standalone ASR", async t => {
  const root = await mkdtemp(join(tmpdir(), "dv-transcribe-rejected-")); t.after(() => rm(root, { recursive: true, force: true }));
  const host = join(root, "old-host"), input = join(root, "input.wav"); await writeFile(input, wav()); await writeFile(host, "#!/bin/sh\nprintf 'unknown subcommand transcribe\\n' >&2\nexit 2\n", { mode: 0o755 });
  const env = { ...process.env, HOME: root, DSIVIO_VIDEO_DSIVIO: host }, result = await execute(root, ["transcribe", input, "--language", "en", "--to", join(root, "output.json"), "--json"], env);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, "GATEWAY_MODELS_FAILED"); await assert.rejects(readFile(join(root, ".dsivio-video", "asr", "0.2.0", "config.json")), { code: "ENOENT" });
});
