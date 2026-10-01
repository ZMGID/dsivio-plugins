import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import { Workspace } from "../source/workspace.ts";
import { StudioSession } from "./session.ts";
import type { DisplayOptions, DisplayResult } from "./display.ts";
import type { ViewRevision } from "./protocol.ts";
import { compileDocument } from "../render/document.ts";
import type { Composition } from "../render/ir.ts";

function result(options: DisplayOptions, revision: number): DisplayResult {
  const timeline = { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 30, placements: [] };
  const composition: Composition = { compositionKey: "composition", domain: { axisKey: "axis", clock: timeline.clock, totalFrames: 30, totalSamples48k: 48000 }, canvasKey: "canvas", extent: { widthPx: 100, heightPx: 100 }, background: "#000000", visualTracks: [{ kind: "visual", trackKey: "track", axisKey: "axis", presents: [] }], audioTracks: [] };
  const document = compileDocument(composition);
  const view: ViewRevision = { protocol: "dsivio-video.studio/1", sessionId: options.sessionId, viewRevision: revision, runFile: "main.dvrun", projectRoot: options.workspace.root, sourceUnits: [], clock: timeline.clock, totalFrames: 30, timeline, document, audioTracks: [], lanes: [], bands: [], entities: [], materials: [], fieldGroups: [], parameterOwners: [], targets: ["film.composition"], candidateCount: 0 };
  return { view, authoring: { units: new Map(), elements: new Map(), relations: [], references: [], inputs: [] }, graph: { source: options.runFile, sources: [], records: new Map(), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: [] }, plan: { definition: { schema: "dsivio-video.definition/1", author: options.runFile, run: options.runFile, targets: [], seeds: {}, forwarded: {}, reused: {}, steps: [], outputs: {}, modules: [] }, overrides: [], unreachable: [], assets: new Map(), rootRecords: [], executionEdges: [] }, resources: [], files: [] };
}
function fixture(t: test.TestContext, loader: NonNullable<ConstructorParameters<typeof StudioSession>[2]>["loader"]): StudioSession {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dv-studio-session-")));
  const session = new StudioSession(Workspace.open({ cwd: dir, workspace: dir }), join(dir, "main.dvrun"), { loader });
  t.after(async () => { await session.close(); rmSync(dir, { recursive: true, force: true }); });
  return session;
}
test("a slow obsolete success cannot replace a newer ready revision", async t => {
  const older = Promise.withResolvers<void>();
  const session = fixture(t, async (options, revision) => { if (revision === 1) await older.promise; return result(options, revision); });
  const first = session.compile();
  session.markDirty();
  await session.compile();
  assert.equal(session.currentView().viewRevision, 2);
  older.resolve(); await first;
  assert.equal(session.currentView().viewRevision, 2);
  assert.equal(session.state.publishedRevision, 2);
});
test("dirty debounce immediately revokes export and prevents obsolete errors publishing", async t => {
  let failure: PromiseWithResolvers<void> | undefined;
  const session = fixture(t, async (options, revision) => { if (revision === 2) { failure = Promise.withResolvers<void>(); await failure.promise; throw new DvError("LOCAL_FAILED", "old local work failed"); } return result(options, revision); });
  await session.compile();
  session.markDirty();
  assert.throws(() => session.currentView(), { code: "STUDIO_NOT_READY" });
  const stale = session.compile();
  session.markDirty();
  await session.compile();
  failure!.resolve(); await stale;
  assert.equal(session.state.status, "ready");
  assert.equal(session.currentView().viewRevision, 3);
  assert.equal(session.state.error, undefined);
});
test("the latest preparation error rejects current export while retaining a visibly stale view", async t => {
  const session = fixture(t, async (options, revision) => { if (revision > 1) throw new DvError("LOCAL_FAILED", "resource unavailable"); return result(options, revision); });
  await session.compile(); session.markDirty(); await session.compile();
  assert.equal(session.state.status, "error");
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.view?.viewRevision, 1);
  assert.equal(session.state.requestedRevision, 2);
  assert.throws(() => session.currentView(), { code: "STUDIO_COMPILE_FAILED", message: "resource unavailable" });
});
