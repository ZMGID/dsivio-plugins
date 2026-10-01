import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMarkup } from "../markup/parse.ts";
import { SourceIndexBuilder } from "../elaborate/source-index.ts";
import { Workspace } from "../source/workspace.ts";
import { assembleTimeline } from "../timeline/timeline.ts";
import { projectInstant, projectWindow } from "../timeline/temporal.ts";
import type { WindowExpression } from "../timeline/types.ts";
import type { EditSession } from "./edits.ts";
import type { TemporalAuthority } from "./companion.ts";
import { applySourcePatches } from "./edits.ts";
import { temporalPatches, frameExpression } from "./temporal-edits.ts";

const timeline = assembleTimeline({ fps: { numerator: 30, denominator: 1 } }, [], { timelineKey: "program", placements: [] }, "100f");
function fixture(t: test.TestContext, attributes: string, expression: WindowExpression) {
  const root = mkdtempSync(join(tmpdir(), "dv-time-edit-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "main.dvml"); const text = `<?dvml using="dsivio-video/markup@1"?><dvml><Window id="w" ${attributes} untouched="中😀" /></dvml>`;
  writeFileSync(file, text); const index = new SourceIndexBuilder(root); const unit = index.addUnit(file, text, "dvml"); index.addMarkup(parseMarkup(file, text, { isRaw: () => false }));
  const window = projectWindow(timeline, expression, "consumer");
  const authority: TemporalAuthority = { key: "w:window", originKind: "parameter", originKey: "main.dvml#w", consumerPort: "window", window, gestures: expression.kind === "at" ? ["move", "trim-end"] : expression.kind === "until" ? ["move", "trim-start"] : ["move", "trim-start", "trim-end"], binding: { ownerKey: "main.dvml#w", sourceUnit: unit.unit, access: "write" } };
  const session: EditSession = { authoring: index.snapshot(), workspace: Workspace.open({ cwd: root }), state: { requestedRevision: 1, publishedRevision: 1, dirty: false, status: "ready" }, async transaction() { throw new Error("Pure temporal inverse does not commit"); } };
  const edit = (gesture: "move" | "trim-start" | "trim-end", payload: { targetFrame?: number; deltaFrames?: number }) => applySourcePatches(text, temporalPatches(session, authority, { expectedViewRevision: 1, editorKey: "entity", authorityKey: authority.key, gesture, ...payload }, timeline));
  return { text, authority, session, unit, edit };
}
test("at/for move changes only at; trim-end changes duration and never exposes start trim", t => {
  const f = fixture(t, 'at="10f" for="20f"', { kind: "at", source: "10f", duration: "20f" });
  assert.equal(f.edit("move", { deltaFrames: 7 }).includes('at="17f" for="20f"'), true);
  assert.equal(f.edit("trim-end", { targetFrame: 45 }).includes('at="10f" for="35f"'), true);
  assert.throws(() => f.edit("trim-start", { targetFrame: 15 }), { code: "STUDIO_TIME_READONLY" });
  assert.throws(() => f.edit("move", { deltaFrames: -11 }), { code: "STUDIO_TIME_WINDOW" });
});
test("until/for move changes until; trim-start changes duration and never exposes end trim", t => {
  const f = fixture(t, 'until="80f" for="20f"', { kind: "until", source: "80f", duration: "20f" });
  assert.equal(f.edit("move", { deltaFrames: -5 }).includes('until="75f" for="20f"'), true);
  assert.equal(f.edit("trim-start", { targetFrame: 50 }).includes('until="80f" for="30f"'), true);
  assert.throws(() => f.edit("trim-end", { targetFrame: 90 }), { code: "STUDIO_TIME_READONLY" });
});
test("start/end move atomically edits both authored expressions and keeps reference origin", t => {
  const f = fixture(t, 'start="program.start+10f" end="program.end-70f"', { kind: "edges", start: "program.start+10f", end: "program.end-70f" });
  assert.equal(f.edit("move", { deltaFrames: 8 }).includes('start="program.start+18f" end="program.end-62f"'), true);
  assert.equal(f.edit("trim-start", { targetFrame: 14 }).includes('start="program.start+14f" end="program.end-70f"'), true);
  assert.throws(() => f.edit("trim-end", { targetFrame: 10 }), { code: "STUDIO_TIME_WINDOW" });
  assert.equal(f.edit("move", { deltaFrames: 0 }), f.text);
});
test("a bare Program Instant inserts only a frame offset instead of replacing the anchor", () => {
  const instant = projectInstant(timeline, { kind: "expression", expression: "program.start" }, "consumer");
  assert.equal(frameExpression(instant, 5, timeline), "program.start+5f");
  assert.equal(frameExpression(projectInstant(timeline, { kind: "expression", expression: "program.end-10f" }, "consumer"), 85, timeline), "program.end-15f");
});
