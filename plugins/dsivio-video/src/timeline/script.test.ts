import test from "node:test";
import assert from "node:assert/strict";
import { parseScript } from "./script.ts";
import { validateCaptionDocument, validateNarrative } from "./validate.ts";

test("Dual Text preserves pronunciation, N:M display, hidden speech, attributes and cues", () => {
  const s = parseScript('<intro><HOST>现在 <2018年{importance=2}|twenty eighteen>。|| <组件化|> < |spoken only></intro><silent/>', "story");
  assert.equal(s.speech, "现在 twenty eighteen。 组件化 spoken only");
  assert.equal(s.dialogue, "HOST: 现在 twenty eighteen。 组件化 spoken only");
  assert.deepEqual(s.narrative.tokens.map(t => t.speechText), ["现", "在", "twenty", "eighteen", "组", "件", "化", "spoken", "only"]);
  assert.deepEqual(s.narrative.captions.units.map(u => [u.text, u.tokenBounds]), [["现", { start: 0, end: 1 }], ["在", { start: 1, end: 2 }], ["2018年。", { start: 2, end: 4 }], ["组件化", { start: 4, end: 7 }], ["", { start: 7, end: 9 }]]);
  assert.equal(s.narrative.captions.units[2]!.attributes.importance, 2);
  assert.deepEqual(s.narrative.captions.cues.map(c => c.unitKeys.length), [3, 2]);
  assert.deepEqual(s.segments.silent!.tokenBounds, { start: 9, end: 9 });
  assert.deepEqual(s.segmentTexts.silent, { speech: "", dialogue: "" });
  assert.equal(s.narrative.anchors.length, 2 * 9 + 2 * 2 + 2);
});

test("comments are transparent; mixed scripts, contractions, numbers and authored spacing survive", () => {
  const s = parseScript('<a>hel<!-- note -->lo don’t Latin汉 1,234.5 12–15。  中 文</a>', "story");
  assert.deepEqual(s.narrative.tokens.map(t => t.speechText), ["hello", "don’t", "Latin", "汉", "1,234.5", "12–15", "中", "文"]);
  assert.equal(s.speech, "hello don’t Latin汉 1,234.5 12–15。 中 文");
  assert.equal(s.narrative.captions.units.map(u => u.separator + u.text).join(""), s.speech);
  assert.equal(parseScript('<a> hello   world </a>', "story").narrative.storyKey, parseScript('<a>hello world</a>', "story").narrative.storyKey);
});

test("crossing selections, affinity and structure edges bind distinct existing anchors", () => {
  const s = parseScript('@{whole}<a>@{one}first @{~left!}@{two}second @{/one~}third@{/two}</a><b/>@{/whole}', "story");
  const n = s.narrative;
  assert.deepEqual(n.selections.map(s => [s.selectionKey, s.tokenBounds]), [["one", { start: 0, end: 2 }], ["two", { start: 1, end: 3 }], ["whole", { start: 0, end: 3 }]]);
  assert.equal(n.moments[0]!.anchorKey, n.tokens[0]!.anchors.end);
  assert.equal(n.selections[0]!.anchors.end, n.tokens[2]!.anchors.start);
  assert.equal(n.selections[2]!.anchors.start, n.storyAnchors.start);
  assert.equal(n.selections[2]!.anchors.end, n.storyAnchors.end);
  assert.notEqual(s.segments.b!.anchors.start, s.segments.b!.anchors.end);
});

test("shared Dual Text supports word attributes and inline semantic markers", () => {
  const s = parseScript('<a><@{claim}组件{emphasis}化@{/claim}|></a>', "story");
  assert.equal(s.speech, "组件化");
  assert.equal(s.narrative.captions.units[0]!.text, "组件化");
  assert.equal(s.narrative.captions.units[0]!.attributes.emphasis, true);
  assert.deepEqual(s.narrative.selections[0]!.tokenBounds, { start: 0, end: 3 });
});

test("markers before a Dual Text bind its next token, not the segment end", () => {
  const s = parseScript('<a>first @{cue!}<X|second word> last</a>', "story");
  assert.equal(s.narrative.moments[0]!.anchorKey, s.narrative.tokens[1]!.anchors.start);
});

test("role state is local to each segment, and reserved escapes remain text", () => {
  const s = parseScript('<a><HOST>Hello \\@image1 \\<literal> \\{x\\} \\| \\\\</a><b>Again</b>', "story");
  assert.equal(s.segmentTexts.a!.dialogue, "HOST: Hello @image1 <literal> {x} | \\");
  assert.equal(s.segmentTexts.b!.dialogue, "Again");
});

