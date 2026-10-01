import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DvError } from "../core/errors.ts";
import { ProjectStore } from "../build/resources.ts";
import { runTool } from "../tools/index.ts";
import { locateBrowser } from "./browser.ts";
import { compileDocument } from "./document.ts";
import { captureFrames } from "./frames.ts";
import { localizeHtml } from "./resources.ts";
import type { Composition, VisualNode } from "./ir.ts";
let prepared=true;
try {await locateBrowser("render");} catch(cause){if(!(cause instanceof DvError)||cause.code!=="BROWSER_NOT_PREPARED")throw cause;prepared=false;}
const skip=!prepared&&"Run setup browser --kind render for real browser tests";
function composition(nodes:VisualNode[]):Composition {return {compositionKey:"proof",canvasKey:"canvas",domain:{axisKey:"axis",clock:{fps:{numerator:3,denominator:1}},totalFrames:3,totalSamples48k:48000},extent:{widthPx:128,heightPx:96},background:"#102030",audioTracks:[],visualTracks:[{kind:"visual",trackKey:"track",axisKey:"axis",presents:[{presentKey:"p",axisKey:"axis",lifetime:{start:0,end:3},layer:0,layerKey:"p",rootKey:nodes[0]!.nodeKey,nodes}]}]};}
test("Localized compiled HTML keeps exact injected video source frames after resource IDs change",{skip},async()=>{
  const root=await mkdtemp(join(tmpdir(),"dv-html-video-"));const store=new ProjectStore(root);const ctx={buildId:"test",commandKey:"test",idempotencyKey:"test",projectRoot:root,workDir:join(root,"work"),store,signal:new AbortController().signal,log() {}};
  try {
    const video=join(root,"source.mp4");await runTool("ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=size=128x96:rate=3:duration=1","-an","-c:v","libx264","-pix_fmt","yuv420p",video]);const resource=await store.putFile(video,"video/mp4");
    const node:VisualNode={kind:"video",nodeKey:"video",parentKey:null,order:0,attributes:[],style:[{property:"width",value:"128px"},{property:"height",value:"96px"}],keyframes:[],resource,sampling:{sourceClock:{fps:{numerator:3,denominator:1}},sourceTotalFrames:3,pieces:[{target:{start:0,end:3},sourceStart:{numerator:1,denominator:1},sourceStep:{numerator:0,denominator:1}}]}};
    const doc=compileDocument(composition([node]));const html=join(root,"index.html");await writeFile(html,doc.html.replaceAll(`dv-resource://${resource.$resource}`,"./source.mp4"));const project=await localizeHtml(html,ctx);assert.notEqual(project.resources[0]!.$resource,resource.$resource);
    const captured=await captureFrames({input:{kind:"html",project},frames:[0,2]},ctx);const expected=await runTool("ffmpeg",["-v","error","-i",video,"-vf","select=eq(n\\,1)","-frames:v","1","-f","image2pipe","-c:v","png","pipe:1"]);
    const pixels=await sharp(expected.stdout).removeAlpha().raw().toBuffer();for(const frame of captured.frames)assert.deepEqual(await sharp(store.pathOf(frame.resource)).removeAlpha().raw().toBuffer(),pixels);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("Rasterized masks preserve alpha versus luminance and parent-local transforms",{skip},async()=>{
  const root=await mkdtemp(join(tmpdir(),"dv-mask-"));const store=new ProjectStore(root);const ctx={buildId:"test",commandKey:"test",idempotencyKey:"test",projectRoot:root,workDir:join(root,"work"),store,signal:new AbortController().signal,log() {}};
  try {
    const path=join(root,"mask.png");await runTool("ffmpeg",["-v","error","-f","lavfi","-i","color=black:s=64x32,format=rgb24,drawbox=x=0:y=0:w=32:h=32:color=white:t=fill","-frames:v","1",path]);const resource=await store.putFile(path,"image/png");
    for(const mode of ["alpha","luminance"] as const){const nodes:VisualNode[]=[{kind:"mask",nodeKey:"mask",parentKey:null,order:0,attributes:[],keyframes:[],mode,maskRootKey:"source",contentRootKey:"content",style:[{property:"position",value:"absolute"},{property:"left",value:"10px"},{property:"top",value:"10px"},{property:"width",value:"64px"},{property:"height",value:"32px"},{property:"transform",value:"translateX(10px)"}]},{kind:"image",nodeKey:"source",parentKey:"mask",order:1,attributes:[],keyframes:[],style:[{property:"width",value:"64px"},{property:"height",value:"32px"}],resource},{kind:"box",nodeKey:"content",parentKey:"mask",order:2,attributes:[],keyframes:[],style:[{property:"width",value:"64px"},{property:"height",value:"32px"},{property:"background-color",value:"#00ff00"}]}];const doc=compileDocument(composition(nodes));const captured=await captureFrames({input:{kind:"document",document:doc},frames:[1]},ctx);const data=await sharp(store.pathOf(captured.frames[0]!.resource)).removeAlpha().raw().toBuffer();const pixel=(x:number,y:number)=>[...data.subarray((y*128+x)*3,(y*128+x)*3+3)];assert.deepEqual(pixel(25,15),[0,255,0]);assert.deepEqual(pixel(70,15),mode==="alpha"?[0,255,0]:[16,32,48]);assert.deepEqual(pixel(5,5),[16,32,48]);}
  }finally{await rm(root,{recursive:true,force:true});}
});
