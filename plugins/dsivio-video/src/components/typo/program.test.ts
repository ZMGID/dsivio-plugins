import test from "node:test";
import assert from "node:assert/strict";
import type {FontFace} from "../../fonts/types.ts";
import type {Timeline,Window} from "../../timeline/types.ts";
import type {TypographyAuthorPlan,TypographyStyle,TypographyMotion} from "../types.ts";
import type {Point,Frame,Path} from "../../space/types.ts";
import {projectWindow} from "../../timeline/temporal.ts";
import {typographyStyle} from "./author.ts";
import {assembleTypography} from "./program.ts";
import {lowerTypography,lowerTypographyMask} from "./lower.ts";
import {validateTextFlow} from "../../render/text-runtime.ts";
const face:FontFace={faceKey:"sc",family:"noto-sans-sc",weight:700,style:"normal",shards:[{resource:{$resource:"woff",bytes:100,mime:"font/woff2"},unicodeRange:"U+0-10FFFF"}],license:{spdx:"OFL-1.1",notice:{$resource:"licence",bytes:100,mime:"text/plain"}}};
const extra={paints:[],axes:[],features:[],decorations:[]};
const timeline:Timeline={axisKey:"axis",clock:{fps:{numerator:30,denominator:1}},totalFrames:60,placements:[]};
const makeStyle=(key:string,size:number,color:string)=>typographyStyle(key,{rule:"typo.test",properties:{"stack-order":20,size,fill:color,wrap:"none"}},face,extra);
test("precise primary font weight is retained and explicit mismatch fails",()=>{
 const style=makeStyle("s",48,"#ffffff");assert.equal(style.format.fonts.faces[0]?.weight,700);
 assert.throws(()=>typographyStyle("s",{rule:"typo.test",properties:{"stack-order":1,size:48,fill:"#FFFFFF",weight:400}},face,extra),{code:"TYPO_FONT_CONFLICT"});
 assert.throws(()=>typographyStyle("s",{rule:"typo.test",properties:{"stack-order":1,size:48,fill:"#FFFFFF",axes:[]}},face,extra),{code:"TYPO_RECIPE"});
});
test("rich run styles completely replace format without changing parent layout or layer",()=>{
 const plan:TypographyAuthorPlan={trackKey:"track",items:[{itemKey:"item",windowIndex:0,styleIndex:0,placement:{kind:"area",index:0},content:{kind:"paragraphs",paragraphs:[{paragraphKey:"p",runs:[{kind:"run",runKey:"r1",text:"时间"},{kind:"break"},{kind:"run",runKey:"r2",text:"画面",styleIndex:1}]}]}}]};
 const program=assembleTypography(timeline,plan,[projectWindow(timeline,{kind:"during",source:"program"},"item")],[makeStyle("base",48,"#FFFFFF"),makeStyle("override",24,"#FF0000")],[],[],[{canvasKey:"canvas",rect:{xPx:30,yPx:60,widthPx:500,heightPx:200}}],[],[]);
 const track=lowerTypography(program);assert.equal(track.trackKey,"track");assert.deepEqual(track.presents[0]?.lifetime,{start:0,end:60});const node=track.presents[0]!.nodes[0]!;assert.equal(node.kind,"text-flow");if(node.kind!=="text-flow")throw new Error("Expected flow");assert.equal(node.flow.format.sizePx,48);assert.equal(node.flow.paragraphs[0]?.runs[1]?.kind,"break");const run=node.flow.paragraphs[0]!.runs[2]!;if(run.kind!=="run")throw new Error("Expected run");assert.equal(run.format?.sizePx,24);assert.deepEqual(run.format?.paints,[{kind:"fill",ink:{kind:"solid",color:"#FF0000"}}]);
 assert.throws(()=>lowerTypographyMask(program,{resource:{$resource:"image",bytes:100,mime:"image/png"},extent:{widthPx:500,heightPx:200},alpha:"opaque",color:"srgb-sdr",timing:{kind:"still"}},"mask"),{code:"TYPO_MASK"});
});
test("path lower subtracts node spatial origin exactly once and rejects invalid typed indices",()=>{
 const plan:TypographyAuthorPlan={trackKey:"track",items:[{itemKey:"item",windowIndex:0,styleIndex:0,placement:{kind:"path",index:0},content:{kind:"text",textIndex:0}}]};
 const args:[Timeline,TypographyAuthorPlan,Window[],TypographyStyle[],TypographyMotion[],Point[],Frame[],Path[],string[]]=[timeline,plan,[projectWindow(timeline,{kind:"during",source:"program"},"item")],[makeStyle("s",48,"#FFFFFF")],[],[],[],[{canvasKey:"c",start:{xPx:100,yPx:200},segments:[{kind:"line",to:{xPx:500,yPx:200}}]}],["中文"]];
 const p=assembleTypography(...args);const node=lowerTypography(p).presents[0]!.nodes[0]!;if(node.kind!=="path-text")throw new Error("Expected path text");assert.deepEqual(node.path,{start:{xPx:0,yPx:0},segments:[{kind:"line",to:{xPx:400,yPx:0}}]});
 assert.throws(()=>assembleTypography(timeline,{...plan,items:[{...plan.items[0]!,styleIndex:3}]},args[2],args[3],[],[],[],args[7],args[8]),{code:"TYPO_PLAN"});
 assert.throws(()=>validateTextFlow({...p.items[0]!.content,sequences:[{sequenceKey:"bad",unit:"word",units:{start:0,end:1},startFrame:0,durationFrames:10,staggerFrames:0,cycles:1,order:"random",poses:[{progress:0,easing:"linear",declarations:[{property:"opacity",value:"0"}]},{progress:1,easing:"linear",declarations:[{property:"opacity",value:"1"}]}]}]}));
});
