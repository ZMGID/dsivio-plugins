import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type { TestContext } from "node:test";
import type { DvError } from "../core/errors.ts";
import { StudioWatcher } from "./watch.ts";

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for real filesystem notification");
    await delay(5);
  }
}

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "dv-studio-watch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = join(root, "main.dvrun");
  const source = join(root, "main.dvml");
  const recipe = join(root, "style.dvs");
  const asset = join(root, "asset.png");
  const feedback = join(root, "FEEDBACK.dvml");
  for (const file of [run, source, recipe, asset, feedback]) writeFileSync(file, "initial");
  const dirty: { files: readonly string[]; time: number }[] = [];
  const compiles: { files: readonly string[]; time: number }[] = [];
  const comments: number[] = [];
  const errors: DvError[] = [];
  const watcher = new StudioWatcher({
    files: [run, source, recipe, asset], feedbackFile: feedback,
    onDirty: (files) => dirty.push({ files, time: performance.now() }),
    onCompile: (files) => compiles.push({ files, time: performance.now() }),
    onComments: () => comments.push(performance.now()),
    onError: (error) => errors.push(error),
  });
  t.after(() => watcher.close());
  return { root, run, source, recipe, asset, feedback, watcher, dirty, compiles, comments, errors };
}

function replace(file: string, text: string): void {
  const temporary = `${file}.swap`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

test("atomic renames dirty immediately and merge Run/source/recipe/assets at 80ms trailing edge", async (t) => {
  const f = fixture(t);
  replace(f.source, "source-2");
  await until(() => f.dirty.length === 1);
  assert.equal(f.compiles.length, 0, "Dirty must precede debounce compile");
  await delay(20);
  replace(f.run, "run-2");
  await until(() => f.dirty.length === 2);
  await delay(20);
  replace(f.recipe, "recipe-2");
  replace(f.asset, "asset-2");
  await until(() => f.dirty.flatMap((change) => change.files).includes(f.asset));
  assert.equal(f.compiles.length, 0);
  await until(() => f.compiles.length === 1);
  assert.deepEqual(new Set(f.compiles[0]!.files), new Set([f.source, f.run, f.recipe, f.asset]));
  assert.ok(f.compiles[0]!.time - f.dirty.at(-1)!.time >= 70, "Trailing debounce must wait approximately 80ms after the final byte change");
  replace(f.source, "source-2");
  replace(f.asset, "asset-2");
  await delay(150);
  assert.equal(f.compiles.length, 1, "Same bytes, even with new inodes, must not compile twice");
  replace(f.source, "source-3");
  await until(() => f.compiles.length === 2);
  assert.deepEqual(f.compiles[1]!.files, [f.source], "Directory subscription must survive repeated replacement");
  assert.deepEqual(f.errors, []);
});

test("FEEDBACK independently notifies and dedupes without delaying an in-flight compile", async (t) => {
  const f = fixture(t);
  replace(f.source, "edited");
  await until(() => f.dirty.length === 1);
  await delay(25);
  replace(f.feedback, "comment");
  await until(() => f.comments.length === 1);
  await until(() => f.compiles.length === 1);
  assert.deepEqual(f.compiles[0]!.files, [f.source]);
  assert.equal(f.dirty.length, 1);
  replace(f.feedback, "comment");
  await delay(130);
  assert.equal(f.comments.length, 1);
  assert.equal(f.compiles.length, 1);
});

test("new closure entries and missing directories become watched, with errors retaining subscriptions", async (t) => {
  const f = fixture(t);
  const imported = join(f.root, "imports", "new.dvml");
  f.watcher.addFiles([imported]);
  mkdirSync(join(f.root, "imports"));
  writeFileSync(imported, "new import");
  await until(() => f.compiles.length === 1);
  assert.deepEqual(f.compiles[0]!.files, [imported]);
  rmSync(imported);
  mkdirSync(imported);
  await until(() => f.errors.length === 1 && f.compiles.length === 2);
  assert.equal(f.errors[0]!.code, "STUDIO_WATCH_IO");
  rmSync(imported, { recursive: true });
  writeFileSync(imported, "repaired import");
  await until(() => f.compiles.length === 3);
  assert.deepEqual(f.compiles[2]!.files, [imported]);
});

test("acknowledged transaction bytes and close do not schedule duplicate work", async (t) => {
  const f = fixture(t);
  replace(f.source, "committed");
  f.watcher.acknowledgeFiles([f.source]);
  await delay(130);
  assert.deepEqual(f.dirty, []);
  assert.deepEqual(f.compiles, []);
  replace(f.source, "next");
  await until(() => f.dirty.length === 1);
  f.watcher.acknowledgeFiles([f.source]);
  await delay(130);
  assert.equal(f.compiles.length, 0, "Acknowledgement must cancel an already queued watcher echo");
  replace(f.source, "final");
  await until(() => f.dirty.length === 2);
  f.watcher.close();
  f.watcher.close();
  replace(f.source, "after close");
  replace(f.feedback, "after close");
  await delay(130);
  assert.equal(f.dirty.length, 2);
  assert.equal(f.compiles.length, 0);
  assert.equal(f.comments.length, 0);
});
