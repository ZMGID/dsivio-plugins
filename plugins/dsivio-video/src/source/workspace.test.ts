import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DvError } from "../core/errors.ts";
import { Workspace } from "./workspace.ts";

test("workspace discovery uses the nearest state directory and canonicalizes source paths", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "dv-workspace-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, "project");
  const nested = join(root, "nested");
  const cwd = join(nested, "src");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(root, ".dsivio-video"));
  const source = join(cwd, "main.dvml");
  const imported = join(nested, "kit.dvs");
  writeFileSync(source, "main");
  writeFileSync(imported, "配方\r\n");
  symlinkSync(imported, join(cwd, "alias.dvs"));
  const workspace = Workspace.open({ cwd });
  assert.equal(workspace.root, realpathSync(root));
  assert.equal(workspace.stateDir, join(realpathSync(root), ".dsivio-video"));
  assert.equal(workspace.resolveSource(source, "../kit.dvs"), realpathSync(imported));
  assert.equal(workspace.resolveSource(source, "./alias.dvs"), realpathSync(imported));
  assert.equal(workspace.readText(imported), "配方\r\n");
  mkdirSync(join(nested, ".dsivio-video"));
  assert.equal(Workspace.open({ cwd }).root, realpathSync(nested));
  assert.equal(Workspace.open({ cwd, workspace: "../.." }).root, realpathSync(root));
});

test("without a state directory cwd is the root, including when cwd is a symlink", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "dv-workspace-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const cwd = join(temporary, "actual");
  mkdirSync(cwd);
  symlinkSync(cwd, join(temporary, "alias"));
  assert.equal(Workspace.open({ cwd: join(temporary, "alias") }).root, realpathSync(cwd));
});

test("asset roots do not enlarge source permissions and symlinks cannot escape", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "dv-workspace-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, "project");
  const shared = join(temporary, "shared");
  const outside = join(temporary, "project-other");
  for (const directory of [root, shared, outside]) mkdirSync(directory);
  const source = join(root, "main.dvml");
  const asset = join(shared, "image.png");
  const external = join(outside, "other.dvml");
  writeFileSync(source, "main");
  writeFileSync(asset, "image");
  writeFileSync(external, "outside");
  symlinkSync(shared, join(root, "shared-link"));
  symlinkSync(external, join(root, "outside-link"));
  const workspace = Workspace.open({ cwd: root, assetRoots: ["../shared"] });
  assert.equal(workspace.resolveAsset(source, "../shared/image.png"), realpathSync(asset));
  assert.equal(workspace.resolveAsset(source, "./shared-link/image.png"), realpathSync(asset));
  const failures = [
    { run: () => workspace.resolveSource(source, "../shared/image.png"), code: "SOURCE_OUTSIDE_ROOT" },
    { run: () => workspace.resolveSource(source, "./outside-link"), code: "SOURCE_OUTSIDE_ROOT" },
    { run: () => workspace.resolveSource(source, "../project-other/other.dvml"), code: "SOURCE_OUTSIDE_ROOT" },
    { run: () => workspace.resolveAsset(source, "./outside-link"), code: "SOURCE_ASSET_OUTSIDE_ROOT" },
    { run: () => workspace.resolveAsset(source, "../project-other/other.dvml"), code: "SOURCE_ASSET_OUTSIDE_ROOT" },
    { run: () => workspace.resolveSource(source, "main.dvml"), code: "UNSUPPORTED_SOURCE_IMPORT" },
    { run: () => workspace.resolveSource(source, external), code: "UNSUPPORTED_SOURCE_IMPORT" },
    { run: () => workspace.resolveAsset(source, "https://example.com/image.png"), code: "UNSUPPORTED_SOURCE_IMPORT" },
    { run: () => workspace.resolveSource(source, "./missing"), code: "SOURCE_NOT_FOUND" },
    { run: () => workspace.readText(join(root, "missing")), code: "SOURCE_NOT_FOUND" },
    { run: () => workspace.readText(join(root, "outside-link")), code: "SOURCE_OUTSIDE_ROOT" },
  ];
  for (const failure of failures) {
    assert.throws(failure.run, (error: unknown) => {
      assert.ok(error instanceof DvError);
      assert.equal(error.code, failure.code);
      assert.equal(error.span?.line, 1);
      assert.equal(error.span?.column, 1);
      return true;
    });
  }
});
