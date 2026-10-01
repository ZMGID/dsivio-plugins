import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { locateBrowser } from "../../render/browser.ts";
import { compileDocument } from "../../render/document.ts";
import type { Composition, Present } from "../../render/ir.ts";
import { parseOptions } from "../options.ts";
import type { CliOptions } from "../options.ts";
import { snapshotCommand, snapshotFrameList } from "./snapshot.ts";

function options(args: string[]): CliOptions {
  return parseOptions(args, { usage: "snapshot", min: 0, max: 1, options: { "at-frame": "string", "start-frame": "string", "end-frame-exclusive": "string", "step-frames": "string", to: "string", grid: "string", cell: "string" } });
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
