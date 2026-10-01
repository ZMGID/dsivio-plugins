import test from "node:test";
import assert from "node:assert/strict";
import {parseLength,parseAspect,anchoredRect} from "./parse.ts";
import {validateCanvas,validatePoint,validatePath} from "./validate.ts";
import space from "../modules/space/index.ts";
import {spaceTypes} from "./types.ts";
test("explicit signed units and anchored placement preserve parent origin",()=>{
 assert.deepEqual(parseLength("-12.5%"),{unit:"%",value:-12.5});assert.throws(()=>parseLength("10"));
 assert.deepEqual(anchoredRect({xPx:100,yPx:50,widthPx:800,heightPx:400},parseLength("50%"),parseLength("50%"),200,100,"center",3,-2),{xPx:403,yPx:198,widthPx:200,heightPx:100});
 assert.throws(()=>validateCanvas({canvasKey:"a",extent:{widthPx:2.5,heightPx:100}}));assert.throws(()=>validatePoint({canvasKey:"a",xPx:0,yPx:0,anchor:{x:2,y:0}}));
});
test("spatial path uses parent percentages once and retains curve control coordinates",()=>{
 const result=space.producers["path-frame"]!.run({parent:{type:spaceTypes.frame,data:{canvasKey:"a",rect:{xPx:100,yPx:50,widthPx:800,heightPx:400}}},options:{type:"dsivio-video/space@1#Options",data:{name:"Path",key:"p",x:"0%",y:"50%",segments:[{kind:"Quadratic",cx:"50%",cy:"0px",x:"100%",y:"50%"}]}}});
 assert.deepEqual(result.outputs?.result?.data,{canvasKey:"a",start:{xPx:100,yPx:250},segments:[{kind:"quadratic",control:{xPx:500,yPx:50},to:{xPx:900,yPx:250}}]});
 assert.throws(()=>validatePath({canvasKey:"a",start:{xPx:0,yPx:0},segments:[{kind:"quadratic",to:{xPx:1,yPx:1}}]}));
});
test("aspect dimensions reject ambiguous ratios and nonpositive operands",()=>{
 assert.equal(parseAspect("16/9"),16/9);assert.equal(parseAspect("1.5"),1.5);
 for(const value of ["-16/-9","0/9","16/0","16/9/2"])assert.throws(()=>parseAspect(value),{code:"SPACE_ASPECT"});
 const validate=space.types.Options!.validate;
 assert.throws(()=>validate({name:"AspectFrame",key:"frame",x:"0px",y:"0px",anchor:"center",width:"100px",height:"100px",aspect:"16/9"}),{code:"SPACE_ASPECT"});
 assert.throws(()=>validate({name:"ContentFit",key:"fit",fit:"contain",constraint:"free",unknown:"100px"}),{code:"TYPE_INVALID"});
});
