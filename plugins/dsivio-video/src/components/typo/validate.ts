import { DvError } from "../../core/errors.ts";
import { object, exact, key, finite, validatePoint, validateFrame, validatePath } from "../../space/validate.ts";
import { validateTimeline, validateWindow } from "../../timeline/validate.ts";
import { validateTextFlow, validateTextFormat, validateTextSequences, validatePathParagraphs } from "../../render/text-runtime.ts";
import type { TypographyStyle, TypographyMotion, TypographyProgram, TypographyAuthorPlan } from "../types.ts";
import { validateStyle } from "../../render/validate.ts";
export {validateTextFlow,validateTextFormat};
export function validateTypographyStyle(value:unknown):asserts value is TypographyStyle {
 const d=object(value);exact(d,["styleKey","layer","format","layout","outerStyle","path"]);key(d.styleKey);if(!Number.isSafeInteger(d.layer))throw new DvError("TYPE_INVALID","Typography layer must be integer");validateTextFormat(d.format);validateTextFlow({format:d.format,layout:d.layout,paragraphs:[{paragraphKey:"check",runs:[{kind:"run",runKey:"check/run",text:"x"}]}],sequences:[]});
 validateStyle(d.outerStyle);
 if(!Array.isArray(d.outerStyle))throw new DvError("TYPE_INVALID","Typography outer style must be an array");const p=object(d.path);exact(p,["side","orientation","startMarginPx","endMarginPx","reverse","align","overflow"]);if(!["left","right"].includes(String(p.side))||!["follow","upright"].includes(String(p.orientation))||!["start","center","end"].includes(String(p.align))||!["visible","clip"].includes(String(p.overflow))||typeof p.reverse!=="boolean")throw new DvError("TYPE_INVALID","Invalid text path style");finite(p.startMarginPx,"path start margin",0);finite(p.endMarginPx,"path end margin",0);
}
export function validateTypographyMotion(value:unknown):asserts value is TypographyMotion {
 const d=object(value);exact(d,["motionKey","itemKeys","pathKeys","sequences"]);key(d.motionKey);for(const n of ["itemKeys","pathKeys","sequences"])if(!Array.isArray(d[n]))throw new DvError("TYPE_INVALID","Motion needs key arrays");
 validateTextSequences(d.sequences);
 for(const n of ["itemKeys","pathKeys"]){const keys=d[n] as unknown[];if(keys.length===1)throw new DvError("TYPE_INVALID","Animation requires at least two keyframes");let previous=-1;for(const value of keys){const k=object(value);exact(k,n==="itemKeys"?["offsetFrames","easing","declarations"]:["offsetFrames","easing","marginPx"]);if(!Number.isSafeInteger(k.offsetFrames)||Number(k.offsetFrames)<0||Number(k.offsetFrames)<=previous||!["linear","ease-in","ease-out","ease-in-out"].includes(String(k.easing)))throw new DvError("TYPE_INVALID","Motion frames must increase with a valid easing");previous=Number(k.offsetFrames);if(n==="pathKeys")finite(k.marginPx,"path margin",0);else{if(!Array.isArray(k.declarations)||!k.declarations.length)throw new DvError("TYPE_INVALID","Animation frame needs declarations");const seen=new Set<string>();for(const dec of k.declarations){const v=object(dec);exact(v,["property","value"]);if(!["opacity","transform","filter","backdrop-filter","clip-path","color"].includes(String(v.property))||seen.has(String(v.property))||typeof v.value!=="string"||/[;{}\x00-\x1f]|!important|\b(?:url|var|env|attr)\s*\(/i.test(v.value))throw new DvError("TYPE_INVALID","Invalid animated property");seen.add(String(v.property));if(v.property==="color"&&!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(v.value))throw new DvError("TYPE_INVALID","Invalid animated color");}}}}
}
export function validateTypographyProgram(value:unknown):asserts value is TypographyProgram {
 const d=object(value);exact(d,["trackKey","timeline","items"]);key(d.trackKey);validateTimeline(d.timeline);
 if(!Array.isArray(d.items)||!d.items.length)throw new DvError("TYPE_INVALID","Typography requires items");
 const identities=new Set<string>();
 for(const value of d.items){
  const item=object(value);exact(item,["itemKey","window","placement","style","motion","content"]);key(item.itemKey);
  if(identities.has(item.itemKey))throw new DvError("TYPE_INVALID","Duplicate typography item");identities.add(item.itemKey);
  validateWindow(item.window);
  if(item.window.axisKey!==d.timeline.axisKey||item.window.consumerKey!==item.itemKey||item.window.frames.end>d.timeline.totalFrames)throw new DvError("TYPE_INVALID","Typography window domain mismatch");
  validateTypographyStyle(item.style);validateTextFlow(item.content);
  if(item.motion!==undefined)validateTypographyMotion(item.motion);
  const p=object(item.placement);
  if(p.kind==="point"){exact(p,["kind","point"]);validatePoint(p.point);}
  else if(p.kind==="area"){exact(p,["kind","frame"]);validateFrame(p.frame);}
  else if(p.kind==="path"){exact(p,["kind","path"]);validatePath(p.path);validatePathParagraphs(item.content.paragraphs);}
  else throw new DvError("TYPE_INVALID","Invalid typography placement");
  if(item.motion!==undefined&&item.motion.pathKeys.length&&p.kind!=="path")throw new DvError("TYPO_MOTION","Path keyframes require Path text");
 }
}
export function validateTypographyAuthorPlan(value:unknown):asserts value is TypographyAuthorPlan {
 const d=object(value); exact(d,["trackKey","items"]); key(d.trackKey);
 if(!Array.isArray(d.items)||!d.items.length) throw new DvError("TYPE_INVALID","Typography author plan requires items");
 const identities=new Set<string>();
 const index=(value:unknown):void=>{if(!Number.isSafeInteger(value)||Number(value)<0)throw new DvError("TYPE_INVALID","Author indexes must be nonnegative integers");};
 const identity=(value:unknown):void=>{key(value);if(identities.has(value))throw new DvError("TYPE_INVALID","Duplicate typography author identity");identities.add(value);};
 for(const value of d.items) {
  const i=object(value); exact(i,["itemKey","windowIndex","styleIndex","motionIndex","placement","content"]); identity(i.itemKey); index(i.windowIndex); index(i.styleIndex); if(i.motionIndex!==undefined)index(i.motionIndex);
  const p=object(i.placement); exact(p,["kind","index"]); index(p.index);
  if(!["point","area","path"].includes(String(p.kind)))throw new DvError("TYPE_INVALID","Invalid placement kind");
  const c=object(i.content);
  if(c.kind==="text"){exact(c,["kind","textIndex"]);index(c.textIndex);continue;}
  if(c.kind!=="paragraphs")throw new DvError("TYPE_INVALID","Invalid author content");
  exact(c,["kind","paragraphs"]); if(!Array.isArray(c.paragraphs)||!c.paragraphs.length)throw new DvError("TYPE_INVALID","Paragraph plan cannot be empty");
  for(const value of c.paragraphs) {
   const paragraph=object(value); exact(paragraph,["paragraphKey","styleIndex","runs"]);identity(paragraph.paragraphKey);if(paragraph.styleIndex!==undefined)index(paragraph.styleIndex);
   if(!Array.isArray(paragraph.runs)||!paragraph.runs.length)throw new DvError("TYPE_INVALID","Paragraph runs cannot be empty");
   let text=false;
   for(const value of paragraph.runs) {
    const run=object(value);
    if(run.kind==="break"){exact(run,["kind"]);continue;}
    exact(run,["kind","runKey","text","styleIndex","language","direction"]);if(run.kind!=="run")throw new DvError("TYPE_INVALID","Invalid author run");
    identity(run.runKey);if(typeof run.text!=="string"||!run.text.length)throw new DvError("TYPE_INVALID","Run text cannot be empty");text ||= !!run.text.trim();
    if(run.styleIndex!==undefined)index(run.styleIndex);if(run.language!==undefined)key(run.language);
    if(run.direction!==undefined&&!["auto","ltr","rtl"].includes(String(run.direction)))throw new DvError("TYPE_INVALID","Invalid run direction");
   }
   if(!text)throw new DvError("TYPE_INVALID","Paragraph requires nonblank text");
  }
 }
 const plan=value as TypographyAuthorPlan;
 for(const item of plan.items)if(item.placement.kind==="path"&&item.content.kind==="paragraphs")validatePathParagraphs(item.content.paragraphs);
}
