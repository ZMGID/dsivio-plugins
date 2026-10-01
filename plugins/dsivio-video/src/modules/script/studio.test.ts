import test from "node:test";
import assert from "node:assert/strict";
import { parseScript, rewriteScriptAnchor } from "../../timeline/script.ts";
import type { ScriptPatch } from "../../timeline/script.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthorDetailed } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import type { Narrative, Timeline } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { scriptStudio } from "./studio.ts";
import type { CompanionInput } from "../../studio/companion.ts";

function apply(body: string, patches: readonly ScriptPatch[], start = 0): string {
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
    assert.equal(body.slice(patch.start - start, patch.end - start), patch.expectedText);
    body = body.slice(0, patch.start - start) + patch.text + body.slice(patch.end - start);
  }
  return body;
}

test("marker inverse preserves Dual Text, attributes, comments, escapes and UTF-16 source", () => {
  const body = '<intro>😀 @{cue!}first <第二{emphasis}|sec<!--keep-->ond>  third\\@x</intro>';
  const parsed = parseScript(body, "story", "source.dvml", 80);
  const target = parsed.narrative.tokens[1]!.anchors.start;
  const patches = rewriteScriptAnchor(parsed.sourceMap, "cue", "cue", target);
  const rewritten = apply(body, patches, 80);
  assert.equal(rewritten, '<intro>😀 first <第二{emphasis}|@{cue!}sec<!--keep-->ond>  third\\@x</intro>');
  const after = parseScript(rewritten, "story");
  assert.deepEqual(after.narrative.tokens.map(item => item.speechText), parsed.narrative.tokens.map(item => item.speechText));
  assert.deepEqual(after.narrative.captions.units.map(item => [item.text, item.attributes]), parsed.narrative.captions.units.map(item => [item.text, item.attributes]));
  assert.deepEqual(parsed.sourceMap.tokens[1]!.slices.map(item => item.text), ["sec", "ond"]);
});

test("shared Dual Text markers retain exact raw offsets and move to attributed word end", () => {
  const body = '<a><@{x}中{emphasis}文@{/x}|> next.</a>';
  const parsed = parseScript(body, "story");
  assert.equal(parsed.sourceMap.markers[0]!.text, "@{x}");
  assert.equal(parsed.sourceMap.markers[0]!.start, body.indexOf("@{x}"));
  const end = parsed.narrative.tokens[0]!.anchors.end;
  const rewritten = apply(body, rewriteScriptAnchor(parsed.sourceMap, "x", "end", end));
  assert.equal(rewritten, '<a><@{x}中{emphasis}@{/x}文|> next.</a>');
});

test("reanchoring to distinct coincident structural anchors preserves identity", () => {
  const body = '@{cue!}<empty/><a>word</a>';
  const parsed = parseScript(body, "story");
  const rewritten = apply(body, rewriteScriptAnchor(parsed.sourceMap, "cue", "cue", parsed.segments.empty!.anchors.end));
  assert.equal(rewritten, '<empty/>@{~cue!}<a>word</a>');
  assert.deepEqual(rewriteScriptAnchor(parsed.sourceMap, "cue", "cue", parsed.narrative.storyAnchors.start), []);
});

test("semantic projection carries placed authoritative clock facts and exact source identity", t => {
  const dir = mkdtempSync(join(tmpdir(), "dv-script-studio-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "main.dvml");
  writeFileSync(file, '<?dvml using="dsivio-video/markup@1"?><dvml><import as="script" from="dsivio-video/script@1"/><script:Script id="story"><a>@{claim}first second@{/claim} @{cue!}third</a></script:Script></dvml>');
  const { graph, authoring } = compileAuthorDetailed(file, Workspace.open({ cwd: dir }));
  const value = graph.records.get(graph.publicRecords.get("story")!)!.value;
  const narrative = value.data as unknown as Narrative; const segment = narrative.segments[0]!;
  const anchorFrames: Record<string, number> = { [segment.anchors.start]: 0, [segment.anchors.end]: 30 };
  narrative.tokens.forEach((token, index) => { anchorFrames[token.anchors.start] = index * 10; anchorFrames[token.anchors.end] = (index + 1) * 10; });
  const clock = { fps: { numerator: 30, denominator: 1 } };
  const timeline: Timeline = { axisKey: "axis-test", clock, totalFrames: 30, storyKey: narrative.storyKey, storyAnchors: narrative.storyAnchors, placements: [{ placementKey: "placement-test", offsetFrames: 0, take: { storyKey: narrative.storyKey, storyAnchors: narrative.storyAnchors, segment, tokens: narrative.tokens.map((token, index) => ({ tokenKey: token.tokenKey, frames: { start: index * 10, end: (index + 1) * 10 } })), anchorFrames, media: { clock, totalFrames: 30, sound: { resource: { $resource: "source-test", bytes: 192000, mime: "audio/wav" }, totalSamples: 48000 } } } }] };
  const author = [...authoring.elements.values()].find(element => element.surface.endsWith("Script"))!;
  const input: CompanionInput = { value, type: timelineTypes.narrative, moduleId: "dsivio-video/script@1", surface: "Script", output: "", outputKey: graph.publicRecords.get("story")!, authorKey: author.authorKey, authorGraph: graph, authoring, provenance: { kind: "author" }, inputs: {}, executionEdges: [], supports: {}, timeline, document: { version: "dsivio-video.visual/1", compositionKey: "composition-test", domain: { axisKey: timeline.axisKey, clock, totalFrames: 30, totalSamples48k: 48000 }, extent: { widthPx: 800, heightPx: 600 }, resources: [], surfaces: [], html: "" }, fallback() { throw new Error("Unexpected fallback"); } };
  const projection = scriptStudio.project(input);
  const claim = projection.entities.find(entity => entity.semanticKind === "selection")!;
  assert.deepEqual(claim.intervals, [{ start: 0, end: 20 }]);
  assert.equal(claim.temporal.find(authority => authority.key === "claim:start")!.window!.frames.start, 0);
  assert.equal(claim.temporal.find(authority => authority.key === "claim:end")!.anchorKey, narrative.tokens[1]!.anchors.end);
  assert.deepEqual(claim.temporal.find(authority => authority.key === "claim:range")!.gestures, ["move"]);
  assert.equal(claim.facts.selectionKey, "claim");
  assert.equal(projection.entities.find(entity => entity.semanticKind === "moment")!.temporal[0]!.instant!.frame, 20);
  const word = projection.entities.find(entity => entity.semanticKind === "word")!;
  assert.equal(word.editorKey, `${author.authorKey}/word/0`);
  assert.equal(word.sourceSlice!.text, "first");
});
