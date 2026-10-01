import type { Binding, ModuleDef, ProducerDef, SurfaceDef } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import { DvError } from "../../core/errors.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Canvas, Frame, Extent, PathSegment, ContentFitMode } from "../../space/types.ts";
import { fitContent, resolveFrame } from "../../space/math.ts";
import { attributes, literal, reference, empty, parseNumber, parseAspect, parseLength, lengthPx, parentRect, anchoredRect } from "../../space/parse.ts";
import { object, validateCanvas, validateFrame, validateExtent, validatePoint, validatePath } from "../../space/validate.ts";
const id = "dsivio-video/space@1";
const optionsType = `${id}#Options`;
const definitions: Record<string, string[]> = {
 Canvas: ["width","height"], Extent: ["width","height"], Frame: ["within","left","top","right","bottom"],
 AnchoredFrame: ["within","x","y","width","height","anchor","offset-x","offset-y"], AspectFrame: ["within","x","y","width","height","aspect","anchor","offset-x","offset-y"],
 ContentFit: ["frame","extent","fit","frame-x","frame-y","content-x","content-y","offset-x","offset-y","constraint"],
 Point: ["within","x","y","anchor-x","anchor-y"], Path: ["within","x","y"],
};
const surfaces: Record<string, SurfaceDef> = {};
const producers: Record<string, ProducerDef> = {};
for (const [name,names] of Object.entries(definitions)) {
 const outType = name === "Canvas" ? spaceTypes.canvas : name === "Extent" ? spaceTypes.extent : name === "Point" ? spaceTypes.point : name === "Path" ? spaceTypes.path : spaceTypes.frame;
 surfaces[name] = { mode: "structured", doc: { summary: `Construct ${name} in accumulated Canvas coordinates.`, attributes: ["id",...names].map(n => ({name:n,required: !["offset-x","offset-y","anchor-x","anchor-y","fit","frame-x","frame-y","content-x","content-y","constraint"].includes(n) && !(name === "AspectFrame" && ["width","height"].includes(n)),accepts:["within","frame","extent"].includes(n)?"reference":"text",summary:n})), outputs:[{name:"",type:outType,summary:name}], ...(name === "Path" ? { children:["Line","Quadratic","Cubic"].map(tag=>({tag,summary:`${tag} path segment`,repeat:true})) } : {}) },
 elaborate(e,ctx) {
  const a = attributes(e,["id",...names],ctx); const publicName = literal(a.id,"id",ctx,e); const options: Record<string,Json> = {name,key:entityIdentity(ctx.file,publicName)};
  if(name !== "Path") empty(e,ctx);
  const inputs: Record<string, Binding> = {};
  if(name === "Canvas" || name === "Extent") { const extent = {widthPx:parseNumber(literal(a.width,"width",ctx,e)),heightPx:parseNumber(literal(a.height,"height",ctx,e))}; const data = name === "Canvas" ? {canvasKey:String(options.key),extent} : extent; if(name === "Canvas") validateCanvas(data); else validateExtent(data); ctx.record(publicName,{type:outType,data},e.span); return; }
  const parentAttr = name === "ContentFit" ? "frame" : "within";
  const parent = reference(a[parentAttr],name === "ContentFit" ? [spaceTypes.frame] : [spaceTypes.canvas,spaceTypes.frame],ctx,e); inputs.parent = parent;
  if(name === "ContentFit") inputs.extent = reference(a.extent,[spaceTypes.extent],ctx,e);
  if(name === "AspectFrame" && a.aspect?.value.kind === "ref") inputs.extent = reference(a.aspect,[spaceTypes.extent],ctx,e);
  for(const n of names) if(a[n] && ![parentAttr,"extent"].includes(n) && !(n === "aspect" && a[n]!.value.kind === "ref")) options[n] = literal(a[n],n,ctx,e);
  if(name === "Path") { if(e.kind !== "element") return ctx.fail("MARKUP_CHILD","Path must be structured",e.span); const segments: Json[] = []; for(const c of e.children) { if(c.kind === "text" && !c.text.trim()) continue; if(c.kind !== "element") return ctx.fail("MARKUP_CHILD","Expected a path segment",c.span); const tag=c.tag.split(":").at(-1)!; const nn=tag === "Line"?["x","y"]:tag === "Quadratic"?["cx","cy","x","y"]:tag === "Cubic"?["c1x","c1y","c2x","c2y","x","y"]:null; if(!nn) return ctx.fail("MARKUP_CHILD","Unknown path segment",c.span); const ca=attributes(c,nn,ctx); empty(c,ctx); const s:Record<string,Json>={kind:tag}; for(const n of nn) s[n]=literal(ca[n],n,ctx,c); segments.push(s); } options.segments=segments; }
  inputs.options=ctx.record(null,{type:optionsType,data:options},e.span);
  const suffix = `${name.toLowerCase()}-${parent.type === spaceTypes.canvas ? "canvas" : "frame"}${inputs.extent ? "-extent" : ""}`;
  ctx.operation({producer:`${id}#${suffix}`,inputs,publish:{result:publicName},label:publicName,span:e.span});
 } };
 if(name === "Canvas" || name === "Extent") continue;
 for(const parentType of name === "ContentFit" ? [spaceTypes.frame] : [spaceTypes.canvas,spaceTypes.frame]) for(const withExtent of name === "ContentFit" ? [true] : name === "AspectFrame" ? [false,true] : [false]) {
  const suffix=`${name.toLowerCase()}-${parentType === spaceTypes.canvas ? "canvas" : "frame"}${withExtent?"-extent":""}`;
  producers[suffix]={inputs:{parent:{type:parentType},options:{type:optionsType},...(withExtent?{extent:{type:spaceTypes.extent}}:{})},outputs:{result:outType},run(inputs){
   const p=(inputs.parent as Value).data as unknown as Canvas|Frame; const o=object((inputs.options as Value).data); const r=parentRect(p); const text=(n:string,f?:string):string=>{ const v=o[n]??f; if(typeof v!=="string") throw new DvError("SPACE_ATTRIBUTE",`${n} is required`); return v; }; const num=(n:string,f="0")=>parseNumber(text(n,f)); const len=(n:string)=>parseLength(text(n)); let data:unknown;
   if(name === "Frame") data={canvasKey:p.canvasKey,rect:resolveFrame(r,{left:len("left"),top:len("top"),right:len("right"),bottom:len("bottom")})};
   else if(name === "AnchoredFrame" || name === "AspectFrame") { let w:number,h:number; if(name === "AspectFrame") { if((o.width!==undefined)===(o.height!==undefined)) throw new DvError("SPACE_ASPECT","AspectFrame requires exactly one dimension"); const ex=withExtent?(inputs.extent as Value).data as unknown as Extent:null; const ratio=ex?ex.widthPx/ex.heightPx: parseAspect(text("aspect")); if(!Number.isFinite(ratio)||ratio<=0) throw new DvError("SPACE_ASPECT","Aspect must be positive"); w=o.width!==undefined?lengthPx(len("width"),r.widthPx):lengthPx(len("height"),r.heightPx)*ratio; h=w/ratio; } else {w=lengthPx(len("width"),r.widthPx);h=lengthPx(len("height"),r.heightPx);} data={canvasKey:p.canvasKey,rect:anchoredRect(r,len("x"),len("y"),w,h,text("anchor"),num("offset-x"),num("offset-y"))}; }
   else if(name === "ContentFit") { const mode=text("fit","contain"); const limit=text("constraint","bounded"); data={canvasKey:p.canvasKey,rect:fitContent(r,(inputs.extent as Value).data as unknown as Extent,{mode:mode as ContentFitMode,limit:limit as "bounded"|"free",frameAnchor:{x:num("frame-x","0.5"),y:num("frame-y","0.5")},contentAnchor:{x:num("content-x","0.5"),y:num("content-y","0.5")},offsetXPx:num("offset-x"),offsetYPx:num("offset-y")})}; }
   else if(name === "Point") data={canvasKey:p.canvasKey,xPx:r.xPx+lengthPx(len("x"),r.widthPx),yPx:r.yPx+lengthPx(len("y"),r.heightPx),anchor:{x:num("anchor-x","0.5"),y:num("anchor-y","0.5")}};
   else { const coords=(s:Record<string,unknown>,x:string,y:string)=>({xPx:r.xPx+lengthPx(parseLength(String(s[x])),r.widthPx),yPx:r.yPx+lengthPx(parseLength(String(s[y])),r.heightPx)}); const segments:PathSegment[]=(o.segments as unknown[]).map(v=>{const s=object(v);const to=coords(s,"x","y");return s.kind === "Line" ? {kind:"line",to} : s.kind === "Quadratic" ? {kind:"quadratic",to,control:coords(s,"cx","cy")} : {kind:"cubic",to,control1:coords(s,"c1x","c1y"),control2:coords(s,"c2x","c2y")};});data={canvasKey:p.canvasKey,start:coords(o,"x","y"),segments}; }
   if(name === "Point") validatePoint(data); else if(name === "Path") validatePath(data); else validateFrame(data); return {outputs:{result:{type:outType,data:data as Json}}};
  }};
 }
}
function validateOptions(data:Json):void {
 const d=object(data);const name=String(d.name);
 if(typeof d.name!=="string"||!Object.hasOwn(definitions,name)||typeof d.key!=="string"||!d.key.trim())throw new DvError("TYPE_INVALID","Invalid spatial options identity");
 const names=definitions[name]!;
 const allowed=["name","key",...names.filter(n=>!["within","frame","extent"].includes(n)),...(name==="Path"?["segments"]:[])];
 if(Object.keys(d).some(n=>!allowed.includes(n)))throw new DvError("TYPE_INVALID","Unexpected spatial option");
 const required:Record<string,string[]>={Frame:["left","top","right","bottom"],AnchoredFrame:["x","y","width","height","anchor"],AspectFrame:["x","y","anchor"],Point:["x","y"],Path:["x","y"],ContentFit:[],Canvas:["width","height"],Extent:["width","height"]};
 for(const n of required[name]!)if(typeof d[n]!=="string")throw new DvError("TYPE_INVALID",`Missing spatial option ${n}`);
 for(const n of names)if(d[n]!==undefined){
  if(typeof d[n]!=="string")throw new DvError("TYPE_INVALID",`Spatial option ${n} requires text`);
  if(["left","top","right","bottom","x","y","width","height"].includes(n))name==="Canvas"||name==="Extent"?parseNumber(d[n]):parseLength(d[n]);
  if(["offset-x","offset-y","frame-x","frame-y","content-x","content-y","anchor-x","anchor-y"].includes(n)){const value=parseNumber(d[n]);if(!n.startsWith("offset")&&(value<0||value>1))throw new DvError("TYPE_INVALID","Spatial anchors must be in [0,1]");}
 }
 if(name==="AspectFrame"){if((d.width!==undefined)===(d.height!==undefined))throw new DvError("SPACE_ASPECT","AspectFrame requires exactly one dimension");if(d.aspect!==undefined)parseAspect(String(d.aspect));}
 if(d.anchor!==undefined&&!["top-left","top-center","top-right","center-left","center","center-right","bottom-left","bottom-center","bottom-right"].includes(String(d.anchor)))throw new DvError("SPACE_ANCHOR","Invalid spatial anchor");
 if(d.fit!==undefined&&!["contain","cover","fit-width","fit-height","native","scale-down","stretch"].includes(String(d.fit)))throw new DvError("SPACE_FIT","Invalid content fit");
 if(d.constraint!==undefined&&!["bounded","free"].includes(String(d.constraint)))throw new DvError("SPACE_FIT","Invalid content constraint");
 if(name==="Path"){
  if(!Array.isArray(d.segments)||!d.segments.length)throw new DvError("SPACE_PATH","Path requires ordered segments");
  for(const value of d.segments){const s=object(value);const names=s.kind==="Line"?["x","y"]:s.kind==="Quadratic"?["cx","cy","x","y"]:s.kind==="Cubic"?["c1x","c1y","c2x","c2y","x","y"]:null;if(!names||Object.keys(s).some(n=>n!=="kind"&&!names.includes(n)))throw new DvError("SPACE_PATH","Invalid path segment");for(const n of names){if(typeof s[n]!=="string")throw new DvError("SPACE_PATH","Path coordinates require px or %");parseLength(s[n]);}}
 }
}
const space:ModuleDef={id,summary:"Canvas, nested spatial frames, points and paths.",types:{Canvas:{summary:"Integer canvas",validate:validateCanvas},Frame:{summary:"Canvas-coordinate rectangle",validate:validateFrame},Extent:{summary:"Positive extent",validate:validateExtent},Point:{summary:"Anchored point",validate:validatePoint},Path:{summary:"Ordered open curve",validate:validatePath},Options:{summary:"Private spatial author options",validate:validateOptions}},surfaces,producers};
export default space;
