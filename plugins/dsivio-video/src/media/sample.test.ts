import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleRange, readRanges } from "./sample.ts";
import { validateTranscript, matchPhrase, transcriptContext } from "./transcript.ts";

const transcript = validateTranscript({ format: "dsivio-video.transcript/1", source: "/fixture.mp4", language: "zh", durationSec: 10, engine: "fixture", blocks: [{ text: "", tokens: [
  { text: "Ｈｅｌｌｏ，", startSec: 1, endSec: 1.5 }, { text: "WORLD!", startSec: 1.5, endSec: 2 },
  { text: "你好", startSec: 3, endSec: 3.5 }, { text: "世界", startSec: 3.5, endSec: 4 },
  { text: "你好", startSec: 6, endSec: 6.5 }, { text: "世界", startSec: 6.5, endSec: 7 }, { text: "unknown" },
] }] });

test("every excludes end, at is strict, and grids use midpoint defaults", () => {
  assert.deepEqual(sampleRange(2, { every: "0.5", start: "0.5", end: "1.5" }).requestedTimes, [0.5, 1]);
  assert.deepEqual(sampleRange(2, {}).requestedTimes, [0.25, 0.75, 1.25, 1.75]);
  assert.equal(sampleRange(6, {}).requestedTimes.length, 9);
  assert.deepEqual(sampleRange(4, { frames: "2" }).requestedTimes, [1, 3]);
  assert.deepEqual(sampleRange(2, { at: "0,1.1234" }).requestedTimes, [0, 1.123]);
  assert.throws(() => sampleRange(2, {}, undefined, true), /requires --at/);
  assert.throws(() => sampleRange(2, { at: "1,1" }), /strictly increasing/);
  assert.throws(() => sampleRange(2, { at: "0.0001,0.0002" }), /duplicate after millisecond/);
  assert.throws(() => sampleRange(0.001, { frames: "4" }), /duplicate|outside/);
  assert.throws(() => sampleRange(2, { at: "2" }), /earlier than 2/);
  assert.throws(() => sampleRange(2, { at: "1", start: "0" }), /cannot be combined/);
  assert.throws(() => sampleRange(2, { every: "0.0009" }), /at least 0.001/);
  assert.throws(() => sampleRange(2, { everyFrame: true, frames: "4" }), /cannot be combined/);
});
test("around matches normalized whole consecutive tokens, including Chinese occurrences", () => {
  assert.equal(matchPhrase(transcript, "hello world").length, 1);
  assert.equal(matchPhrase(transcript, "ell").length, 0);
  assert.equal(matchPhrase(transcript, "你好，世界！").length, 2);
  assert.throws(() => sampleRange(10, { around: "你好世界" }, transcript), /1: 3–4s, 2: 6–7s/);
  const range = sampleRange(10, { around: "你好世界", occurrence: "2", padding: "0.5", frames: "2" }, transcript);
  assert.equal(range.startSec, 5.5);
  assert.equal(range.endSec, 7.5);
  assert.deepEqual(range.requestedTimes, [6, 7]);
  assert.throws(() => sampleRange(10, { around: "你好世界", occurrence: "3" }, transcript), /exceeds 2/);
  assert.throws(() => sampleRange(10, { padding: "1" }), /require --around/);
  assert.throws(() => sampleRange(10, { around: "unknown" }, transcript), /lacks its first word start/);
  assert.throws(() => matchPhrase(transcript, "， ！"), /non-empty phrase/);
});
test("transcript missing times remain absent and active words use half-open actual time", () => {
  assert.equal(transcript.blocks[0]!.tokens.at(-1)!.startSec, undefined);
  assert.deepEqual(transcriptContext(transcript, 3.5).activeTokens.map(token => token.text), ["世界"]);
  assert.equal(transcriptContext(transcript, 4).activeTokens.length, 0);
  const unknown = validateTranscript({ ...transcript, blocks: [{ text: "", tokens: [{ text: "unknown" }] }] });
  assert.deepEqual(transcriptContext(unknown, 0), { activeTokens: [], contextTokens: [] });
  assert.throws(() => validateTranscript({ ...transcript, format: "old.transcript/1" }), /Expected format/);
  assert.throws(() => validateTranscript({ ...transcript, blocks: [{ text: "", tokens: [{ text: "bad", startSec: 2, endSec: 1 }] }] }), /precedes/);
});
test("ranges preserve order, allow overlap and override the other sampling mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dv-ranges-"));
  try {
    const file = join(dir, "ranges.json");
    await writeFile(file, JSON.stringify([{ start: 2, end: 4, id: "later", frames: 2 }, { start: 1, end: 3, id: "earlier", every: 1 }]));
    const ranges = await readRanges(file, 6, { every: "0.5" });
    assert.deepEqual(ranges.map(range => range.requestedTimes), [[2.5, 3.5], [1, 2]]);
    await writeFile(file, JSON.stringify([{ start: 0, end: 1, id: "same" }, { start: 1, end: 2, id: "same" }]));
    await assert.rejects(readRanges(file, 6, {}), /Duplicate range id/);
    assert.equal((await readRanges(file, 6, { everyFrame: true })).length, 2);
    await assert.rejects(readRanges(file, 6, { at: "1" }), /cannot be combined/);
    await writeFile(file, JSON.stringify([{ start: 0, end: 1, frames: 2 }]));
    await assert.rejects(readRanges(file, 6, { everyFrame: true }), /Raw ranges/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
