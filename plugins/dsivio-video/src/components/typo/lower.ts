import { DvError } from "../../core/errors.ts";
import type { VisualTrack, VisualNode, Keyframe, Surface, StyleDeclaration, TextFlow } from "../../render/ir.ts";
import type { TypographyProgram } from "../types.ts";
import { fitContent } from "../../space/math.ts";
import { validateTypographyProgram } from "./validate.ts";
export function lowerTypography(program:TypographyProgram):VisualTrack {
 validateTypographyProgram(program);
 const presents=program.items.map(item=>{
  const keys=item.motion?.itemKeys??[];
  const properties=new Set(keys.flatMap(k=>k.declarations.filter(d=>d.property!=="color").map(d=>d.property)));
  const state:Record<string,string>={opacity:"1",transform:"translate(0px,0px) scale(1) rotate(0deg) skew(0deg,0deg)",filter:"none","backdrop-filter":"none","clip-path":"inset(0px)"};
  const keyframes:Keyframe[]=properties.size?keys.map(k=>{for(const d of k.declarations)if(d.property!=="color")state[d.property]=d.value;return{offsetFrames:k.offsetFrames,easing:k.easing,declarations:Array.from(properties,property=>({property:property as Keyframe["declarations"][number]["property"],value:state[property]!}))};}):[];
  let flow=item.content;
  if(keys.some(k=>k.declarations.some(d=>d.property==="color"))){
   const duration=keys.at(-1)!.offsetFrames;
   const initial=flow.format.paints.find(p=>p.kind==="fill"&&p.ink.kind==="solid");
   let color=initial&&initial.ink.kind==="solid"?initial.ink.color:keys.flatMap(k=>k.declarations).find(d=>d.property==="color")!.value;
    const poses:TextFlow["sequences"][number]["poses"]=[];
    if(keys[0]!.offsetFrames>0)poses.push({progress:0,easing:"linear",declarations:[{property:"color",value:color}]});
    for(const k of keys){color=k.declarations.find(d=>d.property==="color")?.value??color;poses.push({progress:k.offsetFrames/duration,easing:k.easing,declarations:[{property:"color",value:color}]});}
    flow={...flow,sequences:[{sequenceKey:item.itemKey+"/color",unit:"paragraph",units:{start:0,end:flow.paragraphs.length},startFrame:0,durationFrames:duration,staggerFrames:0,cycles:1,order:"forward",poses},...flow.sequences]};
  }
  const base={nodeKey:item.itemKey+"/text",parentKey:null,order:0,style:[] as StyleDeclaration[],keyframes,attributes:[]};
  let node:VisualNode;
  if(item.placement.kind==="path"){
   const path=item.placement.path,origin=path.start;
   const local=(p:{xPx:number;yPx:number})=>({xPx:p.xPx-origin.xPx,yPx:p.yPx-origin.yPx});
   node={...base,kind:"path-text",flow,path:{start:{xPx:0,yPx:0},segments:path.segments.map(s=>s.kind==="line"?{kind:"line",to:local(s.to)}:s.kind==="quadratic"?{kind:"quadratic",to:local(s.to),control:local(s.control)}:{kind:"cubic",to:local(s.to),control1:local(s.control1),control2:local(s.control2)})},...item.style.path,marginKeys:item.motion?.pathKeys??[]};
   base.style.push({property:"left",value:`${origin.xPx}px`},{property:"top",value:`${origin.yPx}px`},{property:"overflow",value:"visible"});
  }else if(item.placement.kind==="area"){
   const r=item.placement.frame.rect;node={...base,kind:"text-flow",flow};
   base.style.push({property:"left",value:`${r.xPx}px`},{property:"top",value:`${r.yPx}px`},{property:"width",value:`${r.widthPx}px`},{property:"height",value:`${r.heightPx}px`});
  }else{
   const point=item.placement.point,rootKey=item.itemKey+"/placement";
   node={...base,parentKey:rootKey,order:1,keyframes:[],kind:"text-flow",flow:{...flow,layout:{...flow.layout,pointAnchor:{inline:"start",block:"start"}}},style:[{property:"position",value:"relative"},{property:"width",value:"max-content"},{property:"height",value:"max-content"},{property:"transform",value:`translate(${-point.anchor.x*100}%,${-point.anchor.y*100}%)`}]};
   const root:VisualNode={nodeKey:rootKey,parentKey:null,order:0,kind:"box",keyframes,attributes:[],style:[{property:"position",value:"absolute"},{property:"left",value:`${point.xPx}px`},{property:"top",value:`${point.yPx}px`},...item.style.outerStyle]};
   return{presentKey:item.itemKey,axisKey:program.timeline.axisKey,lifetime:item.window.frames,layer:item.style.layer,layerKey:item.itemKey,rootKey,nodes:[root,node]};
  }
  base.style.push({property:"position",value:"absolute"},...item.style.outerStyle);
  return{presentKey:item.itemKey,axisKey:program.timeline.axisKey,lifetime:item.window.frames,layer:item.style.layer,layerKey:item.itemKey,rootKey:node.nodeKey,nodes:[node]};
 });
 return{kind:"visual",trackKey:program.trackKey,axisKey:program.timeline.axisKey,presents};
}
export function lowerTypographyMask(program:TypographyProgram,material:Surface,trackKey:string,mode:"alpha"|"luminance"="alpha",fit:"contain"|"cover"|"fill"="cover"):VisualTrack {
 if(material.timing.kind!=="still")throw new DvError("TYPO_MASK","Typography Mask only accepts a still Surface");
 for(const item of program.items){const f=item.content;const l=f.layout;if(item.placement.kind!=="area"||f.paragraphs.length!==1||f.paragraphs[0]!.format||f.paragraphs[0]!.runs.length!==1||f.paragraphs[0]!.runs[0]!.kind!=="run"||f.paragraphs[0]!.runs[0]!.format||f.sequences.length||l.inlineSize!=="fixed"||l.blockSize!=="fixed"||l.wrap!=="none"||l.columns!==1||f.format.writingMode!=="horizontal-tb"||f.format.decorations.length||["ellipsis","shrink"].includes(l.overflow)||f.format.synthesis!=="none")throw new DvError("TYPO_MASK","Typography Mask requires plain single-paragraph fixed Area text without rich runs or sequences");}
 const track=lowerTypography(program);track.trackKey=trackKey;
 for(let index=0;index<track.presents.length;index++){const present=track.presents[index]!;const item=program.items[index]!;if(item.placement.kind!=="area")throw new DvError("TYPO_MASK","Mask placement must be an Area");const text=present.nodes[0]!;if(text.kind!=="text-flow")throw new DvError("TYPO_MASK","Mask source must be text flow");const frame=item.placement.frame.rect;const content=fitContent({xPx:0,yPx:0,widthPx:frame.widthPx,heightPx:frame.heightPx},material.extent,{mode:fit==="fill"?"stretch":fit});const rootKey=item.itemKey+"/mask";const materialKey=item.itemKey+"/material";
 const root:VisualNode={nodeKey:rootKey,parentKey:null,order:0,kind:"mask",mode,maskRootKey:text.nodeKey,contentRootKey:materialKey,style:[{property:"position",value:"absolute"},{property:"left",value:`${frame.xPx}px`},{property:"top",value:`${frame.yPx}px`},{property:"width",value:`${frame.widthPx}px`},{property:"height",value:`${frame.heightPx}px`}],keyframes:text.keyframes,attributes:[]};text.parentKey=rootKey;text.order=1;text.keyframes=[];text.style=[{property:"position",value:"absolute"},{property:"left",value:"0px"},{property:"top",value:"0px"},{property:"width",value:"100%"},{property:"height",value:"100%"}];text.flow={...text.flow,format:{...text.flow.format,paints:[{kind:"fill",ink:{kind:"solid",color:"#FFFFFF"}}]},sequences:[]};const surface:VisualNode={nodeKey:materialKey,parentKey:rootKey,order:2,kind:"surface",surface:material,style:[{property:"position",value:"absolute"},{property:"left",value:`${content.xPx}px`},{property:"top",value:`${content.yPx}px`},{property:"width",value:`${content.widthPx}px`},{property:"height",value:`${content.heightPx}px`}],keyframes:[],attributes:[]};present.rootKey=rootKey;present.nodes=[root,text,surface];}
 return track;
}
