import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthor } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import script from "../script/index.ts";
import program from "../program/index.ts";
import time, { decodeInstantAttributes, decodeWindowAttributes } from "./index.ts";
import type { InstantDecodeOptions } from "./index.ts";
import { DvError } from "../../core/errors.ts";
import type { ElaborationContext } from "../../core/module.ts";
import type { Value } from "../../core/value.ts";
import { parseMarkup } from "../../markup/parse.ts";
import { parseScript } from "../../timeline/script.ts";
import { assembleTimeline, parseClock } from "../../timeline/timeline.ts";
import { projectInstant, projectWindow } from "../../timeline/temporal.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { SemanticTake } from "../../timeline/types.ts";
import text from "../text/index.ts";

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "dv-author-time-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modules = [script, program, time, text];
  const registry = { findModule: (id: string) => modules.find(m => m.id === id), findProducer: (ref: string) => { const at = ref.lastIndexOf("#"); return modules.find(m => m.id === ref.slice(0, at))?.producers[ref.slice(at + 1)]; }, findFrontend: () => undefined };
  const workspace = Workspace.open({ cwd: directory });
  const source = (name: string, body: string) => { const path = join(directory, name); writeFileSync(path, `<?dvml using="dsivio-video/markup@1"?><dvml>${body}</dvml>`); return path; };
  const imports = '<import as="script" from="dsivio-video/script@1"/><import as="text" from="dsivio-video/text@1"/><import as="program" from="dsivio-video/program@1"/><import as="time" from="dsivio-video/time@1"/>';
  return { source, imports, compile: (path: string) => compileAuthor(path, workspace, registry) };
}

test("raw Script publishes narrow pronunciation and empty-segment views without build operations", t => {
  const f = fixture(t); const graph = f.compile(f.source("main.dvml", `${f.imports}<script:Script id="story"><intro><HOST>今天先把@{claim}时间与画面@{/claim}分开，再把它们合成一部影片。@{cut!}</intro><silent/></script:Script>`));
  const record = (name: string) => graph.records.get(graph.publicRecords.get(name)!)!.value;
  assert.equal(record("story.segment.intro.speech").data, "今天先把时间与画面分开，再把它们合成一部影片。");
  assert.equal(record("story.segment.intro.dialogue").data, "HOST: 今天先把时间与画面分开，再把它们合成一部影片。");
  assert.equal(record("story.segment.silent.speech").data, "");
  assert.equal(record("story.selection.claim").type, "dsivio-video/script@1#SelectionRef");
  assert.equal(record("story.moment.cut").type, "dsivio-video/script@1#MomentRef");
  assert.equal(graph.operations.size, 0);
});

test("Script public identity cannot be hidden by source import aliases", t => {
  const f = fixture(t); f.source("first.dvml", `${f.imports}<script:Script id="story"><a>first</a></script:Script>`); f.source("second.dvml", `${f.imports}<script:Script id="story"><b>second</b></script:Script>`);
  assert.throws(() => f.compile(f.source("main.dvml", '<import as="one" source="./first.dvml"/><import as="two" source="./second.dvml"/>')), { code: "DUPLICATE_SOURCE_IDENTITY" });
});

test("time author forms reject mixed or unused bindings and malformed instant grammar", t => {
  const f = fixture(t); const prefix = `${f.imports}<script:Script id="story"><a>@{cue!}@{part}hello@{/part}</a></script:Script><program:Clock id="clock" frame-rate="30"/><time:Timeline id="timeline" clock={clock} end="30f"/>`;
  for (const element of [
    '<time:Window id="w" timeline={timeline} during="program" at="0f" for="10f"/>',
    '<time:Window id="w" timeline={timeline} at="0f" for="10f" selection={story.selection.part}/>',
    '<time:Window id="w" timeline={timeline} start="program.start" end="program.end" moment={story.moment.cue}/>',
    '<time:Instant id="i" timeline={timeline} at={story.segment.a}/>',
    '<time:Instant id="i" timeline={timeline} instant="program.end+1f-2f"/>',
    '<time:Instant id="i" timeline={timeline} instant="moment.cue"/>',
    '<time:Instant id="i" timeline={timeline} at="2s" boundary="start"/>',
  ]) assert.throws(() => f.compile(f.source("main.dvml", prefix + element)));
});

