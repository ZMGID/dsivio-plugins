import assert from "node:assert/strict";
import test from "node:test";
import { resource, sampleFrame, validateDocument, validateSampling, validateStyle, validateVisualTrack } from "./validate.ts";
import type { VideoSamplingMap, VisualTrack } from "./ir.ts";
import { VISUAL_IR_VERSION } from "./ir.ts";
const map:VideoSamplingMap={sourceClock:{fps:{numerator:30000,denominator:1001}},sourceTotalFrames:12,pieces:[{target:{start:1,end:5},sourceStart:{numerator:5,denominator:2},sourceStep:{numerator:3,denominator:2}},{target:{start:6,end:12},sourceStart:{numerator:7,denominator:2},sourceStep:{numerator:3,denominator:2},loop:{sourceFrames:{start:2,end:5},phase:{numerator:3,denominator:2}}}]};
test("Sampling freezes gaps and wraps rational source positions before flooring",()=>{
  validateSampling(map,12);
  assert.deepEqual(Array.from({length:12},(_,frame)=>sampleFrame(map,frame)),[null,2,4,5,7,null,3,2,3,2,3,2]);
  assert.throws(()=>validateSampling({...map,pieces:[{...map.pieces[0]!,sourceStart:{numerator:11,denominator:1}}]},12),{code:"TYPE_INVALID"});
  assert.throws(()=>validateSampling({...map,pieces:[{...map.pieces[1]!,sourceStart:{numerator:3,denominator:1}}]},12),{code:"TYPE_INVALID"});
});
test("Safe integer inputs use exact wide intermediates instead of floating source rounding",()=>{
  const large:VideoSamplingMap={sourceClock:{fps:{numerator:30,denominator:1}},sourceTotalFrames:Number.MAX_SAFE_INTEGER,pieces:[{target:{start:0,end:2},sourceStart:{numerator:Number.MAX_SAFE_INTEGER-1,denominator:3},sourceStep:{numerator:1,denominator:3}}]};
  validateSampling(large,2);
  assert.equal(sampleFrame(large,1),Number(BigInt(Number.MAX_SAFE_INTEGER)/3n));
});
function track():VisualTrack {return {kind:"visual",trackKey:"t",axisKey:"a",presents:[{presentKey:"p",axisKey:"a",lifetime:{start:0,end:10},layer:0,layerKey:"p",rootKey:"root",nodes:[{nodeKey:"root",parentKey:null,order:0,kind:"box",style:[],attributes:[],keyframes:[]},{nodeKey:"child",parentKey:"root",order:1,kind:"box",style:[],attributes:[],keyframes:[]}]}]};}
test("Visual trees reject cycles, duplicate ordering, invalid parents and incomplete program slots",()=>{
  const cycle=track();cycle.presents[0]!.nodes[0]!.parentKey="child";assert.throws(()=>validateVisualTrack(cycle),{code:"TYPE_INVALID"});
  const duplicate=track();duplicate.presents[0]!.nodes[1]!.order=0;assert.throws(()=>validateVisualTrack(duplicate),{code:"TYPE_INVALID"});
  const program=track();program.presents[0]!.nodes[0]={...program.presents[0]!.nodes[0]!,kind:"program",program:{format:"dsivio-video.browser-program/1",html:"<div></div>",css:"",setup:"",data:{},resources:[]}};assert.throws(()=>validateVisualTrack(program),{code:"TYPE_INVALID"});
});
test("Structure styles reject hidden resource channels and declaration injection",()=>{
  for(const value of ["url(x)","var(--x)","e\\6ev(x)","red;opacity:0","red/*x*/","red!important"] )assert.throws(()=>validateStyle([{property:"background-color",value}]),{code:"TYPE_INVALID"});
  assert.throws(()=>validateStyle([{property:"width",value:"2px"},{property:"width",value:"3px"}]),{code:"TYPE_INVALID"});
  assert.throws(()=>validateStyle([{property:"width",value:"2px"}],true),{code:"TYPE_INVALID"});
});
test("Malformed resource MIME and placeholder encoding fail with stable validation errors",()=>{
  assert.throws(()=>resource({$resource:"r",bytes:1,mime:7}),{code:"TYPE_INVALID"});
  const document={version:VISUAL_IR_VERSION,compositionKey:"c",domain:{axisKey:"a",clock:{fps:{numerator:30,denominator:1}},totalFrames:1,totalSamples48k:1600},extent:{widthPx:8,heightPx:8},html:'<img src="dv-resource://%zz">',resources:[],surfaces:[]};
  assert.throws(()=>validateDocument(document),{code:"TYPE_INVALID"});
});
