import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../source/workspace.ts";
import { readRun } from "./parse.ts";

function fixture(t: test.TestContext) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dv-run-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "main.dvml"), "author");
  const workspace = Workspace.open({ cwd: dir });
  const parse = (body: string, version = 'version="1"', root = "dvrun") => {
    const file = join(dir, "main.dvrun");
    writeFileSync(file, `<?dvml using="dsivio-video/run@1"?><${root} ${version}>${body}</${root}>`);
    return readRun(file, workspace);
  };
  return { dir, parse };
}

test("reads targets and each candidate kind without opening unselected files", (t) => {
  const { dir, parse } = fixture(t);
  const run = parse('<author source="./main.dvml"/><target output="video"/><file id="image" type="media@1#Image" from="./missing.png" media-type="image/png"/><value id="value" type="text@1#Text" from="./missing.json"/><build-record id="old" build="previous" output="hero"/><satisfy output="hero" candidate="old"/>');
  assert.equal(run.author, join(dir, "main.dvml"));
  assert.deepEqual(run.targets, ["video"]);
  assert.equal(run.candidates.get("image")!.kind, "file");
  assert.equal(run.candidates.get("value")!.kind, "value");
  assert.equal(run.candidates.get("old")!.kind, "build");
  assert.equal(run.satisfy.get("hero"), "old");
});

test("rejects malformed declarations with RUN codes", (t) => {
  const { parse } = fixture(t);
  const author = '<author source="./main.dvml"/>';
  const target = '<target output="hero"/>';
  for (const [body, code] of [
    [target, "RUN_AUTHOR_ORDER"], ["", "RUN_AUTHOR_MISSING"], [author, "RUN_TARGETS"],
    [author + target + author, "RUN_AUTHOR_ORDER"], [author + target + target, "RUN_DUPLICATE"],
    [author + target + '<fragment id="x"/>', "RUN_CHILD"],
    [author + target + '<import from="anything"/>', "RUN_CHILD"],
    [author + '<target output={hero}/>', "RUN_ATTRIBUTE"],
    [author + '<target output=" "/>', "RUN_ATTRIBUTE"],
    [author + target + '<value id="bad" type="Text" from="./x"/>', "RUN_TYPE"],
    [author + target + '<file id="bad" type="media@1#Image" from="./x" media-type="image/*"/>', "RUN_MEDIA_TYPE"],
    [author + target + '<satisfy output="hero" candidate="a"/><satisfy output="hero" candidate="b"/>', "RUN_SATISFACTION_DUPLICATE"],
    [author + target + "text", "RUN_TEXT"],
  ]) assert.throws(() => parse(body!), { code });
  assert.throws(() => parse(author + target, 'version="2"'), { code: "RUN_VERSION" });
});