test("caption cues retain roles through cue breaks and omit roles in unlabelled turns", () => {
  const n = parseScript('<a><HOST>first|| second<GUEST>third</a><b>fourth</b>', "story").narrative;
  assert.deepEqual(n.captions.cues.map(cue => cue.role), ["HOST", "HOST", "GUEST", undefined]);
  assert.equal(Object.hasOwn(n.captions.cues[3]!, "role"), false);
  assert.deepEqual(n.captions.cues.map(cue => cue.unitKeys.length), [1, 1, 1, 1]);
  assert.throws(() => validateCaptionDocument({ ...n.captions, cues: n.captions.cues.map((cue, index) => index ? cue : { ...cue, role: 42 }) }), { code: "TYPE_INVALID" });
  assert.throws(() => validateCaptionDocument({ ...n.captions, cues: n.captions.cues.map((cue, index) => index ? cue : { ...cue, role: "" }) }), { code: "TYPE_INVALID" });
  assert.throws(() => validateNarrative({ ...n, captions: { ...n.captions, cues: n.captions.cues.map((cue, index) => index ? cue : { ...cue, role: "GUEST" }) } }), { code: "TYPE_INVALID" });
});

test("structural markers retain segment/story edges even when token positions coincide", () => {
  const s = parseScript('@{whole}<empty/>@{left!}@{~right!}<spoken>word</spoken>@{/whole}', "story");
  assert.equal(s.narrative.moments[0]!.anchorKey, s.segments.spoken!.anchors.start);
  assert.equal(s.narrative.moments[1]!.anchorKey, s.segments.empty!.anchors.end);
  const empty = parseScript('@{whole}<empty/>@{/whole}', "story").narrative;
  assert.deepEqual(empty.selections[0]!.anchors, empty.storyAnchors);
  assert.deepEqual(empty.selections[0]!.tokenBounds, { start: 0, end: 0 });
});

test("Chinese cue breaks are lexical boundaries, and comments are transparent inside Dual Text", () => {
  const s = parseScript('<a>时间||画面 <X|hel<!-- hidden -->lo></a>', "story");
  assert.equal(s.speech, "时间画面 hello");
  assert.deepEqual(s.narrative.captions.cues.map(c => c.unitKeys.length), [2, 3]);
  assert.equal(s.narrative.tokens.at(-1)!.speechText, "hello");
});

test("punctuation following Dual Text stays with that indivisible display unit", () => {
  const s = parseScript('<a>We <2018|twenty eighteen>. Proceed.</a>', "story");
  assert.equal(s.speech, "We twenty eighteen. Proceed.");
  assert.deepEqual(s.narrative.captions.units.map(u => u.text), ["We", "2018.", "Proceed."]);
  assert.equal(s.narrative.captions.units.map(u => u.separator + u.text).join(""), "We 2018. Proceed.");
});

for (const [body, code] of [
  ['<a>hel@{cue!}lo</a>', "SCRIPT_MARKER_TOKEN_BOUNDARY"], ['<a>word@{cue!}.</a>', "SCRIPT_MARKER_TOKEN_BOUNDARY"],
  ['<a>hel||lo</a>', "SCRIPT_CAPTION_BREAK_TOKEN"], ['<a>word {emphasis}</a>', "SCRIPT_ATTRIBUTE_BOUNDARY"],
  ['<a>word{tone=warm}{emphasis}</a>', "SCRIPT_ATTRIBUTE_BOUNDARY"], ['<a><X|!!!></a>', "SCRIPT_DUAL_SPEECH"],
  ['<a>Hi<HOST>later</a>', "SCRIPT_ROLE_AFTER_TEXT"], ['<a><HOST></a>', "SCRIPT_ROLE_EMPTY"],
  ['<a>@{x}word</a>', "SCRIPT_SELECTION_UNCLOSED"], ['<a>@{x!}word @{x!}</a>', "SCRIPT_MOMENT_DUPLICATE"],
  ['<a>\\q</a>', "SCRIPT_ESCAPE"], ['<a>x</a><a/>', "SCRIPT_SEGMENT_DUPLICATE"],
  ['<a>wo{emphasis}rd</a>', "SCRIPT_ATTRIBUTE_BOUNDARY"], ['<a>word||</a>', "SCRIPT_CAPTION_BREAK"],
] as const) test(`Script rejects ${code}: ${body}`, () => assert.throws(() => parseScript(body, "story"), { code }));