test("Script diagnostics carry actual source line and UTF16 offset", t => {
  const f = fixture(t); const path = f.source("main.dvml", `${f.imports}\n<script:Script id="story">\n<a>hel@{bad!}lo</a>\n</script:Script>`);
  assert.throws(() => f.compile(path), error => { assert.ok(error instanceof Error && "span" in error); const span = error.span; assert.ok(span && typeof span === "object" && "line" in span && "column" in span); assert.equal(span.line, 3); assert.equal(span.column, 7); return true; });
});

test("explicit shared Window declarations require a form, unlike default consumer windows", t => {
  const f = fixture(t);
  assert.throws(() => f.compile(f.source("main.dvml", `${f.imports}<time:Timeline id="timeline" frame-rate="30" end="30f"/><time:Window id="missing" timeline={timeline}/>`)), { code: "TIME_WINDOW_FORM_REQUIRED" });
});

test("shared instant decoding restricts origins and projects absolute, semantic and program points", () => {
  const narrative = parseScript('<a>@{cue!}@{part}word@{/part}</a>', "story").narrative;
  const segment = narrative.segments[0]!;
  const token = narrative.tokens[0]!;
  const clock = parseClock("30");
  const take: SemanticTake = {
    storyKey: narrative.storyKey, storyAnchors: narrative.storyAnchors, segment,
    media: { clock, totalFrames: 30, picture: { resource: { $resource: "decoder-picture", bytes: 1, mime: "video/mp4" }, extent: { widthPx: 64, heightPx: 64 }, alpha: "opaque" } },
    tokens: [{ tokenKey: token.tokenKey, frames: { start: 7, end: 9 } }],
    anchorFrames: { [segment.anchors.start]: 0, [segment.anchors.end]: 30, [token.anchors.start]: 7, [token.anchors.end]: 9 },
  };
  const timeline = assembleTimeline(clock, [take], { timelineKey: "decoder-program", placements: [{ placementKey: "one", at: "4f" }] });
  const references: Record<string, Value> = {
    cue: { type: timelineTypes.moment, data: narrative.moments[0]! },
    part: { type: timelineTypes.selection, data: narrative.selections[0]! },
    segment: { type: timelineTypes.segment, data: segment },
  };
  const ctx: ElaborationContext = {
    file: "instant.dvml", identity() {},
    lookup(name, span) {
      const value = references[name];
      if (!value) throw new DvError("TIME_REFERENCE", "Unknown reference", { span });
      return { kind: "record", key: name, type: value.type, value };
    },
    record() { throw new DvError("TEST_CONTEXT", "Decoder must not publish"); },
    operation() { throw new DvError("TEST_CONTEXT", "Decoder must not execute"); },
    asset() { throw new DvError("TEST_CONTEXT", "Decoder must not access media"); },
    authoring() { throw new DvError("TEST_CONTEXT", "Decoder must not register authoring units"); },
    fail(code, message, span) { throw new DvError(code, message, { span }); },
  };
  const element = (attrs: string) => parseMarkup(ctx.file, `<?dvml using="dsivio-video/markup@1"?><dvml><import as="time" from="dsivio-video/time@1"/><time:Instant ${attrs}/></dvml>`, { isRaw: () => false }).body[0]!;
  const decode = (attrs: string, options?: InstantDecodeOptions) => decodeInstantAttributes(element(attrs), ctx, options);
  const terminalOrigins: InstantDecodeOptions = { allow: ["absolute", "moment"] };
  assert.equal(projectInstant(timeline, decode('at="250ms"', terminalOrigins), "absolute").frame, 8);
  assert.equal(projectInstant(timeline, decode('at={cue}', terminalOrigins), "moment").frame, 11);
  assert.equal(projectInstant(timeline, decode('instant="moment.cue+2f" moment={cue}', terminalOrigins), "offset").frame, 13);
  const selection = projectInstant(timeline, decode('at={part} boundary="end"', { allow: ["selection"] }), "selection");
  assert.equal(selection.frame, 13);
  assert.equal(selection.editAuthority, "semantic-anchor");
  assert.equal(projectInstant(timeline, decode('at={segment} boundary="start"', { allow: ["segment"] }), "segment").frame, 4);
  assert.equal(projectInstant(timeline, decode('instant="program.end-2f"', { allow: ["program"] }), "program").frame, 32);
  for (const attrs of ['at={part} boundary="end"', 'at={segment} boundary="start"', 'instant="program.end"']) assert.throws(() => decode(attrs, terminalOrigins), { code: "TIME_ORIGIN" });
  assert.throws(() => decode('at={part}'), { code: "TIME_ATTRIBUTE" });
  assert.throws(() => decode('instant="moment.cue"'), { code: "TYPE_INVALID" });
  assert.throws(() => decode('at="1f" instant="2f"'), { code: "TIME_FORM" });
  assert.throws(() => decode('at="1f" boundary="start"'), { code: "TIME_FORM" });
  assert.throws(() => decode('at="1f" moment={cue}'), { code: "TIME_BINDING" });
  assert.throws(() => decode('instant="program.end+1f-2f"'), { code: "TYPE_INVALID" });
  assert.deepEqual(decodeWindowAttributes(element(''), ctx), { kind: "during", source: "program" });
  const windowExpression = (attrs: string) => {
    const expression = decodeWindowAttributes(element(attrs), ctx);
    assert.ok(!("type" in expression));
    time.types.WindowExpression!.validate(expression);
    return expression;
  };
  const offset = windowExpression('at="moment.cue+5f" moment={cue} for="10f"');
  assert.ok(offset.kind === "at");
  assert.deepEqual(offset.source, narrative.moments[0]);
  assert.equal(offset.expression, "moment.cue+5f");
  const offsetWindow = projectWindow(timeline, offset, "offset-window");
  assert.deepEqual(offsetWindow.frames, { start: 16, end: 26 });
  assert.equal(offsetWindow.leading.expression, "moment.cue+5f");
  assert.equal(offsetWindow.leading.editAuthority, "local-offset");
  assert.equal(offsetWindow.trailing.editAuthority, "duration");
  assert.deepEqual(projectWindow(timeline, { ...offset, expression: "moment.cue+7f" }, "edited-window").frames, { start: 18, end: 28 });
  assert.deepEqual(projectWindow(timeline, windowExpression('until="moment.cue+15f" moment={cue} for="10f"'), "until-offset").frames, { start: 16, end: 26 });
  assert.deepEqual(projectWindow(timeline, windowExpression('at="moment.cue-5f" moment={cue} for="10f"'), "negative-offset").frames, { start: 6, end: 16 });
  assert.deepEqual(projectWindow(timeline, windowExpression('at="selection.end+5f" selection={part} for="10f"'), "selection-offset").frames, { start: 18, end: 28 });
  assert.deepEqual(projectWindow(timeline, windowExpression('at="segment.end-5f" segment={segment} for="3f"'), "segment-offset").frames, { start: 29, end: 32 });
  assert.deepEqual(projectWindow(timeline, windowExpression('at={segment} boundary="start" for="8f"'), "segment-boundary").frames, { start: 4, end: 12 });
  assert.deepEqual(projectWindow(timeline, windowExpression('until={part} boundary="end" for="5f"'), "selection-boundary").frames, { start: 8, end: 13 });
  assert.deepEqual(projectWindow(timeline, windowExpression('at="program.start+2f" for="10f"'), "program-offset").frames, { start: 2, end: 12 });
  assert.deepEqual(projectWindow(timeline, windowExpression('at="moment.cue+10ms" moment={cue} for="10ms"'), "fractional-offset").frames, { start: 11, end: 12 });
  assert.deepEqual(windowExpression('at="250ms" for="1s"'), { kind: "at", source: "250ms", duration: "1s" });
  assert.deepEqual(projectWindow(timeline, windowExpression('at={cue} for="2f"'), "original-moment").frames, { start: 11, end: 13 });
  assert.throws(() => windowExpression('at="moment.cue+5f" for="10f"'), { code: "TYPE_INVALID" });
  assert.throws(() => windowExpression('at="moment.cue+5f+2f" moment={cue} for="10f"'), { code: "TYPE_INVALID" });
  assert.throws(() => windowExpression('at="moment.cue+5f" selection={part} for="10f"'), { code: "TYPE_INVALID" });
  assert.throws(() => windowExpression('at="moment.cue+5f" moment={cue} boundary="start" for="10f"'), { code: "TIME_BINDING" });
  assert.throws(() => projectWindow(timeline, windowExpression('at="moment.cue-12f" moment={cue} for="10f"'), "outside-offset"), { code: "TIME_OUTSIDE" });
  assert.throws(() => time.types.WindowExpression!.validate({ kind: "at", expression: "program.start", duration: "10f" }), { code: "TYPE_INVALID" });
});
