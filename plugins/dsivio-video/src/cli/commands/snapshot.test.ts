import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import sharp from "sharp";
import { locateBrowser } from "../../render/browser.ts";
import { compileDocument } from "../../render/document.ts";
import type { Composition, Present } from "../../render/ir.ts";
import { parseOptions } from "../options.ts";
import type { CliOptions } from "../options.ts";
import { snapshotCommand, snapshotFrameList } from "./snapshot.ts";

function options(args: string[]): CliOptions {
  return parseOptions(args, { usage: "snapshot", min: 0, max: 1, options: { "at-frame": "string", "start-frame": "string", "end-frame-exclusive": "string", "step-frames": "string", to: "string", grid: "string", cell: "string", studio: "string" } });
}
test("snapshot keeps half-open range and rejects duplicate, descending and out-of-domain frames", () => {
  assert.deepEqual(snapshotFrameList(options(["--start-frame", "1", "--end-frame-exclusive", "6", "--step-frames", "2"]), 6), [1, 3, 5]);
  for (const args of [["--at-frame", "1,1"], ["--at-frame", "2,1"], ["--at-frame", "6"], ["--at-frame", "1", "--step-frames", "2"], ["--start-frame", "2", "--end-frame-exclusive", "2"]]) assert.throws(() => snapshotFrameList(options(args), 6), { code: "CLI_USAGE" });
});
let prepared = false;
try { await locateBrowser("render"); prepared = true; }
catch (cause) { if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "BROWSER_NOT_PREPARED") throw cause; }
test("snapshot captures actual odd-sized original-program poses and publishes without overwrite", { skip: !prepared && "Run setup browser --kind render for real snapshot tests" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dv-snapshot-test-"));
  try {
    const presents: Present[] = ["#FF0000", "#0000FF"].map((color, index) => ({
      presentKey: `pose${index}`, axisKey: "axis", lifetime: { start: index * 2, end: index * 2 + 1 }, layer: index, layerKey: `layer${index}`, rootKey: `root${index}`,
      nodes: [{ kind: "box", nodeKey: `root${index}`, parentKey: null, order: 0, style: [{ property: "position", value: "absolute" }, { property: "width", value: "65px" }, { property: "height", value: "65px" }, { property: "background-color", value: color }], keyframes: [], attributes: [] }],
    }));
    const composition: Composition = { compositionKey: "snapshot", domain: { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 3, totalSamples48k: 4800 }, canvasKey: "canvas", extent: { widthPx: 65, heightPx: 65 }, background: "#000000", visualTracks: [{ kind: "visual", trackKey: "visual", axisKey: "axis", presents }], audioTracks: [] };
    const html = join(directory, "index.html"), target = join(directory, "frames");
    await writeFile(html, compileDocument(composition).html);
    await snapshotCommand(options([html, "--at-frame", "0,2", "--to", target]));
    for (const [index, expected] of [[0, [255, 0, 0]], [2, [0, 0, 255]]] as const) {
      const decoded = await sharp(join(target, `frame-${String(index).padStart(9, "0")}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(decoded.info.width, 65); assert.equal(decoded.info.height, 65);
      assert.deepEqual([...decoded.data.subarray(0, 3)], expected);
    }
    await assert.rejects(snapshotCommand(options([html, "--at-frame", "0", "--to", target])), { code: "MEDIA_OUTPUT_EXISTS" });
    const bad = join(directory, "invalid");
    await assert.rejects(snapshotCommand(options([html, "--at-frame", "3", "--to", bad])), { code: "CLI_USAGE" });
    assert.deepEqual((await readdir(directory)).sort(), ["frames", "index.html"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function cancellationScene(): Composition {
  return {
    compositionKey: "cancel", canvasKey: "canvas", extent: { widthPx: 65, heightPx: 65 }, background: "#fa5533",
    domain: { axisKey: "axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 1, totalSamples48k: 1600 },
    visualTracks: [{ kind: "visual", trackKey: "visual", axisKey: "axis", presents: [{
      presentKey: "pose", axisKey: "axis", lifetime: { start: 0, end: 1 }, layer: 0, layerKey: "layer", rootKey: "root",
      nodes: [{ kind: "box", nodeKey: "root", parentKey: null, order: 0, style: [{ property: "width", value: "65px" }, { property: "height", value: "65px" }, { property: "background-color", value: "#fa5533" }], keyframes: [], attributes: [] }],
    }] }], audioTracks: [],
  };
}

for (const stage of ["metadata", "toFile"] as const) {
  test(`snapshot cancellation during ${stage === "metadata" ? "PNG probing" : "grid writing"} cleans scratch without publishing`, { skip: !prepared && "Run setup browser --kind render for real snapshot tests" }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "dv-snapshot-cancel-test-"));
    try {
      const html = join(directory, "index.html"), target = join(directory, "frames");
      await writeFile(html, compileDocument(cancellationScene()).html);
      const original = sharp.prototype[stage];
      // Inject the real process signal at an IO boundary; image operations remain real.
      t.mock.method(sharp.prototype, stage, function(this: sharp.Sharp, ...args: unknown[]) {
        const pending = Reflect.apply(original, this, args);
        process.emit("SIGINT");
        return pending;
      });
      await assert.rejects(snapshotCommand(options([html, "--at-frame", "0", "--grid", "1x1", "--cell", "32", "--to", target])), { code: "ABORTED" });
      assert.deepEqual(await readdir(directory), ["index.html"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test("snapshot cancellation of an active Studio fetch reports ABORTED and removes scratch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dv-snapshot-fetch-cancel-test-"));
  const document = compileDocument(cancellationScene());
  const server = createServer((_request, response) => {
    process.emit("SIGINT");
    response.end(JSON.stringify(document));
  });
  const ready = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", ready.resolve);
  await ready.promise;
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(snapshotCommand(options(["--studio", `http://127.0.0.1:${address.port}`, "--at-frame", "0", "--to", join(directory, "frames")])), { code: "ABORTED" });
    assert.deepEqual(await readdir(directory), []);
  } finally {
    const closed = Promise.withResolvers<void>();
    server.close(error => error ? closed.reject(error) : closed.resolve());
    await closed.promise;
    await rm(directory, { recursive: true, force: true });
  }
});
