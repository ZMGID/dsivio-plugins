import test from "node:test";
import assert from "node:assert/strict";
import { materializeTake, matchTokens } from "./align.ts";
import { parseScript } from "./script.ts";
import type { SynchronizedMedia } from "./types.ts";
import type { AlignmentEvidence } from "../pipeline/types.ts";
const media: SynchronizedMedia = { clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 60, sound: { resource: { $resource: "sound", bytes: 384078, mime: "audio/wav" }, totalSamples: 96000 } };
const evidence = (words: AlignmentEvidence["blocks"][number]["words"]): AlignmentEvidence => ({ sampleRate: 16000, totalSamples: 32000, language: "en", engine: "test", blocks: [{ words, characters: [] }] });

test("exact split and merge have no four-token cap and inserts do not become Script tokens", () => {
  const merged = matchTokens(["一", "二", "三", "四", "五", "六"], [{ text: "一二三四五六" }]);
  assert.equal(merged.cost, 0.055); assert.deepEqual(merged.groups, [{ scriptStart: 0, scriptCount: 6, wordStart: 0, wordCount: 1 }]);
  const split = matchTokens(["abcdef"], ["a", "b", "c", "d", "e", "f"].map(text => ({ text })));
  assert.equal(split.cost, 0.055); assert.equal(split.groups[0]!.wordCount, 6);
  const inserted = matchTokens(["hello", "world"], [{ text: "hello" }, { text: "hesitation" }, { text: "world" }]);
  assert.equal(inserted.cost, 0.35); assert.equal(inserted.inserted, 1); assert.equal(inserted.exact, 2);
});

test("grouped Chinese words locate distinct character windows and retain author selection anchors", () => {
  const script = parseScript("<intro>今天 @{claim}我们@{/claim} 来学习。</intro>", "story");
  const take = materializeTake(script.narrative, script.segments.intro!, media, evidence([{ text: "今天", samples: { start: 1600, end: 8000 } }, { text: "我们", samples: { start: 10000, end: 16000 } }, { text: "来学习", samples: { start: 18000, end: 28000 } }]));
  assert.deepEqual(take.tokens.slice(0, 2).map(t => t.frames), [{ start: 3, end: 9 }, { start: 9, end: 15 }]);
  const selection = script.narrative.selections[0]!;
  assert.equal(take.anchorFrames[selection.anchors.start], 18); assert.equal(take.anchorFrames[selection.anchors.end], 30);
  assert.equal(take.anchorFrames[take.segment.anchors.start], 0); assert.equal(take.anchorFrames[take.segment.anchors.end], 60);
});

test("missing words interpolate by normalized character weights inside voice activity", () => {
  const script = parseScript("<intro>a longer word</intro>", "story");
  const ev = evidence([]); ev.voiceRegions = [{ start: 8000, end: 24000 }];
  const take = materializeTake(script.narrative, script.segments.intro!, media, ev);
  assert.deepEqual(take.tokens.map(t => t.frames), [{ start: 15, end: 18 }, { start: 17, end: 35 }, { start: 34, end: 45 }]);
});

test("character acoustic measurements override equal word subdivisions", () => {
  const script = parseScript("<intro>今天</intro>", "story");
  const ev = evidence([{ text: "今天", samples: { start: 1000, end: 16000 } }]);
  ev.blocks[0]!.characters = [{ wordIndex: 0, text: "今", samples: { start: 1000, end: 4000 } }, { wordIndex: 0, text: "天", samples: { start: 8000, end: 16000 } }];
  const take = materializeTake(script.narrative, script.segments.intro!, media, ev);
  assert.deepEqual(take.tokens.map(t => t.frames), [{ start: 1, end: 8 }, { start: 15, end: 30 }]);
});

test("empty segments require no audio or evidence; invalid/descending measurements fail visibly", () => {
  const script = parseScript("<silent/>", "story");
  const silent: SynchronizedMedia = { clock: media.clock, totalFrames: 60, picture: { resource: { $resource: "picture", bytes: 100, mime: "video/mp4" }, extent: { widthPx: 128, heightPx: 96 }, alpha: "opaque" } };
  const take = materializeTake(script.narrative, script.segments.silent!, silent);
  assert.deepEqual(take.tokens, []); assert.deepEqual(Object.values(take.anchorFrames), [0, 60]);
  const spoken = parseScript("<intro>hello world</intro>", "story");
  assert.throws(() => materializeTake(spoken.narrative, spoken.segments.intro!, media, evidence([{ text: "hello", samples: { start: 16000, end: 24000 } }, { text: "world", samples: { start: 1000, end: 4000 } }])));
  const bad = evidence([{ text: "hello", samples: { start: 0, end: 32001 } }]);
  assert.throws(() => materializeTake(spoken.narrative, spoken.segments.intro!, media, bad), { code: "EVIDENCE_WINDOW" });
});
