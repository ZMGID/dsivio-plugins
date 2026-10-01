import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMarkup } from "../markup/parse.ts";
import { parseDvs } from "../markup/dvs.ts";
import { SourceIndexBuilder } from "../elaborate/source-index.ts";
import { Workspace } from "../source/workspace.ts";
import { applySourcePatches, fieldPatches, sourceOverlay, validateFieldValue } from "./edits.ts";
import type { StudioField } from "./companion.ts";
import type { EditSession } from "./edits.ts";

const header = '<?dvml using="dsivio-video/markup@1"?>';
function document(text: string) {
  const index = new SourceIndexBuilder("/project");
  const unit = index.addUnit("/project/main.dvml", text, "dvml");
  index.addMarkup(parseMarkup(unit.file, text, { isRaw: tag => tag === "Raw" }));
  return { index, unit, authoring: index.snapshot() };
}
function field(ownerKey: string, unit: string, attribute: string, extras: Partial<NonNullable<StudioField["binding"]>> = {}): StudioField {
  return { ownerKey, fieldKey: attribute, label: attribute, widget: "text", schemaKey: "test@1#value", authorValue: "old", endpointKey: "endpoint", binding: { ownerKey, sourceUnit: unit, attribute, access: "write", endpointKey: "endpoint", ...extras } };
}
test("exact UTF-16 attribute patch preserves raw quotes, entities and unrelated emoji", () => {
  const text = `${header}<dvml><Label id="one" value='中😀 &amp; tail' untouched="🦊" /></dvml>`;
  const fixture = document(text);
  const patches = fieldPatches(fixture.authoring, field("main.dvml#one", fixture.unit.unit, "value"), '新😀 "quote" & tail');
  const changed = applySourcePatches(text, patches);
  assert.equal(changed, `${header}<dvml><Label id="one" value='新😀 "quote" &amp; tail' untouched="🦊" /></dvml>`);
  assert.equal(parseMarkup(fixture.unit.file, changed, { isRaw: () => false }).body[0]!.attributes[1]!.value.kind, "literal");
  const emoji = text.indexOf("😀");
  assert.throws(() => applySourcePatches(text, [{ unit: fixture.unit.unit, start: emoji + 1, end: emoji + 1, expectedText: "", text: "x" }]), { code: "STUDIO_PATCH_RANGE" });
  assert.throws(() => applySourcePatches(text, [{ unit: fixture.unit.unit, start: 0, end: 2, expectedText: "xx", text: "x" }]), { code: "STUDIO_EDIT_CONFLICT" });
});
test("multiple source replacements and boundary insertions retain original UTF-16 offsets", () => {
  const text = "A😀B中C";
  const patch = (start: number, end: number, value: string) => ({ unit: "source", start, end, expectedText: text.slice(start, end), text: value });
  assert.equal(applySourcePatches(text, [patch(5, 6, "Z"), patch(3, 3, "?"), patch(1, 3, "🦊"), patch(1, 1, "!")]), "A!🦊?B中Z");
  assert.throws(() => applySourcePatches(text, [patch(1, 1, "a"), patch(1, 1, "b")]), { code: "STUDIO_PATCH_RANGE" });
  assert.throws(() => applySourcePatches(text, [patch(0, 4, "a"), patch(3, 5, "b")]), { code: "STUDIO_PATCH_RANGE" });
});
test("atomic attribute groups delete omitted members but preserve references and children", () => {
  const text = `${header}<dvml><Clip id="c" source={media} mode="stretch" min="0.5" max="2" unrelated="中😀"><Child /></Clip></dvml>`;
  const fixture = document(text);
  const patches = fieldPatches(fixture.authoring, field("main.dvml#c", fixture.unit.unit, "playback", { groupMembers: ["mode", "min", "max"] }), { mode: "once" });
  const changed = applySourcePatches(text, patches);
  assert.equal(changed.includes('mode="once"'), true);
  assert.equal(changed.includes('min="'), false);
  assert.equal(changed.includes('max="'), false);
  assert.equal(changed.includes('source={media}'), true);
  assert.equal(changed.includes('<Child />'), true);
  assert.throws(() => fieldPatches(fixture.authoring, field("main.dvml#c", fixture.unit.unit, "source"), "different"), { code: "STUDIO_FIELD_READONLY" });
});
test("Recipe nested record edit replaces whole source value without touching separators/comments", () => {
  const text = '<?dvml using="dsivio-video/recipe@1"?><sheet version="1">style.look { layout: {"label":"中😀","items":[1,2],"keep":true}; /* retained */\n opacity: 0.78; }</sheet>';
  const index = new SourceIndexBuilder("/project");
  const unit = index.addUnit("/project/look.dvs", text, "dvs"); index.addSheet(parseDvs(unit.file, text));
  const patches = fieldPatches(index.snapshot(), field("look.dvs#style.look", unit.unit, "layout", { path: ["items", 1] }), 8);
  const changed = applySourcePatches(text, patches);
  const parsed = parseDvs(unit.file, changed);
  assert.deepEqual(parsed.rules[0]!.properties[0]!.value, { label: "中😀", items: [1, 8], keep: true });
  assert.equal(changed.endsWith('; /* retained */\n opacity: 0.78; }</sheet>'), true);
  assert.throws(() => fieldPatches(index.snapshot(), field("look.dvs#style.look", unit.unit, "layout", { path: ["missing", "field"] }), 8), { code: "STUDIO_ENDPOINT_MISSING" });
});

