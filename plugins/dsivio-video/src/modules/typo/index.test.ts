import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAuthor } from "../../elaborate/compile.ts";
import type { AuthorRegistry } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import type { TypographyAuthorPlan } from "../../components/types.ts";
import { trackTypes } from "../../components/types.ts";
import typo from "./index.ts";
import fonts from "../fonts/index.ts";
import space from "../space/index.ts";
import program from "../program/index.ts";
import time from "../time/index.ts";
import recipe from "../recipe/index.ts";
import visual from "../visual/index.ts";

function fixture(t:test.TestContext) {
 const dir=mkdtempSync(join(tmpdir(),"dv-typo-author-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const modules=[typo,fonts,space,program,time,recipe,visual];
 const registry:AuthorRegistry={findModule:id=>modules.find(m=>m.id===id),findProducer:ref=>{const at=ref.lastIndexOf("#");return modules.find(m=>m.id===ref.slice(0,at))?.producers[ref.slice(at+1)];},findFrontend:using=>modules.map(m=>m.frontends?.[using]).find(Boolean)};
 writeFileSync(join(dir,"look.dvs"),'<?dvml using="dsivio-video/dvs@1"?><sheet version="1">typo.base { stack-order: 20; size: 48; fill: "#FFFFFF"; }</sheet>');
 const imports=modules.map(m=>`<import as="${m.id.split("/").at(-1)!.split("@")[0]}" from="${m.id}"/>`).join("");
 const prefix=`${imports}<import as="look" source="./look.dvs"/><program:Clock id="clock" frame-rate="30"/><time:Timeline id="timeline" clock={clock} end="30f"/><space:Canvas id="canvas" width="800" height="600"/><space:Point id="place" within={canvas} x="100px" y="100px"/><fonts:Face id="face" family="noto-sans-sc" weight="400" style="normal"/><typo:Style id="style" recipe={look.typo.base} font={face}/>`;
 return (body:string)=>{const file=join(dir,"main.dvml");writeFileSync(file,`<?dvml using="dsivio-video/markup@1"?><dvml>${prefix}${body}</dvml>`);return compileAuthor(file,Workspace.open({cwd:dir}),registry);};
}

test("rich inline authoring preserves separator spaces, explicit breaks and paragraph order",t=>{
 const compile=fixture(t);
 const graph=compile('<typo:Track id="track" timeline={timeline}><typo:Point id="title" placement={place} style={style} during="program"><typo:P>你好 <typo:Span style={style}>世界</typo:Span> <typo:Span style={style}>朋友</typo:Span><typo:Break/> 再见</typo:P><typo:P>第二段</typo:P></typo:Point></typo:Track>');
 const record=[...graph.records.values()].find(r=>r.value.type===trackTypes.typographyPlan)!;
 const plan=record.value.data as unknown as TypographyAuthorPlan;
 const content=plan.items[0]!.content;assert.equal(content.kind,"paragraphs");if(content.kind!=="paragraphs")throw new Error("Expected rich content");
 assert.deepEqual(content.paragraphs.map(p=>p.runs.map(r=>r.kind==="break"?"<break>":r.text)),[["你好 ","世界"," ","朋友","<break>"," 再见"],["第二段"]]);
});
test("Path authoring rejects hard breaks and multiple paragraphs without flattening rich spans",t=>{
 const compile=fixture(t);
 const path='<space:Path id="curve" within={canvas} x="0px" y="0px"><space:Line x="700px" y="0px"/></space:Path>';
 for(const body of ['<typo:P>第一段<typo:Break/>第二行</typo:P>','<typo:P>第一段</typo:P><typo:P>第二段</typo:P>']){
  assert.throws(()=>compile(path+'<typo:Track id="track" timeline={timeline}><typo:Path id="title" placement={curve} style={style} during="program">'+body+'</typo:Path></typo:Track>'),{code:"TYPO_PATH_SINGLE_PARAGRAPH"});
 }
});
