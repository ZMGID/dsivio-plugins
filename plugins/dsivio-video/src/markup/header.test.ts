import assert from "node:assert/strict";
import test from "node:test";
import { DvError } from "../core/errors.ts";
import { readHeader } from "./header.ts";

test("headers retain the original BOM and UTF-16 body offsets", () => {
  const text = '\uFEFF<?dvml\tusing="dsivio-video/markup@1" ?>\r\n<dvml></dvml>';
  assert.deepEqual(readHeader("film.dvml", text), { using: "dsivio-video/markup@1", bodyStart: text.indexOf("\r\n") });
  assert.equal(readHeader("film.dvml", "<?dvml using='custom/frontend@1'?>").using, "custom/frontend@1");
});

const failures = [
  { text: ' \n<?dvml using="x"?>', code: "SOURCE_HEADER_MISSING", line: 1, column: 1 },
  { text: '\uFEFF<?dvml using="x"', code: "SOURCE_HEADER_UNCLOSED", line: 1, column: 2 },
  { text: '<?dvml using ="x"?>', code: "SOURCE_HEADER_INVALID", line: 1, column: 1 },
  { text: '<?dvml using=""?>', code: "SOURCE_HEADER_FRONTEND", line: 1, column: 15 },
  { text: '<?dvml using="x"?>\r\n\t<?dvml using="y"?>', code: "SOURCE_HEADER_DUPLICATE", line: 2, column: 2 },
];
for (const failure of failures) {
  test(failure.code, () => {
    assert.throws(() => readHeader("film.dvml", failure.text), (error: unknown) => {
      assert.ok(error instanceof DvError);
      assert.equal(error.code, failure.code);
      assert.equal(error.span?.file, "film.dvml");
      assert.equal(error.span?.line, failure.line);
      assert.equal(error.span?.column, failure.column);
      return true;
    });
  });
}

test("header syntax rejects extra attributes, newlines, entities, and interpolation", () => {
  for (const text of ['<?dvml using="x" extra="y"?>', '<?dvml\nusing="x"?>']) {
    assert.throws(() => readHeader("x", text), (error: unknown) => error instanceof DvError && error.code === "SOURCE_HEADER_INVALID");
  }
  for (const using of ["x y", "&amp;", "{x}", "<x>"]) {
    assert.throws(() => readHeader("x", `<?dvml using="${using}"?>`), (error: unknown) => error instanceof DvError && error.code === "SOURCE_HEADER_FRONTEND");
  }
});
