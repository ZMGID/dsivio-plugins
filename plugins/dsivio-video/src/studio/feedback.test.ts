import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeedbackStore, parseFeedback } from "./feedback.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dv-feedback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("Comments isolate Runs, retain extension fields and number by submission rather than time/filter", async (t) => {
  const root = await fixture(t), store = new FeedbackStore(root, join(root, "one.dvrun")), other = new FeedbackStore(root, join(root, "two.dvrun"));
  await writeFile(store.path, JSON.stringify({ schema: "dsivio-video.feedback/1", project: { review: 4 }, comments: [{ id: "late", run: "one.dvrun", at: 100, text: "晚 🐦", custom: [1, 2] }, { id: "other", run: "two.dvrun", at: 1, text: "Other" }, { id: "early", run: "one.dvrun", at: 0, text: "Early", resolved: true }] }));
  const all = await store.list();
  assert.deepEqual(all.comments.map((row) => [row.id, row.number]), [["early", 2], ["late", 1]]);
  assert.deepEqual((await store.list("open")).comments.map((row) => row.id), ["late"]);
  assert.equal((await other.list()).comments[0]?.id, "other");
  const late = all.comments[1]!;
  await store.update(late.id, late.expectedComment, { at: 0.2, resolved: true });
  assert.deepEqual((await store.list()).comments.map((row) => [row.id, row.number]), [["early", 2], ["late", 1]]);
  const document = parseFeedback(await readFile(store.path, "utf8"));
  assert.deepEqual(document.project, { review: 4 });
  assert.deepEqual(document.comments[0]?.custom, [1, 2]);
  assert.equal(document.comments[1]?.text, "Other");
});
test("Stale whole-comment edits conflict and invalid disk content is never overwritten", async (t) => {
  const root = await fixture(t), store = new FeedbackStore(root, join(root, "run.dvrun"));
  const added = await store.add({ id: "stable", at: 1, text: "First" });
  const old = added.comments[0]!.expectedComment;
  await store.update("stable", old, { text: "External change" });
  await assert.rejects(store.update("stable", old, { text: "Stale draft" }), { code: "FEEDBACK_CONFLICT" });
  assert.equal((await store.list()).comments[0]?.text, "External change");
  const invalid = '{"schema":"unknown","comments":[]}';
  await writeFile(store.path, invalid);
  await assert.rejects(store.add({ id: "new", at: 0, text: "Do not overwrite" }), { code: "FEEDBACK_INVALID" });
  assert.equal(await readFile(store.path, "utf8"), invalid);
});
test("Concurrent store instances serialize unique additions and reject duplicate ids without dropping records", async (t) => {
  const root = await fixture(t), run = join(root, "run.dvrun"), a = new FeedbackStore(root, run), b = new FeedbackStore(root, run);
  await Promise.all([a.add({ id: "a", at: 1, text: "A" }), b.add({ id: "b", at: 2, text: "B" })]);
  assert.deepEqual((await a.list()).comments.map((row) => row.id), ["a", "b"]);
  await assert.rejects(b.add({ id: "a", at: 0, text: "Conflict" }), { code: "FEEDBACK_CONFLICT" });
  const old = (await a.list()).comments[0]!;
  await a.delete("a", old.expectedComment);
  assert.deepEqual((await b.list()).comments.map((row) => [row.id, row.number]), [["b", 1]]);
});
test("Feedback rejects duplicate identities, path escapes and non-finite or negative times", () => {
  const comment = { id: "id", run: "run.dvrun", at: 0, text: "Text" };
  assert.throws(() => parseFeedback(JSON.stringify({ schema: "dsivio-video.feedback/1", comments: [comment, comment] })), { code: "FEEDBACK_INVALID" });
  for (const changes of [{ run: "../outside" }, { run: "a/../run" }, { at: -1 }, { text: " " }, { resolved: 0 }]) assert.throws(() => parseFeedback(JSON.stringify({ schema: "dsivio-video.feedback/1", comments: [{ ...comment, ...changes }] })), { code: "FEEDBACK_INVALID" });
});

test("Agent comments CLI reads stable ids and whole extensions without a running Studio", async (t) => {
  const root = await fixture(t), store = new FeedbackStore(root, join(root, "run.dvrun"));
  await store.add({ id: "agent-open", at: 2, text: "多行\n🐦", expectedComment: { extension: true }, custom: [1, 2] });
  await store.add({ id: "agent-resolved", at: 1, text: "Done", resolved: true });
  const cli = fileURLToPath(new URL("../../bin/dsivio-video.mjs", import.meta.url));
  const processResult = spawnSync(process.execPath, [cli, "comments", "list", "--run", "run.dvrun", "--workspace", root, "--json"], { cwd: root, encoding: "utf8", env: { ...process.env, INIT_CWD: root } });
  assert.equal(processResult.status, 0, processResult.stderr);
  const result = JSON.parse(processResult.stdout);
  assert.equal(result.schema, "dsivio-video.comments-list/1");
  assert.deepEqual(result.comments.map((row: { id: string; number: number }) => [row.id, row.number]), [["agent-open", 1]]);
  assert.deepEqual(result.comments[0].expectedComment, { extension: true });
  assert.deepEqual(result.comments[0].custom, [1, 2]);
});
