import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DvError } from "../core/errors.ts";
import { ProjectStore } from "../build/resources.ts";
import { runTool } from "../tools/index.ts";
import { localCapabilities as fontCapabilities } from "../fonts/capabilities.ts";
import { validateFontFace } from "../fonts/validate.ts";
import { typographyStyle } from "../components/typo/author.ts";
import { locateBrowser } from "./browser.ts";
import { compileDocument } from "./document.ts";
import { captureFrames } from "./frames.ts";
import { localizeHtml } from "./resources.ts";
import type { Composition, TextFlow, VisualNode } from "./ir.ts";
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
test("Program setup can measure mounted text and its draw overrides descendant text motion",{skip},async t=>{
  const root=await mkdtemp(join(tmpdir(),"dv-program-text-"));const store=new ProjectStore(root);const ctx={buildId:"test",commandKey:"test",idempotencyKey:"test",projectRoot:root,workDir:join(root,"work"),store,signal:new AbortController().signal,log() {}};
  try {
    const font=fontCapabilities[0]!;
    assert.equal(font.executor?.kind,"immediate");
    if(font.executor?.kind!=="immediate")throw new Error("Expected local font executor");
    let value;
    try{value=await font.executor.run({faceKey:"sc",family:"noto-sans-sc",weight:400,style:"normal"},ctx);}
    catch(cause){if(cause instanceof DvError&&cause.code==="FONT_NOT_PREPARED"){t.skip("Run setup fonts for real text/program integration");return;}throw cause;}
    validateFontFace(value.data);
    const format=typographyStyle("style",{rule:"typo.test",properties:{"stack-order":0,size:32,fill:"#FFFFFF",wrap:"none"}},value.data,{paints:[],axes:[],features:[],decorations:[]}).format;
    const flow:TextFlow={format,layout:{mode:"area",inlineSize:"fixed",blockSize:"fixed",align:"start",blockAlign:"start",paddingPx:[0,0,0,0],wrap:"none",overflow:"visible",columns:1,columnGapPx:0,metricEdge:"line-box",pointAnchor:{inline:"start",block:"start"},clip:false},paragraphs:[{paragraphKey:"p",runs:[{kind:"run",runKey:"r",text:"时间"}]}],sequences:[{sequenceKey:"motion",unit:"run",units:{start:0,end:1},startFrame:0,durationFrames:3,staggerFrames:0,cycles:1,order:"forward",poses:[{progress:0,easing:"linear",declarations:[{property:"opacity",value:"0.25"}]},{progress:1,easing:"linear",declarations:[{property:"opacity",value:"1"}]}]}]};
    const nodes:VisualNode[]=[
      {kind:"program",nodeKey:"program",parentKey:null,order:0,style:[],attributes:[],keyframes:[],program:{format:"dsivio-video.browser-program/1",html:'<div class="child">{{text}}</div>',css:"",setup:'const run=root.querySelector(".child span");if(!run||run.getBoundingClientRect().width<=0)throw new Error("Descendant text was not mounted");return ()=>{run.style.opacity="0";};',data:{},resources:[]}},
      {kind:"text-flow",nodeKey:"text",parentKey:"program",order:1,style:[{property:"position",value:"absolute"},{property:"left",value:"8px"},{property:"top",value:"16px"},{property:"width",value:"112px"},{property:"height",value:"64px"}],attributes:[],keyframes:[],flow},
    ];
    const captured=await captureFrames({input:{kind:"document",document:compileDocument(composition(nodes))},frames:[0,2]},ctx);
    const expected=Buffer.alloc(128*96*3).fill(Buffer.from([16,32,48]));
    for(const frame of captured.frames)assert.deepEqual(await sharp(store.pathOf(frame.resource)).removeAlpha().raw().toBuffer(),expected);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("Descendant visible styles and program draws cannot escape Present lifetime or visible windows",{skip},async()=>{
  const root=await mkdtemp(join(tmpdir(),"dv-present-gate-"));const store=new ProjectStore(root);const ctx={buildId:"test",commandKey:"test",idempotencyKey:"test",projectRoot:root,workDir:join(root,"work"),store,signal:new AbortController().signal,log() {}};
  try {
    const nodes:VisualNode[]=[["lifetime","8px","#00ff00","#00ff00"],["gapped","72px","#ff0000","#0000ff"]].map(([nodeKey,left,first,last])=>({kind:"program",nodeKey:nodeKey!,parentKey:null,order:0,attributes:[],keyframes:[],style:[{property:"position",value:"absolute"},{property:"left",value:left!},{property:"top",value:"8px"}],program:{format:"dsivio-video.browser-program/1",html:'<div class="paint" style="width:32px;height:32px;visibility:visible"></div>',css:".paint{visibility:visible}",setup:'const paint=root.querySelector(".paint");return frame=>{paint.style.visibility="visible";paint.style.backgroundColor=frame>=2?data.last:data.first;};',data:{first:first!,last:last!},resources:[]}}));
    const scene=composition([nodes[0]!]);const present=scene.visualTracks[0]!.presents[0]!;
    scene.visualTracks[0]!.presents=[
      {...present,lifetime:{start:1,end:2}},
      {...present,presentKey:"gapped",layer:1,layerKey:"gapped",lifetime:{start:0,end:3},visible:[{start:0,end:1},{start:2,end:3}],rootKey:nodes[1]!.nodeKey,nodes:[nodes[1]!]},
    ];
    const captured=await captureFrames({input:{kind:"document",document:compileDocument(scene)},frames:[0,1,2]},ctx);
    const expected=[[[16,32,48],[255,0,0]],[[0,255,0],[16,32,48]],[[16,32,48],[0,0,255]]];
    for(const frame of captured.frames){
      const data=await sharp(store.pathOf(frame.resource)).removeAlpha().raw().toBuffer();
      const pixel=(x:number)=>[...data.subarray((10*128+x)*3,(10*128+x)*3+3)];
      assert.deepEqual([pixel(10),pixel(74)],expected[frame.frame]);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
