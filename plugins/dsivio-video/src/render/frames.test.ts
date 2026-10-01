import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../build/resources.ts";
import { withRenderAdmission } from "./frames.ts";

test("Cancelling queued work preserves admission order and removes completed scratch", { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "dv-admission-"));
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const context = { buildId: "test", commandKey: "test", idempotencyKey: "test", workDir: root, projectRoot: root, store: new ProjectStore(root), signal: new AbortController().signal, log() {} };
  const directories: string[] = [];
  t.after(() => release.resolve());
  const first = withRenderAdmission(context, async ctx => {
    directories.push(ctx.workDir);
    await writeFile(join(ctx.workDir, "active"), "first");
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  let cancelledEntered = false;
  const cancelled = withRenderAdmission({ ...context, signal: controller.signal }, async () => { cancelledEntered = true; });
  const rejection = assert.rejects(cancelled, { code: "ABORTED" });
  let lastEntered = false;
  const last = withRenderAdmission(context, async ctx => { lastEntered = true; directories.push(ctx.workDir); });
  try {
    controller.abort();
    await rejection;
    assert.equal(cancelledEntered, false);
    assert.equal(lastEntered, false);
    await access(join(directories[0]!, "active"));
    release.resolve();
    await Promise.all([first, last]);
    assert.equal(lastEntered, true);
    assert.notEqual(directories[0], directories[1]);
    for (const directory of directories) await assert.rejects(access(directory), { code: "ENOENT" });
  } finally {
    release.resolve();
    await Promise.all([first, last]);
    await rm(root, { recursive: true, force: true });
  }
});
