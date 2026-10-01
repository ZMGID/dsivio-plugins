import test from "node:test";
import assert from "node:assert/strict";
import {validateFaceRequest,fontFamilyName} from "./catalog.ts";
import {validateFontStack,validateFontFace} from "./validate.ts";
import type {FontFace} from "./types.ts";
test("font requests reject unprepared families and unavailable static styles",()=>{
 assert.throws(()=>validateFaceRequest({faceKey:"a",family:"system-sans",weight:400,style:"normal"}),{code:"FONT_UNSUPPORTED"});assert.throws(()=>validateFaceRequest({faceKey:"a",family:"noto-sans-sc",weight:400,style:"italic"}),{code:"FONT_UNSUPPORTED"});assert.throws(()=>validateFaceRequest({faceKey:"a",family:"inter",weight:450,style:"normal"}),{code:"FONT_UNSUPPORTED"});assert.notEqual(fontFamilyName("a/b"),fontFamilyName("a-b"));
 for(const family of ["constructor","__proto__"])assert.throws(()=>validateFaceRequest({faceKey:"a",family,weight:400,style:"normal"}),{code:"FONT_UNSUPPORTED"});
 assert.throws(()=>fontFamilyName("\uD800"),{code:"FONT_UNSUPPORTED"});assert.throws(()=>validateFaceRequest({faceKey:"\uDFFF",family:"inter",weight:400,style:"normal"}),{code:"FONT_UNSUPPORTED"});
});
test("fallback rejects duplicate exact face even under different author identities",()=>{
 const face:FontFace={faceKey:"a",family:"inter",weight:400,style:"normal",shards:[{resource:{$resource:"woff",bytes:100,mime:"font/woff2"},unicodeRange:"U+0000-00FF"}],license:{spdx:"OFL-1.1",notice:{$resource:"license",bytes:100,mime:"text/plain"}}};
 assert.throws(()=>validateFontStack({stackKey:"stack",faces:[face,{...face,faceKey:"b"}]}),{code:"TYPE_INVALID"});assert.throws(()=>validateFontFace({...face,shards:[{...face.shards[0],unicodeRange:"not a range"}]}),{code:"TYPE_INVALID"});
});
