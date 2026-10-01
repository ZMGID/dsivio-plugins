import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthor } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import script from "../script/index.ts";
import program from "../program/index.ts";
import time from "./index.ts";
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
