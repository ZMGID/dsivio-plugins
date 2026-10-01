import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, copyFile, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { ExecuteContext } from "../core/capability.ts";
import type { Json, ResourceRef } from "../core/value.ts";
import { rasterPython } from "./install.ts";
import { rasterCapability, validateRasterRequest, RASTER_LIMITS } from "./capabilities.ts";
import { validateImageProgram } from "../components/image-transform/validate.ts";
import type { RasterStep } from "../components/image-transform/types.ts";
import transform from "../modules/image-transform/index.ts";
import compose from "../modules/image-compose/index.ts";
import * as builtins from "../modules/index.ts";
import { compileAuthor } from "../elaborate/compile.ts";
import { Workspace } from "../source/workspace.ts";
const prepared = { skip: !existsSync(rasterPython) ? "Run setup raster for real OpenCV regression tests" : false };
async function fixture(t: test.TestContext): Promise<ExecuteContext> {
  const root = await mkdtemp(join(tmpdir(), "dv-raster-test-")); await mkdir(join(root, "store")); let index = 0;
  const paths = new Map<string, string>(); t.after(() => rm(root, { recursive: true, force: true }));
  return { buildId: "test", commandKey: "raster", idempotencyKey: "raster", projectRoot: root, workDir: root, signal: new AbortController().signal, log() {}, store: { async putFile(path, mime) { const id = `r${index++}`, target = join(root, "store", id); await copyFile(path, target); paths.set(id, target); return { $resource: id, bytes: (await stat(target)).size, mime }; }, pathOf(ref) { const path = paths.get(ref.$resource); assert.ok(path); return path; } } };
}
async function pixels(ctx: ExecuteContext, width: number, height: number, data: number[]): Promise<ResourceRef> {
  const path = join(ctx.workDir, "source.png"); await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toFile(path); return ctx.store.putFile(path, "image/png");
}
async function edit(ctx: ExecuteContext, source: ResourceRef, steps: RasterStep[]): Promise<{ data: Buffer; info: sharp.OutputInfo; ref: ResourceRef }> {
  assert.equal(rasterCapability.executor.kind, "immediate"); if (rasterCapability.executor.kind !== "immediate") throw new Error("Unexpected executor");
  const value = await rasterCapability.executor.run({ action: "edit", source: source as unknown as Json, orderedSteps: steps as unknown as Json }, ctx);
  const ref = value.data as unknown as ResourceRef; const decoded = await sharp(ctx.store.pathOf(ref)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { ...decoded, ref };
}
const colorStep: RasterStep = { kind: "color", exposureStops: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, gamma: 1 };
const denoise: RasterStep = { kind: "denoise", method: "nlm-ycrcb", luma: 2, chroma: 10, templateWindow: 7, searchWindow: 21, saturationRecovery: 1 };
test("validation rejects unsafe crop bounds, encoding order, method and alpha contracts", () => {
  for (const steps of [[], [{ kind: "crop", unit: "fraction", x: 0.8, y: 0, width: 0.3, height: 1 }], [{ kind: "encode", format: "png" }, { kind: "flip", axis: "both" }], [{ kind: "alpha", mode: "preserve", background: "#000000" }], [{ ...denoise, searchWindow: 7 }], [{ kind: "encode", format: "png", quality: 80 }], [{ kind: "flip", axis: "both", extra: true }]]) assert.throws(() => validateImageProgram({ orderedSteps: steps }));
  assert.throws(() => validateRasterRequest({ action: "unknown" }));
});
test("author decoding rejects nested operation bodies, layer ids and wrong image references", async t => {
  const ctx = await fixture(t); const workspace = Workspace.open({ cwd: ctx.projectRoot });
  const registry = { ...builtins, findModule(id: string) { return [transform, compose].find(module => module.id === id) ?? builtins.findModule(id); }, findProducer(ref: string) { const [id, name] = ref.split("#"); return [transform, compose].find(module => module.id === id)?.producers[name!] ?? builtins.findProducer(ref); } };
  for (const body of ['<x:Program id="p"><x:Flip><x:Flip/></x:Flip></x:Program>', '<x:Program id="p"><x:Color garbage="1"/></x:Program>', '<x:Program id="p"><x:Encode/><x:Blur sigma="1"/></x:Program>', '<s:Canvas id="c" width="8" height="8"/><c:Image id="out" canvas={c}><c:Layer id="no" source={c} frame={c}/></c:Image>', '<x:Program id="p"><x:Flip/></x:Program><s:Canvas id="c" width="8" height="8"/><x:Transform id="t" source={c} program={p}/>']) {
    const file = join(ctx.projectRoot, "bad.dvml"); await writeFile(file, `<?dvml using="dsivio-video/markup@1"?><dvml><import from="dsivio-video/image-transform@1" as="x"/><import from="dsivio-video/image-compose@1" as="c"/><import from="dsivio-video/space@1" as="s"/>${body}</dvml>`); assert.throws(() => compileAuthor(file, workspace, registry));
  }
});
test("fraction crop uses Python ties-to-even and sequential rotate/flip geometry", prepared, async t => {
  const ctx = await fixture(t); const source = await pixels(ctx, 4, 2, [10,0,0,50, 20,0,0,60, 30,0,0,70, 40,0,0,80, 50,0,0,90, 60,0,0,100, 70,0,0,110, 80,0,0,120]);
  const out = await edit(ctx, source, [{ kind: "crop", unit: "fraction", x: 0.125, y: 0, width: 0.5, height: 1 }, { kind: "rotate", degrees: 90 }, { kind: "flip", axis: "horizontal" }]);
  assert.deepEqual([...out.data], [10,0,0,50, 50,0,0,90, 20,0,0,60, 60,0,0,100]);
  await assert.rejects(edit(ctx, source, [{ kind: "crop", unit: "pixel", x: 3, y: 0, width: 2, height: 1 }]), /RASTER_CROP_RANGE/);
});
test("temperature tint and exposure use BGR ordering while alpha remains unchanged", prepared, async t => {
  const ctx = await fixture(t); const source = await pixels(ctx, 1, 1, [100, 50, 20, 37]);
  const out = await edit(ctx, source, [{ ...colorStep, exposureStops: 1, temperature: 0.5, tint: -0.5 }]);
  assert.deepEqual([...out.data], [216, 84, 24, 37]);
});
test("denoise skips small input and filters never blur or sharpen alpha", prepared, async t => {
  const ctx = await fixture(t); const source = await pixels(ctx, 2, 1, [10,40,80,0, 200,60,30,255]);
  const small = await edit(ctx, source, [denoise]); assert.deepEqual([...small.data], [10,40,80,0, 200,60,30,255]);
  for (const step of [{ kind: "blur", sigma: 1 }, { kind: "sharpen", amount: 2, radius: 1, threshold: 255 }] as RasterStep[]) { const out = await edit(ctx, source, [step]); assert.equal(out.data[3], 0); assert.equal(out.data[7], 255); if (step.kind === "sharpen") assert.deepEqual(out.data, small.data); }
  const noisy = Array.from({ length: 40 * 40 }, (_, i) => [100 + (i % 3 - 1) * 8, 80 + (i % 5 - 2) * 4, 60, i % 256]).flat();
  const large = await pixels(ctx, 40, 40, noisy); const cleaned = await edit(ctx, large, [{ ...denoise, luma: 10, chroma: 20 }]);
  assert.deepEqual([...cleaned.data.filter((_, i) => i % 4 === 3)], noisy.filter((_, i) => i % 4 === 3));
  const roughness = (data: number[] | Buffer): number => { let sum = 0; for (let i = 4; i < data.length; i += 4) sum += Math.abs(data[i]! - data[i - 4]!); return sum; };
  assert.ok(roughness(cleaned.data) < roughness(noisy) / 2);
});
test("contain leaves transparent gutters and cover crops the centered source", prepared, async t => {
  const ctx = await fixture(t); const source = await pixels(ctx, 4, 2, Array.from({ length: 8 }, (_, i) => [i*20,0,0,128]).flat());
  const contained = await edit(ctx, source, [{ kind: "resize", width: 4, height: 4, fit: "contain", interpolation: "nearest" }]);
  assert.deepEqual([...contained.data.subarray(0, 16)], Array(16).fill(0)); assert.equal(contained.data[19], 128);
  const covered = await edit(ctx, source, [{ kind: "resize", width: 2, height: 2, fit: "cover", interpolation: "nearest" }]);
  assert.deepEqual([...covered.data], [20,0,0,128,40,0,0,128,100,0,0,128,120,0,0,128]);
});
test("flatten and JPEG require explicit backgrounds; WebP preserves alpha", prepared, async t => {
  const ctx = await fixture(t); const source = await pixels(ctx, 2, 2, Array(4).fill([200,100,0,128]).flat());
  await assert.rejects(edit(ctx, source, [{ kind: "encode", format: "jpeg" }]), /RASTER_JPEG_BACKGROUND/);
  const flattened = await edit(ctx, source, [{ kind: "alpha", mode: "flatten", background: "#0000FF" }]); assert.deepEqual([...flattened.data.subarray(0,4)], [100,50,127,255]);
  const jpeg = await edit(ctx, source, [{ kind: "encode", format: "jpeg", background: "#0000FF", quality: 100 }]); assert.equal(jpeg.ref.mime, "image/jpeg"); assert.equal(jpeg.data[3], 255);
  const webp = await edit(ctx, source, [{ kind: "encode", format: "webp", quality: 100 }]); assert.equal(webp.ref.mime, "image/webp"); assert.equal(webp.data[3], 128);
});
test("composition applies opacity before straight-alpha over, clips and deduplicates inputs", prepared, async t => {
  const ctx = await fixture(t); const red = await pixels(ctx, 2, 2, Array(4).fill([255,0,0,128]).flat()); const blue = await pixels(ctx, 2, 2, Array(4).fill([0,0,255,128]).flat());
  const request = { action: "compose", canvas: { canvasKey: "c", extent: { widthPx: 2, heightPx: 2 } }, plan: { background: "#00000000", layers: [{ fit: "stretch", interpolation: "nearest", opacity: 1 }, { fit: "stretch", interpolation: "nearest", opacity: 0.5 }, { fit: "stretch", interpolation: "nearest", opacity: 1 }] }, sources: [red, blue, red], frames: [{ canvasKey: "c", rect: { xPx: -1, yPx: 0, widthPx: 2, heightPx: 2 } }, { canvasKey: "c", rect: { xPx: 0, yPx: 0, widthPx: 2, heightPx: 2 } }, { canvasKey: "c", rect: { xPx: 10, yPx: 10, widthPx: 2, heightPx: 2 } }] };
  if (rasterCapability.executor.kind !== "immediate") throw new Error("Unexpected executor");
  const result = await rasterCapability.executor.run(request as unknown as Json, ctx); const output = await sharp(ctx.store.pathOf(result.data as unknown as ResourceRef)).raw().toBuffer();
  const sa = 128/255*0.5, da = 128/255, alpha = sa + da*(1-sa);
  assert.deepEqual([...output.subarray(0,4)], [Math.round(255*da*(1-sa)/alpha),0,Math.round(255*sa/alpha),Math.round(255*alpha)]);
  assert.deepEqual([...output.subarray(4,8)], [0,0,255,64]);
  request.frames[0]!.canvasKey = "wrong"; assert.throws(() => validateRasterRequest(request), { code: "RASTER_CANVAS_MISMATCH" });
  await assert.rejects(rasterCapability.executor.run({ action: "edit", source: { ...red, bytes: RASTER_LIMITS.inputBytes + 1 }, orderedSteps: [{ kind: "flip", axis: "both" }] }, ctx), { code: "RASTER_INPUT_LIMIT" });
  await assert.rejects(rasterCapability.executor.run({ action: "edit", source: { ...red, bytes: red.bytes + 1 }, orderedSteps: [{ kind: "flip", axis: "both" }] }, ctx), { code: "RASTER_INPUT_INVALID" });
});
