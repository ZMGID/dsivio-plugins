import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../build/resources.ts";
import { runTool } from "../tools/index.ts";
import { verifySilentVideo, validateVisualRequest } from "./visual.ts";
import { compileDocument } from "./document.ts";
import { prepareProject } from "./resources.ts";
import type { Composition } from "./ir.ts";
function composition(width=160):Composition {return {compositionKey:"c",canvasKey:"canvas",domain:{axisKey:"a",clock:{fps:{numerator:30,denominator:1}},totalFrames:6,totalSamples48k:9600},extent:{widthPx:width,heightPx:120},background:"#101820",visualTracks:[{kind:"visual",trackKey:"empty",axisKey:"a",presents:[]}],audioTracks:[]};}
test("Odd H.264 canvas is rejected without changing snapshot geometry",()=>{
  const c=composition(161);const d=compileDocument(c);
  assert.throws(()=>validateVisualRequest({document:d,frames:{start:0,end:6},quality:"draft"}),{code:"RENDER_ODD_EXTENT"});
  assert.equal(d.extent.widthPx,161);
});
test("Decoded H.264 frame, extent and rational FPS proof rejects incorrect delivery shapes",async()=>{
  const root=await mkdtemp(join(tmpdir(),"dv-probe-"));const store=new ProjectStore(root);const ctx={buildId:"test",commandKey:"test",idempotencyKey:"test",workDir:root,projectRoot:root,store,signal:new AbortController().signal,log() {}};
  try {const path=join(root,"video.mp4");await runTool("ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=size=160x120:rate=30000/1001","-frames:v","6","-an","-c:v","libx264","-pix_fmt","yuv420p",path]);const shape={extent:{widthPx:160,heightPx:120},clock:{fps:{numerator:30000,denominator:1001}},totalFrames:6};await verifySilentVideo(path,shape,ctx);await assert.rejects(verifySilentVideo(path,{...shape,totalFrames:5},ctx),{code:"RENDER_VIDEO_MISMATCH"});await assert.rejects(verifySilentVideo(path,{...shape,clock:{fps:{numerator:30,denominator:1}}},ctx),{code:"RENDER_VIDEO_MISMATCH"});await assert.rejects(verifySilentVideo(path,{...shape,extent:{widthPx:162,heightPx:120}},ctx),{code:"RENDER_VIDEO_MISMATCH"});}
  finally {await rm(root,{recursive:true,force:true});}
});
test("Raw HTML resource placeholders must materialize instead of yielding a blank frame",async()=>{
  const root=await mkdtemp(join(tmpdir(),"dv-missing-"));const store=new ProjectStore(root);const ctx={buildId:"test",commandKey:"test",idempotencyKey:"test",workDir:join(root,"work"),projectRoot:root,store,signal:new AbortController().signal,log() {}};
  try {const d=compileDocument(composition());const html=d.html.replace("</body>",'<img src="dv-resource://missing"></body>');await assert.rejects(prepareProject({input:{kind:"html",project:{html,domain:d.domain,extent:d.extent,resources:[]}},frames:[0]},ctx),{code:"RENDER_RESOURCE_MISSING"});}
  finally {await rm(root,{recursive:true,force:true});}
});
