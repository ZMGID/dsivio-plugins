import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { DvError } from "../core/errors.ts";
import { ProjectStore } from "../build/resources.ts";
import { readFontCatalog } from "../fonts/setup.ts";
import { localCapabilities } from "../fonts/capabilities.ts";
import type { FontFace } from "../fonts/types.ts";
import type { Timeline } from "../timeline/types.ts";
import { projectWindow } from "../timeline/temporal.ts";
import { typographyStyle } from "../components/typo/author.ts";
import { assembleTypography } from "../components/typo/program.ts";
import { lowerTypography } from "../components/typo/lower.ts";
import { compileDocument } from "./document.ts";
import { locateBrowser } from "./browser.ts";

async function fixture(t:test.TestContext){
 let location;
 try{location=await locateBrowser("render");await readFontCatalog();}
 catch(error){if(error instanceof DvError&&["BROWSER_NOT_PREPARED","FONT_NOT_PREPARED"].includes(error.code)){t.skip("Requires explicit setup browser and setup fonts");return;}throw error;}
 const dir=await mkdtemp(join(tmpdir(),"dv-text-runtime-"));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new ProjectStore(dir),executor=localCapabilities[0]!.executor;
 if(executor.kind!=="immediate")throw new Error("Expected immediate font preparation");
 const value=await executor.run({faceKey:"regression-sc",family:"noto-sans-sc",weight:400,style:"normal"},{projectRoot:dir,buildId:"test",commandKey:"font",idempotencyKey:"font",workDir:dir,store,signal:new AbortController().signal,log:()=>{}});
 const face=value.data as unknown as FontFace;
 const browser=await puppeteer.launch({executablePath:location.path,headless:true,args:["--no-sandbox"]});t.after(()=>browser.close());
 async function pageFor(kind:"path"|"area",color:boolean,ellipsis=false){
  const timeline:Timeline={axisKey:"test-axis",clock:{fps:{numerator:30,denominator:1}},totalFrames:60,placements:[]};
  const style=typographyStyle("style",{rule:"typo.test",properties:{"stack-order":1,size:48,fill:"#FFFFFF",wrap:"none"}},face,{paints:[{kind:"stroke",widthPx:2,placement:"outside",ink:{kind:"solid",color:"#000000"}}],axes:[],features:[],decorations:[]});
  if(ellipsis){style.layout.overflow="ellipsis";style.layout.maxLines=3;style.layout.wrap="word";}
  const program=assembleTypography(timeline,{trackKey:"track",items:[{itemKey:"item",windowIndex:0,styleIndex:0,placement:{kind,index:0},content:{kind:"text",textIndex:0}}]},[projectWindow(timeline,{kind:"during",source:"program"},"item")],[style],[],[],[{canvasKey:"canvas",rect:{xPx:40,yPx:40,widthPx:540,heightPx:ellipsis?180:160}}],[{canvasKey:"canvas",start:{xPx:40,yPx:160},segments:[{kind:"line",to:{xPx:580,yPx:160}}]}],[ellipsis?"A long comment should remain readable and show an ellipsis at the end of the third line ".repeat(6):"可见"]);
  if(color)program.items[0]!.content.sequences=[{sequenceKey:"color",unit:"grapheme",units:{start:0,end:2},startFrame:0,durationFrames:30,staggerFrames:0,cycles:1,order:"forward",poses:[{progress:0,easing:"linear",declarations:[{property:"opacity",value:"1"}]},{progress:1,easing:"linear",declarations:[{property:"opacity",value:"1"},{property:"color",value:"#FF0000"}]}]}];
  const track=lowerTypography(program);if(kind==="path")track.presents[0]!.lifetime={start:10,end:20};
  const document=compileDocument({compositionKey:"test",canvasKey:"canvas",extent:{widthPx:640,heightPx:240},domain:{axisKey:timeline.axisKey,clock:timeline.clock,totalFrames:60,totalSamples48k:96000},background:"#101820",visualTracks:[track],audioTracks:[]});
  let html=document.html;for(const usage of document.resources){const bytes=await readFile(store.pathOf(usage.resource));html=html.replaceAll("dv-resource://"+usage.resource.$resource,"data:"+usage.resource.mime+";base64,"+bytes.toString("base64"));}
  if(ellipsis)html+="<style>body{transform:rotate(-2.5deg) scale(.9);transform-origin:0 0}</style>";
  const page=await browser.newPage();await page.setViewport({width:640,height:240});await page.setContent(html,{waitUntil:"load"});await page.evaluate("window.__dvReady");return page;
 }
 return {pageFor};
}

test("real text runtime preserves lifetime visibility and reconstructs paint after reverse seek",async t=>{
 const f=await fixture(t);if(!f)return;
 await t.test("Path glyphs stay hidden outside their Present window",async()=>{
  const page=await f.pageFor("path",false);
  try{
   await page.evaluate("window.__dvSeekFrame(0)");const before=await page.screenshot();
   assert.equal(await page.evaluate("Array.from(document.querySelectorAll('[data-dv-fill=true]')).every(el=>getComputedStyle(el).visibility==='hidden')"),true);
   await page.evaluate("window.__dvSeekFrame(15)");const inside=await page.screenshot();assert.notDeepEqual(before,inside);
   await page.evaluate("window.__dvSeekFrame(20)");assert.deepEqual(await page.screenshot(),before);
  }finally{await page.close();}
 });
 await t.test("SVG color animation restores original paint when seeking before its color pose",async()=>{
  const page=await f.pageFor("area",true);
  try{
   await page.evaluate("window.__dvSeekFrame(0)");const before=await page.screenshot();
   await page.evaluate("window.__dvSeekFrame(30)");assert.notDeepEqual(await page.screenshot(),before);
   assert.equal(await page.evaluate("Array.from(document.querySelectorAll('[data-dv-fill=true]')).every(el=>el.getAttribute('fill')==='#FF0000')"),true);
   await page.evaluate("window.__dvSeekFrame(0)");assert.deepEqual(await page.screenshot(),before);
   assert.equal(await page.evaluate("Array.from(document.querySelectorAll('[data-dv-fill=true]')).every(el=>el.getAttribute('fill')==='#FFFFFF')"),true);
  }finally{await page.close();}
 });
});

test("transformed fixed-area word wrapping retains complete words and a visible third-line ellipsis",async t=>{
 const f=await fixture(t);if(!f)return;const page=await f.pageFor("area",false,true);
 try{
  await page.evaluate("window.__dvSeekFrame(0)");
  const lines=await page.evaluate(()=>{
   const rows=new Map<number,string>();
   for(const glyph of Array.from(document.querySelectorAll<HTMLElement>("[data-run] > span > span"))){
    const top=glyph.offsetTop;
    rows.set(top,(rows.get(top)||"")+(glyph.childNodes[0]?.textContent||""));
   }
   return Array.from(rows.entries()).sort((a,b)=>a[0]-b[0]).map(entry=>entry[1]);
  });
  assert.equal(lines.length,3);assert.equal(lines[2]!.endsWith("…"),true,JSON.stringify(lines));
  const vocabulary=new Set("A long comment should remain readable and show an ellipsis at the end of the third line".split(" "));
  for(const line of lines.slice(0,2))for(const word of line.trim().split(/\s+/))assert.equal(vocabulary.has(word),true);
  assert.equal(await page.evaluate("document.querySelector('[data-dv-ellipsis=true]').childNodes[0].textContent"),"…");
 }finally{await page.close();}
});