test("Recipe attribute groups replace only declared properties and delete omitted members atomically", () => {
  const text = '<?dvml using="dsivio-video/recipe@1"?><sheet version="1">media.play { playback: "stretch"; stretch-min: 0.5; stretch-max: 2; /* retained */ label: "中😀"; }</sheet>';
  const index = new SourceIndexBuilder("/project"); const unit = index.addUnit("/project/look.dvs", text, "dvs"); index.addSheet(parseDvs(unit.file, text));
  const control = field("look.dvs#media.play", unit.unit, "playback", { groupMembers: ["playback", "stretch-min", "stretch-max"] });
  const changed = applySourcePatches(text, fieldPatches(index.snapshot(), control, { playback: "once" }));
  assert.deepEqual(parseDvs(unit.file, changed).rules[0]!.properties.map(p => [p.name, p.value]), [["playback", "once"], ["label", "中😀"]]);
  assert.equal(changed.includes('/* retained */ label: "中😀";'), true);
});

test("declared child list inverse retains parent namespace and rejects unowned fields", () => {
  const text = `${header}<dvml><image:Program id="steps" note="😀"><image:Blur sigma="1" /><image:Flip axis="horizontal" /></image:Program></dvml>`;
  const fixture = document(text);
  const control = field("main.dvml#steps", fixture.unit.unit, "$children", { children: { discriminator: "kind", variants: { blur: { tag: "Blur", attributes: { sigma: "sigma" } }, flip: { tag: "Flip", attributes: { axis: "axis" } } } } });
  const changed = applySourcePatches(text, fieldPatches(fixture.authoring, control, [{ kind: "flip", axis: "vertical" }, { kind: "blur", sigma: 3 }]));
  const program = parseMarkup(fixture.unit.file, changed, { isRaw: () => false }).body[0]!;
  assert.equal(program.kind, "element");
  if (program.kind === "element") assert.deepEqual(program.children.filter(c => c.kind !== "text").map(c => c.tag), ["image:Flip", "image:Blur"]);
  assert.equal(changed.includes('id="steps" note="😀"'), true);
  assert.throws(() => fieldPatches(fixture.authoring, control, [{ kind: "blur", sigma: 3, injected: "x" }]), { code: "STUDIO_FIELD_VALUE" });
  assert.throws(() => fieldPatches(fixture.authoring, control, [{ kind: "__proto__" }]), { code: "STUDIO_FIELD_VALUE" });
});
test("structured text body encodes XML but cannot flatten rich child content", () => {
  const text = `${header}<dvml><Label id="l">hello &amp; 世界</Label><Label id="rich"><Span>content</Span></Label></dvml>`;
  const fixture = document(text);
  const changed = applySourcePatches(text, fieldPatches(fixture.authoring, field("main.dvml#l", fixture.unit.unit, "$body"), "😀 <tag> &"));
  assert.equal(changed.includes('😀 &lt;tag&gt; &amp;</Label>'), true);
  assert.throws(() => fieldPatches(fixture.authoring, field("main.dvml#rich", fixture.unit.unit, "$body"), "flat"), { code: "STUDIO_FIELD_READONLY" });
});
test("schema rejects incomplete record/list and invalid options instead of saving half drafts", () => {
  const schema = { type: "object", properties: { mode: { type: "string", enum: ["stretch"] }, bounds: { type: "array", minItems: 2, maxItems: 2, items: { type: "number", minimum: 0 } } }, required: ["mode", "bounds"], additionalProperties: false } as const;
  assert.throws(() => validateFieldValue({ mode: "stretch" }, schema), { code: "STUDIO_FIELD_VALUE" });
  assert.throws(() => validateFieldValue({ mode: "once", bounds: [0, 1] }, schema), { code: "STUDIO_FIELD_VALUE" });
  assert.throws(() => validateFieldValue({ mode: "stretch", bounds: [0, -1] }, schema), { code: "STUDIO_FIELD_VALUE" });
  validateFieldValue({ mode: "stretch", bounds: [0, 1] }, schema);
});
test("all loaded source versions are checked even for an unchanged edit", t => {
  const root = mkdtempSync(join(tmpdir(), "dv-edit-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const index = new SourceIndexBuilder(root);
  const text = `${header}<dvml><Label id="l" value="old" /></dvml>`;
  for (const name of ["main.dvml", "import.dvml"]) { const file = join(root, name); writeFileSync(file, text); index.addUnit(file, text, "dvml"); }
  const session: EditSession = { authoring: index.snapshot(), workspace: Workspace.open({ cwd: root }), state: { requestedRevision: 1, publishedRevision: 1, dirty: false, status: "ready" }, async transaction() { throw new Error("Not called by source version validation"); } };
  assert.equal(sourceOverlay(session, []).size, 0);
  writeFileSync(join(root, "import.dvml"), `${text}\n`);
  assert.throws(() => sourceOverlay(session, []), { code: "STUDIO_EDIT_CONFLICT" });
});
