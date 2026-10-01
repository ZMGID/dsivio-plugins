import { DvError } from "../core/errors.ts";
import { fontFamilyName } from "../fonts/catalog.ts";
import { validateFontStack } from "../fonts/validate.ts";
import { object, finite, exact, key } from "../space/validate.ts";
import type { Paint, TextFormat, TextFlow } from "./ir.ts";
export { fontFamilyName };
function choice(value:unknown, choices:string[]):void { if(typeof value!=="string"||!choices.includes(value))throw new DvError("TYPE_INVALID",`Expected ${choices.join("|")}`); }
function array(value:unknown):unknown[] {if(!Array.isArray(value))throw new DvError("TYPE_INVALID","Expected an array");return value;}
function tuple(value:unknown):void {const a=array(value);if(a.length!==4)throw new DvError("TYPE_INVALID","Expected four sides");a.forEach(v=>finite(v,"side",0));}
function color(value:unknown):void {if(typeof value!=="string"||!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value))throw new DvError("TYPE_INVALID","Color must be six or eight hexadecimal digits");}
function ink(value:unknown):void {
 const d=object(value);choice(d.kind,["solid","linear","radial"]);if(d.kind==="solid"){exact(d,["kind","color"]);color(d.color);return;}
 exact(d,d.kind==="linear"?["kind","angleDegrees","stops"]:["kind","centerX","centerY","stops"]);
 if(d.kind==="linear")finite(d.angleDegrees,"angle");else for(const n of ["centerX","centerY"])if(finite(d[n],n,0)>1)throw new DvError("TYPE_INVALID","Gradient center exceeds one");
 let previous=-1;const stops=array(d.stops);if(stops.length<2)throw new DvError("TYPE_INVALID","Gradient requires two stops");for(const s of stops){const stop=object(s);exact(stop,["offset","color","opacity"]);const offset=finite(stop.offset,"offset",0);if(offset>1||offset<previous||finite(stop.opacity,"opacity",0)>1)throw new DvError("TYPE_INVALID","Invalid gradient stop");color(stop.color);previous=offset;}
}
export function validatePaint(value:unknown):asserts value is Paint {
 const d=object(value);choice(d.kind,["fill","stroke","shadow","glow","box"]);ink(d.ink);
 if(d.kind==="fill")exact(d,["kind","ink"]);
 if(d.kind==="stroke"){exact(d,["kind","ink","widthPx","placement"]);finite(d.widthPx,"stroke width",0);choice(d.placement,["inside","center","outside"]);}
 if(d.kind==="shadow"||d.kind==="glow"){exact(d,d.kind==="shadow"?["kind","ink","xPx","yPx","blurPx","spreadPx"]:["kind","ink","blurPx","spreadPx"]);finite(d.blurPx,"blur",0);finite(d.spreadPx,"spread",d.kind==="glow"?0:-Infinity);if(d.kind==="shadow"){finite(d.xPx,"shadow x");finite(d.yPx,"shadow y");}}
 if(d.kind==="box"){exact(d,["kind","ink","target","continuity","paddingPx","radiusPx","border","shadows","tail"]);choice(d.target,["frame","content","paragraph","line","run","word","grapheme"]);choice(d.continuity,["isolated","joined"]);if(d.continuity==="joined"&&!["line","word","grapheme"].includes(String(d.target)))throw new DvError("TYPE_INVALID","Joined boxes require line, word or grapheme targets");tuple(d.paddingPx);tuple(d.radiusPx);if(d.border){const b=object(d.border);exact(b,["ink","widthPx","style"]);ink(b.ink);tuple(b.widthPx);choice(b.style,["solid","dashed","dotted"]);if(!(b.widthPx as number[]).some(n=>n>0))throw new DvError("TYPE_INVALID","Border requires positive width");}for(const s of array(d.shadows)){const v=object(s);exact(v,["color","xPx","yPx","blurPx","spreadPx"]);color(v.color);finite(v.xPx,"shadow x");finite(v.yPx,"shadow y");finite(v.blurPx,"shadow blur",0);finite(v.spreadPx,"shadow spread");}if(d.tail){const t=object(d.tail);exact(t,["side","offsetPx","widthPx","heightPx","color"]);choice(t.side,["top","right","bottom","left"]);finite(t.offsetPx,"tail offset");finite(t.widthPx,"tail width",0);finite(t.heightPx,"tail height",0);color(t.color);}}
}
export function validateTextFormat(value:unknown):asserts value is TextFormat {
 const d=object(value);exact(d,["fonts","sizePx","lineHeight","trackingPx","wordSpacingPx","axes","features","language","direction","writingMode","kerning","synthesis","baselineShiftPx","verticalAlign","tabSize","indentPx","paragraphBeforePx","paragraphAfterPx","transform","caps","cjkSpacing","punctuationTrim","paints","decorations"]);validateFontStack(d.fonts);
 if(finite(d.sizePx,"font size",0)===0||finite(d.lineHeight,"line height",0)===0)throw new DvError("TYPE_INVALID","Font size and line height must be positive");
 for(const n of ["trackingPx","wordSpacingPx","baselineShiftPx","indentPx","paragraphBeforePx","paragraphAfterPx"])finite(d[n],n);
 if(!Number.isSafeInteger(d.tabSize)||Number(d.tabSize)<=0)throw new DvError("TYPE_INVALID","tabSize must be a positive integer");if(d.language!==undefined)key(d.language);
 for(const [n,values] of Object.entries({direction:["auto","ltr","rtl"],writingMode:["horizontal-tb","vertical-rl","vertical-lr"],kerning:["auto","normal","none"],verticalAlign:["baseline","super","sub"],transform:["none","uppercase","lowercase","capitalize"],caps:["normal","small-caps","all-small-caps"],cjkSpacing:["normal","none"],punctuationTrim:["none","start","end","adjacent","all"]}))choice(d[n],values);
 if(d.synthesis!=="none")throw new DvError("FONT_UNSUPPORTED","Exact static font faces do not allow synthesis");
 validateTextOpenType(d.axes,d.features);
 const paints=array(d.paints);paints.forEach(validatePaint);
 const visible=(paint:unknown):boolean=>{const p=object(paint);if(p.kind!=="fill"&&(p.kind!=="stroke"||Number(p.widthPx)===0))return false;const i=object(p.ink);if(i.kind==="solid")return String(i.color).length!==9||!String(i.color).endsWith("00");return array(i.stops).some(value=>{const stop=object(value);return Number(stop.opacity)>0&&(String(stop.color).length!==9||!String(stop.color).endsWith("00"));});};
 if(!paints.some(visible))throw new DvError("TYPE_INVALID","Text needs a visible fill or stroke");
 validateTextDecorations(d.decorations);
}
export function validateTextOpenType(axes:unknown,features:unknown):void {
 const d:Record<string,unknown>={axes,features};
 for(const n of ["axes","features"]){const tags=new Set<string>();for(const v of array(d[n])){const item=object(v);exact(item,n==="axes"?["tag","value"]:["tag","enabled"]);if(typeof item.tag!=="string"||!/[\x20-\x7e]{4}/.test(item.tag)||item.tag.length!==4||tags.has(item.tag))throw new DvError("TYPE_INVALID","OpenType tags must be four printable unique bytes");tags.add(item.tag);if(n==="axes")finite(item.value,"axis");else if(typeof item.enabled!=="boolean")throw new DvError("TYPE_INVALID","Feature enabled must be boolean");}}
 if(array(d.axes).length)throw new DvError("FONT_UNSUPPORTED","Pinned static faces do not expose variable axes");
}
export function validateTextDecorations(value:unknown):void {
 const d={decorations:value};
 const lines=new Set<string>();for(const v of array(d.decorations)){const dec=object(v);exact(dec,["line","ink","style","thicknessPx","offsetPx","skipInk"]);choice(dec.line,["underline","overline","line-through"]);if(lines.has(String(dec.line)))throw new DvError("TYPE_INVALID","Duplicate text decoration");lines.add(String(dec.line));ink(dec.ink);choice(dec.style,["solid","double","dotted","dashed","wavy"]);if(dec.thicknessPx!==undefined)finite(dec.thicknessPx,"decoration thickness",0);if(dec.offsetPx!==undefined)finite(dec.offsetPx,"decoration offset");if(typeof dec.skipInk!=="boolean")throw new DvError("TYPE_INVALID","skipInk must be boolean");}
}
export function validateTextFlow(value:unknown):asserts value is TextFlow {
 const d=object(value);exact(d,["paragraphs","format","layout","sequences"]);validateTextFormat(d.format);const layout=object(d.layout);exact(layout,["mode","inlineSize","blockSize","align","blockAlign","paddingPx","wrap","overflow","columns","columnGapPx","maxLines","minimumScale","metricEdge","pointAnchor","clip"]);
 for(const [name,values] of Object.entries({mode:["point","area"],inlineSize:["hug","fixed"],blockSize:["hug","fixed"],align:["start","center","end","justify"],blockAlign:["start","center","end"],wrap:["none","word","grapheme"],overflow:["visible","clip","ellipsis","shrink"],metricEdge:["line-box","cap-height","ink"]}))choice(layout[name],values);tuple(layout.paddingPx);const anchor=object(layout.pointAnchor);exact(anchor,["inline","block"]);choice(anchor.inline,["start","center","end"]);choice(anchor.block,["start","center","end"]);if(typeof layout.clip!=="boolean"||!Number.isSafeInteger(layout.columns)||Number(layout.columns)<1)throw new DvError("TYPE_INVALID","Invalid text layout");finite(layout.columnGapPx,"column gap",0);if(layout.maxLines!==undefined&&(!Number.isSafeInteger(layout.maxLines)||Number(layout.maxLines)<1||!["ellipsis","shrink"].includes(String(layout.overflow))))throw new DvError("TYPE_INVALID","maxLines requires ellipsis or shrink");if(layout.overflow==="shrink"&&(finite(layout.minimumScale,"minimum scale",0)<=0||Number(layout.minimumScale)>1))throw new DvError("TYPE_INVALID","Shrink requires minimumScale in (0,1]");if(layout.minimumScale!==undefined&&layout.overflow!=="shrink")throw new DvError("TYPE_INVALID","minimumScale is only valid for shrink");
 const keys=new Set<string>();const paragraphs=array(d.paragraphs);if(!paragraphs.length)throw new DvError("TYPE_INVALID","Text flow needs paragraphs");for(const v of paragraphs){const p=object(v);exact(p,["paragraphKey","format","runs"]);key(p.paragraphKey);if(keys.has(p.paragraphKey))throw new DvError("TYPE_INVALID","Duplicate paragraph key");keys.add(p.paragraphKey);if(p.format!==undefined)validateTextFormat(p.format);const runs=array(p.runs);if(!runs.length||!runs.some(r=>object(r).kind==="run"&&String(object(r).text).trim()))throw new DvError("TYPE_INVALID","Paragraph must contain text");for(const r of runs){const run=object(r);choice(run.kind,["break","run"]);if(run.kind==="break"){exact(run,["kind"]);continue;}exact(run,["kind","runKey","text","format"]);key(run.runKey);if(keys.has(run.runKey)||typeof run.text!=="string"||!run.text.length)throw new DvError("TYPE_INVALID","Invalid text run identity or content");keys.add(run.runKey);if(run.format!==undefined)validateTextFormat(run.format);}}
 validateTextSequences(d.sequences);
}
export function validatePathTextFlow(value:unknown):asserts value is TextFlow {
 validateTextFlow(value);
 validatePathParagraphs(value.paragraphs);
}
export function validatePathParagraphs(paragraphs:TextFlow["paragraphs"]):void {
 if(paragraphs.length!==1||paragraphs[0]!.runs.some(r=>r.kind==="break"||/[\r\n]/.test(r.text)))throw new DvError("TYPO_PATH_SINGLE_PARAGRAPH","Path text requires one paragraph without line breaks");
}
export function validateTextSequences(value:unknown):void {
 const d={sequences:value};
 const sequences=new Set<string>();for(const v of array(d.sequences)){const s=object(v);exact(s,["sequenceKey","unit","units","startFrame","durationFrames","staggerFrames","cycles","order","seed","poses"]);key(s.sequenceKey);if(sequences.has(s.sequenceKey))throw new DvError("TYPE_INVALID","Duplicate sequence key");sequences.add(s.sequenceKey);choice(s.unit,["paragraph","line","run","word","grapheme"]);choice(s.order,["forward","reverse","random"]);const b=object(s.units);exact(b,["start","end"]);for(const n of ["startFrame","staggerFrames"])if(!Number.isSafeInteger(s[n])||Number(s[n])<0)throw new DvError("TYPE_INVALID","Sequence offsets must be nonnegative integers");for(const n of ["durationFrames","cycles"])if(!Number.isSafeInteger(s[n])||Number(s[n])<1)throw new DvError("TYPE_INVALID","Sequence duration and cycles must be positive integers");if(!Number.isSafeInteger(b.start)||!Number.isSafeInteger(b.end)||Number(b.start)<0||Number(b.end)<=Number(b.start))throw new DvError("TYPE_INVALID","Sequence unit bounds must be positive");if(s.order==="random"&&!Number.isSafeInteger(s.seed))throw new DvError("TYPE_INVALID","Random sequences require an integer seed");let previous=-1;const poses=array(s.poses);if(poses.length<2)throw new DvError("TYPE_INVALID","Sequence needs two poses");for(const p of poses){const pose=object(p);exact(pose,["progress","easing","declarations"]);const progress=finite(pose.progress,"progress",0);if(progress>1||progress<=previous)throw new DvError("TYPE_INVALID","Pose progress must increase in [0,1]");previous=progress;choice(pose.easing,["linear","ease-in","ease-out","ease-in-out"]);const declarations=array(pose.declarations);if(!declarations.length)throw new DvError("TYPE_INVALID","Pose needs declarations");const properties=new Set<string>();for(const v of declarations){const dec=object(v);exact(dec,["property","value"]);choice(dec.property,["opacity","transform","filter","backdrop-filter","clip-path","color"]);if(properties.has(String(dec.property))||typeof dec.value!=="string"||/[;{}\x00-\x1f]|!important|\b(?:url|var|env|attr)\s*\(/i.test(dec.value))throw new DvError("TYPE_INVALID","Unsafe or duplicate animation declaration");properties.add(String(dec.property));}}}
}

/** The browser owns shaping and measurement; all animation state derives from the requested frame. */
export function textRuntimeSource(): string {
 return String.raw`(() => {
const family = key => 'dv-font-' + Array.from(new TextEncoder().encode(key), b=>b.toString(16).padStart(2,'0')).join('');
const px = n => n+'px';
const rgba = (c,opacity=1) => {const n=parseInt(c.slice(1,7),16);return 'rgba('+[(n>>16)&255,(n>>8)&255,n&255,opacity*(c.length===9?parseInt(c.slice(7),16)/255:1)].join(',')+')';};
const ink = i => i.kind==='solid'?i.color:i.kind==='linear'?'linear-gradient('+i.angleDegrees+'deg,'+i.stops.map(s=>rgba(s.color,s.opacity)+' '+s.offset*100+'%').join(',')+')':'radial-gradient(at '+i.centerX*100+'% '+i.centerY*100+'%,'+i.stops.map(s=>rgba(s.color,s.opacity)+' '+s.offset*100+'%').join(',')+')';
function format(el,f) {
 const primary=f.fonts.faces[0];
 Object.assign(el.style,{fontFamily:f.fonts.faces.map(x=>'"'+family(x.faceKey)+'"').join(','),fontSize:px(f.sizePx),fontWeight:String(primary.weight),fontStyle:primary.style,lineHeight:String(f.lineHeight),letterSpacing:px(f.trackingPx),wordSpacing:px(f.wordSpacingPx),fontKerning:f.kerning,fontSynthesis:f.synthesis.replace('weight-style','weight style'),fontFeatureSettings:f.features.map(x=>'"'+x.tag+'" '+(x.enabled?1:0)).join(',')||'normal',fontVariationSettings:f.axes.map(x=>'"'+x.tag+'" '+x.value).join(',')||'normal',writingMode:f.writingMode,verticalAlign:f.verticalAlign,position:'relative',top:px(-f.baselineShiftPx),tabSize:String(f.tabSize),textTransform:f.transform,fontVariantCaps:f.caps,textIndent:px(f.indentPx),marginTop:px(f.paragraphBeforePx),marginBottom:px(f.paragraphAfterPx),textSpacingTrim:f.punctuationTrim,textAutospace:f.cjkSpacing==='none'?'no-autospace':'normal'});
 el.dir=f.direction;if(f.language)el.lang=f.language;
 const fill=f.paints.filter(p=>p.kind==='fill').at(-1);el.style.color=fill?ink(fill.ink):'transparent';
 if(fill&&fill.ink.kind!=='solid'){el.style.background=ink(fill.ink);el.style.backgroundClip='text';el.style.webkitBackgroundClip='text';el.style.color='transparent';}
 const stroke=f.paints.filter(p=>p.kind==='stroke').at(-1);if(stroke)el.style.webkitTextStroke=px(stroke.widthPx*(stroke.placement==='center'?1:2))+' '+ink(stroke.ink);
 const shadows=f.paints.filter(p=>p.kind==='shadow'||p.kind==='glow');el.style.textShadow=shadows.map(p=>px(p.xPx||0)+' '+px(p.yPx||0)+' '+px(p.blurPx)+' '+ink(p.ink)).join(',');
}
const NS='http://www.w3.org/2000/svg';
function svgInk(svg,value,id) {
 if(value.kind==='solid')return value.color;
 let defs=svg.querySelector('defs');if(!defs){defs=document.createElementNS(NS,'defs');svg.prepend(defs);}
 const gradient=document.createElementNS(NS,value.kind==='linear'?'linearGradient':'radialGradient');gradient.id=id;
 if(value.kind==='linear'){const angle=value.angleDegrees*Math.PI/180;gradient.setAttribute('x1',String(.5-Math.sin(angle)/2));gradient.setAttribute('y1',String(.5+Math.cos(angle)/2));gradient.setAttribute('x2',String(.5+Math.sin(angle)/2));gradient.setAttribute('y2',String(.5-Math.cos(angle)/2));}else{gradient.setAttribute('cx',String(value.centerX));gradient.setAttribute('cy',String(value.centerY));}
 for(const stop of value.stops){const el=document.createElementNS(NS,'stop');el.setAttribute('offset',String(stop.offset));el.setAttribute('stop-color',stop.color);el.setAttribute('stop-opacity',String(stop.opacity));gradient.append(el);}defs.append(gradient);return 'url(#'+id+')';
}
function svgGlyph(svg,prototype,f,id) {
 const group=document.createElementNS(NS,'g');svg.append(group);
 for(let index=0;index<f.paints.length;index++){const paint=f.paints[index];if(paint.kind==='box')continue;const text=prototype.cloneNode(true);Object.assign(text.style,{background:'none',color:'',webkitTextStroke:'',textShadow:'none'});text.removeAttribute('transform');const fill=svgInk(svg,paint.ink,id+'_'+index);text.setAttribute('fill',paint.kind==='stroke'?'none':fill);text.setAttribute('stroke',paint.kind==='stroke'?fill:'none');text.dataset.dvFill=paint.kind==='fill'?'true':'false';
  if(paint.kind==='stroke'){text.setAttribute('stroke-width',String(paint.widthPx*(paint.placement==='center'?1:2)));if(paint.placement==='inside'){const clip=document.createElementNS(NS,'clipPath');clip.id=id+'_clip_'+index;clip.append(prototype.cloneNode(true));svg.querySelector('defs')?.append(clip)||svg.prepend(clip);text.setAttribute('clip-path','url(#'+clip.id+')');}else if(paint.placement==='outside'){const mask=document.createElementNS(NS,'mask');mask.id=id+'_outside_'+index;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x','-100000');mask.setAttribute('y','-100000');mask.setAttribute('width','200000');mask.setAttribute('height','200000');const background=document.createElementNS(NS,'rect');for(const [name,value]of Object.entries({x:'-100000',y:'-100000',width:'200000',height:'200000',fill:'white'}))background.setAttribute(name,value);mask.append(background);const cutout=prototype.cloneNode(true);cutout.setAttribute('fill','black');cutout.setAttribute('stroke','none');cutout.style.webkitTextStroke='';cutout.style.color='black';mask.append(cutout);svg.prepend(mask);text.setAttribute('mask','url(#'+mask.id+')');}}
  if(paint.kind==='shadow'||paint.kind==='glow'){const filter=document.createElementNS(NS,'filter');filter.id=id+'_filter_'+index;filter.setAttribute('x','-100%');filter.setAttribute('y','-100%');filter.setAttribute('width','300%');filter.setAttribute('height','300%');if(paint.spreadPx){const morph=document.createElementNS(NS,'feMorphology');morph.setAttribute('operator',paint.spreadPx>0?'dilate':'erode');morph.setAttribute('radius',String(Math.abs(paint.spreadPx)));filter.append(morph);}const blur=document.createElementNS(NS,'feGaussianBlur');blur.setAttribute('stdDeviation',String(paint.blurPx/2));filter.append(blur);if(paint.kind==='shadow'){const offset=document.createElementNS(NS,'feOffset');offset.setAttribute('dx',String(paint.xPx));offset.setAttribute('dy',String(paint.yPx));filter.append(offset);}svg.prepend(filter);text.setAttribute('filter','url(#'+filter.id+')');}
  group.append(text);
 }
 for(let index=0;index<f.decorations.length;index++){
  const decoration=f.decorations[index],box=prototype.getBBox(),baseline=Number(prototype.getAttribute('y')||0),size=parseFloat(prototype.style.fontSize),thickness=decoration.thicknessPx===undefined?size/16:decoration.thicknessPx;
  if(thickness===0)continue;
  const vertical=f.writingMode!=='horizontal-tb',length=vertical?box.height:box.width;
  const position=(decoration.line==='underline'?baseline+size/8:decoration.line==='overline'?box.y:baseline-size/3)+(decoration.offsetPx||0);
  const x=vertical?(decoration.line==='underline'?box.x+box.width:decoration.line==='overline'?box.x:box.x+box.width/2)+(decoration.offsetPx||0):box.x;
  const line=document.createElementNS(NS,'path');line.setAttribute('fill','none');line.setAttribute('stroke',svgInk(svg,decoration.ink,id+'_dec_'+index));line.setAttribute('stroke-width',String(thickness));line.setAttribute('stroke-linecap',decoration.style==='dotted'?'round':'butt');
  const point=(along,across)=>vertical?(x+across)+' '+(box.y+along):(x+along)+' '+(position+across);
  let d='M '+point(0,0);
  if(decoration.style==='wavy'){const step=thickness*4;for(let at=0;at<length;at+=step){const end=Math.min(length,at+step);d+=' Q '+point((at+end)/2,(Math.floor(at/step)%2?1:-1)*thickness*2)+' '+point(end,0);}}
  else {d+=' L '+point(length,0);if(decoration.style==='double')d+=' M '+point(0,thickness*3)+' L '+point(length,thickness*3);}
  line.setAttribute('d',d);if(['dotted','dashed'].includes(decoration.style))line.setAttribute('stroke-dasharray',decoration.style==='dotted'?'0 '+thickness*2:thickness*3+' '+thickness*2);
  if(decoration.skipInk&&decoration.line!=='line-through'){
   const mask=document.createElementNS(NS,'mask');mask.id=id+'_dec_mask_'+index;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x',String(box.x-size));mask.setAttribute('y',String(box.y-size));mask.setAttribute('width',String(box.width+2*size));mask.setAttribute('height',String(box.height+2*size));
   const background=document.createElementNS(NS,'rect');for(const [name,value] of Object.entries({x:box.x-size,y:box.y-size,width:box.width+2*size,height:box.height+2*size,fill:'white'}))background.setAttribute(name,String(value));mask.append(background);
   const cutout=prototype.cloneNode(true);cutout.setAttribute('fill','black');cutout.setAttribute('stroke','black');cutout.setAttribute('stroke-width',String(thickness));cutout.style.color='black';cutout.style.webkitTextStroke='';mask.append(cutout);svg.prepend(mask);line.setAttribute('mask','url(#'+mask.id+')');
  }
  group.append(line);
 }
 prototype.remove();return group;
}
function rectangleUnion(rectangles,radius) {
 const xs=Array.from(new Set(rectangles.flatMap(r=>[r.left,r.right]))).sort((a,b)=>a-b),ys=Array.from(new Set(rectangles.flatMap(r=>[r.top,r.bottom]))).sort((a,b)=>a-b);
 const xi=new Map(xs.map((v,i)=>[v,i])),yi=new Map(ys.map((v,i)=>[v,i]));const cells=new Set();
 for(const r of rectangles)for(let y=yi.get(r.top);y<yi.get(r.bottom);y++)for(let x=xi.get(r.left);x<xi.get(r.right);x++)cells.add(y*xs.length+x);
 const edges=[];const outgoing=new Map();const edge=(x1,y1,x2,y2,side)=>{const e={from:[x1,y1],to:[x2,y2],side,used:false};edges.push(e);const key=x1+','+y1;if(!outgoing.has(key))outgoing.set(key,[]);outgoing.get(key).push(e);};
 for(const cell of cells){const x=cell%xs.length,y=Math.floor(cell/xs.length);if(!cells.has((y-1)*xs.length+x))edge(xs[x],ys[y],xs[x+1],ys[y],0);if(!cells.has(y*xs.length+x+1))edge(xs[x+1],ys[y],xs[x+1],ys[y+1],1);if(!cells.has((y+1)*xs.length+x))edge(xs[x+1],ys[y+1],xs[x],ys[y+1],2);if(!cells.has(y*xs.length+x-1))edge(xs[x],ys[y+1],xs[x],ys[y],3);}
 const polygons=[];
 for(const first of edges){if(first.used)continue;const vertices=[];let e=first;while(e&&!e.used){e.used=true;vertices.push(e.from);e=(outgoing.get(e.to.join(','))||[]).find(next=>!next.used);}if(vertices.length)polygons.push(vertices);}
 let d='';
 for(const vertices of polygons){const rounded=vertices.map((p,i)=>{const previous=vertices[(i+vertices.length-1)%vertices.length],next=vertices[(i+1)%vertices.length];const before=Math.hypot(p[0]-previous[0],p[1]-previous[1]),after=Math.hypot(next[0]-p[0],next[1]-p[1]);const corner=(previous[0]<p[0]||next[0]<p[0])?(previous[1]<p[1]||next[1]<p[1]?2:1):(previous[1]<p[1]||next[1]<p[1]?3:0);const amount=Math.min(radius[corner],before/2,after/2);return{p,incoming:[p[0]+(previous[0]-p[0])*amount/before,p[1]+(previous[1]-p[1])*amount/before],outgoing:[p[0]+(next[0]-p[0])*amount/after,p[1]+(next[1]-p[1])*amount/after]};});d+='M '+rounded[0].incoming.join(' ');for(const corner of rounded)d+=' L '+corner.incoming.join(' ')+' Q '+corner.p.join(' ')+' '+corner.outgoing.join(' ');d+=' Z ';}
 return{d,edges};
}
function ease(t,e) {return e==='ease-in'?t*t:e==='ease-out'?1-(1-t)*(1-t):e==='ease-in-out'?t<.5?2*t*t:1-2*(1-t)*(1-t):t;}
function pose(poses,t) {let a=poses[0],b=poses.at(-1);if(t<=a.progress)return a.declarations;if(t>=b.progress)return b.declarations;for(let i=1;i<poses.length;i++)if(t<=poses[i].progress){a=poses[i-1];b=poses[i];break;}const v=ease((t-a.progress)/(b.progress-a.progress),b.easing);return b.declarations.map(d=>{const prev=a.declarations.find(p=>p.property===d.property)||d;if(d.property==='color'&&/^#[0-9a-f]{6,8}$/i.test(d.value)&&/^#[0-9a-f]{6,8}$/i.test(prev.value)){const ac=prev.value.slice(1).padEnd(8,'f'),bc=d.value.slice(1).padEnd(8,'f');let result='#';for(let k=0;k<8;k+=2)result+=Math.round(parseInt(ac.slice(k,k+2),16)*(1-v)+parseInt(bc.slice(k,k+2),16)*v).toString(16).padStart(2,'0');return{property:d.property,value:result};}const av=prev.value.match(/-?\d+(?:\.\d+)?/g)||[],bv=d.value.match(/-?\d+(?:\.\d+)?/g)||[];let index=0;return{property:d.property,value:av.length===bv.length?d.value.replace(/-?\d+(?:\.\d+)?/g,n=>String(Number(av[index++])*(1-v)+Number(n)*v)):v<1?prev.value:d.value};});}
window.__dvText={rectangleUnion,async mount(root,node,lifetimeFrames,clock) {
 const flow=node.kind==='text'?{format:node.format,layout:{mode:'point',inlineSize:'hug',blockSize:'hug',align:'start',blockAlign:'start',paddingPx:[0,0,0,0],wrap:'none',overflow:'visible',columns:1,columnGapPx:0,metricEdge:'line-box',pointAnchor:{inline:'start',block:'start'},clip:false},paragraphs:[{paragraphKey:node.nodeKey,runs:[{kind:'run',runKey:node.nodeKey+'/run',text:node.text}]}],sequences:[]}:node.flow;
 const formats=[flow.format,...flow.paragraphs.flatMap(p=>[p.format,...p.runs.map(r=>r.format)].filter(Boolean))];
 const sample=flow.paragraphs.flatMap(p=>p.runs.filter(r=>r.kind==='run').map(r=>r.text)).join('')+(flow.layout.overflow==='ellipsis'?'…':'');const loads=[];for(const f of formats)for(const face of f.fonts.faces){const name=family(face.faceKey);if(!Array.from(document.fonts).some(x=>x.family.replace(/^["']|["']$/g,'')===name))throw new Error('FONT_NOT_PREPARED: '+face.faceKey);loads.push(document.fonts.load(face.style+' '+face.weight+' '+f.sizePx+'px "'+name+'"',sample));}await Promise.all(loads);await document.fonts.ready;
 const container=document.createElement('div');root.replaceChildren(container);const l=flow.layout;Object.assign(container.style,{position:'relative',boxSizing:'border-box',width:l.inlineSize==='fixed'?'100%':'max-content',height:l.blockSize==='fixed'?'100%':'max-content',padding:l.paddingPx.map(px).join(' '),textAlign:l.align,whiteSpace:l.wrap==='none'?'pre':'pre-wrap',overflowWrap:l.wrap==='grapheme'?'anywhere':'normal',wordBreak:l.wrap==='grapheme'?'break-all':'normal',overflow:l.clip||l.overflow==='clip'?'hidden':'visible',columnCount:l.columns>1?String(l.columns):'auto',columnGap:px(l.columnGapPx)});format(container,flow.format);
 const units={paragraph:[],run:[],word:[],grapheme:[],line:[]};const needsGraphemes=l.overflow==='ellipsis'||flow.sequences.some(s=>['grapheme','line'].includes(s.unit))||formats.some(f=>f.paints.some(p=>p.kind==='box'&&['grapheme','line'].includes(p.target)));
 for(const p of flow.paragraphs){const paragraph=document.createElement('div');paragraph.dataset.paragraph=p.paragraphKey;const pf=p.format||flow.format;paragraph.__dvFormat=pf;format(paragraph,pf);container.append(paragraph);units.paragraph.push(paragraph);
  for(const r of p.runs){if(r.kind==='break'){paragraph.append(document.createElement('br'));continue;}const run=document.createElement('span');run.dataset.run=r.runKey;run.__dvFormat=r.format||pf;format(run,run.__dvFormat);paragraph.append(run);units.run.push(run);
   const words=Array.from(new Intl.Segmenter((r.format||pf).language,{granularity:'word'}).segment(r.text));
   for(const word of words){const span=document.createElement('span');span.style.display=l.wrap==='word'&&word.isWordLike?'inline-block':'inline';span.__dvFormat=r.format||pf;run.append(span);units.word.push(span);if(needsGraphemes){for(const g of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word.segment)){const glyph=document.createElement('span');glyph.textContent=g.segment;glyph.style.display='inline-block';glyph.__dvFormat=r.format||pf;span.append(glyph);units.grapheme.push(glyph);}}else span.textContent=word.segment;}
  }
 }
 // Derive line groups after the real font metrics have been applied.
 if(needsGraphemes){const groups=new Map();for(const glyph of units.grapheme){const group=glyph.offsetTop;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(glyph);}units.line=Array.from(groups.values());}
 const maxHeight=l.maxLines?l.maxLines*flow.format.sizePx*flow.format.lineHeight:Infinity;
 if(l.overflow==='ellipsis'){
  container.style.overflow='hidden';
  const available=root.clientHeight-l.paddingPx[0]-l.paddingPx[2],lineHeight=flow.format.sizePx*flow.format.lineHeight;
  const limit=Math.max(1,Math.min(l.maxLines||Infinity,Math.floor(available/lineHeight)));
  if(units.line.length>limit){
   const last=units.line[limit-1],ellipsis=last.at(-1),top=ellipsis.offsetTop,cut=units.grapheme.indexOf(ellipsis);
   for(let index=cut+1;index<units.grapheme.length;index++)units.grapheme[index].remove();
   ellipsis.textContent='…';ellipsis.dataset.dvEllipsis='true';
   let preceding=cut-1;
   while(ellipsis.offsetTop>top&&preceding>=0)units.grapheme[preceding--].remove();
  }
 }
 let scale=1;if(l.overflow==='shrink'){const availableW=root.clientWidth-l.paddingPx[1]-l.paddingPx[3],availableH=Math.min(root.clientHeight-l.paddingPx[0]-l.paddingPx[2],maxHeight);const sizes=[container,...units.paragraph,...units.run].map(el=>({el,size:parseFloat(el.style.fontSize)}));const setScale=value=>{for(const entry of sizes)entry.el.style.fontSize=px(entry.size*value);};const fits=()=>container.scrollWidth<=root.clientWidth+.5&&units.paragraph.reduce((height,p)=>height+p.getBoundingClientRect().height,0)<=availableH+.5;let low=l.minimumScale,high=1;if(!fits()){for(let i=0;i<16;i++){const candidate=(low+high)/2;setScale(candidate);if(fits())low=candidate;else high=candidate;}scale=low;setScale(scale);}container.style.overflow='hidden';}
 if(l.mode==='point'){const anchor={start:0,center:50,end:100};container.style.transform='translate(-'+anchor[l.pointAnchor.inline]+'%,-'+anchor[l.pointAnchor.block]+'%)';}else if(l.blockSize==='fixed'&&l.columns===1&&l.blockAlign!=='start'){const contentHeight=units.paragraph.reduce((sum,p)=>sum+p.getBoundingClientRect().height,0);const spare=Math.max(0,root.clientHeight-l.paddingPx[0]-l.paddingPx[2]-contentHeight);container.style.paddingTop=px(l.paddingPx[0]+spare*(l.blockAlign==='center'?.5:1));}
 if(node.kind!=='path-text'){
  const targets=needsGraphemes?units.grapheme:units.word;
  let painterIndex=0;
  for(const source of targets){if(!source.isConnected)continue;const f=source.__dvFormat;const paints=f.paints.filter(p=>p.kind!=='box');if(paints.length===1&&paints[0].kind==='fill'&&paints[0].ink.kind==='solid'&&!f.decorations.length)continue;
   source.style.position='relative';source.style.display='inline-block';
   const svg=document.createElementNS(NS,'svg');svg.setAttribute('aria-hidden','true');Object.assign(svg.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%',overflow:'visible',pointerEvents:'none'});source.append(svg);
   const prototype=document.createElementNS(NS,'text');prototype.textContent=source.childNodes[0].textContent;format(prototype,{...f,sizePx:f.sizePx*scale});svg.append(prototype);
   const metrics=document.createElement('canvas').getContext('2d');metrics.font=getComputedStyle(source).font;const measured=metrics.measureText(prototype.textContent);const baseline=(source.offsetHeight-measured.fontBoundingBoxAscent-measured.fontBoundingBoxDescent)/2+measured.fontBoundingBoxAscent;
   prototype.setAttribute('x','0');prototype.setAttribute('y',String(baseline));svgGlyph(svg,prototype,f,family(node.nodeKey)+'_flow_'+painterIndex++);source.style.color='transparent';source.style.webkitTextStroke='0px transparent';source.style.textShadow='none';
  }
  container.__dvFormat=flow.format;
  for(const el of [container,...units.paragraph,...units.run]){const paints=el.__dvFormat.paints.filter(p=>p.kind!=='box');if(paints.length!==1||paints[0].kind!=='fill'||paints[0].ink.kind!=='solid'||el.__dvFormat.decorations.length)Object.assign(el.style,{background:'none',color:'transparent',webkitTextStroke:'0px transparent',textShadow:'none'});}
 }
 const baseStyles=new Map();const animations=[];
 for(const s of flow.sequences){const selected=(units[s.unit]||[]).slice(s.units.start,s.units.end);if(selected.length!==s.units.end-s.units.start)throw new Error('TEXT_SEQUENCE_RANGE: sequence exceeds laid-out units');let indices=selected.map((_,i)=>i);if(s.order==='reverse')indices.reverse();if(s.order==='random'){let state=s.seed>>>0;for(let i=indices.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=state%(i+1);[indices[i],indices[j]]=[indices[j],indices[i]];}}
  for(let rank=0;rank<indices.length;rank++){const value=selected[indices[rank]];const elements=Array.isArray(value)?value:[value];for(const el of elements){if(!baseStyles.has(el))baseStyles.set(el,el.getAttribute('style')||'');el.style.display='inline-block';}animations.push({sequence:s,rank,elements});}}
 let pathState=null;
 if(node.kind==='path-text'){
  const svg=document.createElementNS(NS,'svg');Object.assign(svg.style,{position:'absolute',inset:'0',overflow:node.overflow,width:'100%',height:'100%'});root.append(svg);
  const path=document.createElementNS(NS,'path');const point=p=>p.xPx+' '+p.yPx;let d='M '+point(node.path.start);
  for(const s of node.path.segments)d+=' '+(s.kind==='line'?'L '+point(s.to):s.kind==='quadratic'?'Q '+point(s.control)+' '+point(s.to):'C '+point(s.control1)+' '+point(s.control2)+' '+point(s.to));
  path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','none');svg.append(path);
  const glyphs=[];let wordIndex=0;
  for(const p of flow.paragraphs)for(const r of p.runs)if(r.kind==='run'){
   const f=r.format||p.format||flow.format;
   for(const word of new Intl.Segmenter(f.language,{granularity:'word'}).segment(r.text)){
    for(const g of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word.segment)){
     const prototype=document.createElementNS(NS,'text');prototype.textContent=g.segment;format(prototype,f);svg.append(prototype);
     const width=prototype.getComputedTextLength();const paint=svgGlyph(svg,prototype,f,family(node.nodeKey)+'_'+glyphs.length);
     const el=document.createElementNS(NS,'g');svg.append(el);el.append(paint);glyphs.push({el,paint,width,wordIndex});
    }
    wordIndex++;
   }
  }
  for(const animation of animations){const selected=glyphs.filter((g,index)=>animation.elements.some(source=>source===units.grapheme[index]||source.contains(units.grapheme[index]||units.word[g.wordIndex])||source===units.word[g.wordIndex]));animation.elements=selected.map(g=>g.paint);for(const el of animation.elements)baseStyles.set(el,el.getAttribute('style')||'');}
  container.style.visibility='hidden';pathState={path,glyphs,total:path.getTotalLength(),width:glyphs.reduce((s,g)=>s+g.width,0)};
 }
 const boxes=[];root.style.isolation='isolate';
 for(const f of new Set(formats))for(const paint of f.paints)if(paint.kind==='box'){
  const candidates=paint.target==='frame'?[root]:paint.target==='content'?[container]:units[paint.target]||[];
  const targets=candidates.filter(target=>Array.isArray(target)?target.some(el=>el.__dvFormat===f):target===root||target===container||target.__dvFormat===f);
  const ranges=[];for(const target of targets){const els=Array.isArray(target)?target:[target];for(const el of els)for(const rect of el.getClientRects())ranges.push({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom});}
  const parent=root.getBoundingClientRect();
  if(paint.continuity==='joined'&&ranges.length){
   const rectangles=ranges.map(r=>({left:r.left-parent.left-paint.paddingPx[3],right:r.right-parent.left+paint.paddingPx[1],top:r.top-parent.top-paint.paddingPx[0],bottom:r.bottom-parent.top+paint.paddingPx[2]}));
   const union=rectangleUnion(rectangles,paint.radiusPx);const svg=document.createElementNS(NS,'svg');Object.assign(svg.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%',overflow:'visible',zIndex:'-1',pointerEvents:'none'});root.prepend(svg);
   for(let index=0;index<paint.shadows.length;index++){const shadow=paint.shadows[index];const shape=document.createElementNS(NS,'path');shape.setAttribute('d',union.d);shape.setAttribute('fill',shadow.color);shape.setAttribute('transform','translate('+shadow.xPx+' '+shadow.yPx+')');const filter=document.createElementNS(NS,'filter');filter.id=family(node.nodeKey)+'_boxshadow_'+boxes.length+'_'+index;filter.setAttribute('x','-100%');filter.setAttribute('y','-100%');filter.setAttribute('width','300%');filter.setAttribute('height','300%');if(shadow.spreadPx){const morph=document.createElementNS(NS,'feMorphology');morph.setAttribute('operator',shadow.spreadPx>0?'dilate':'erode');morph.setAttribute('radius',String(Math.abs(shadow.spreadPx)));filter.append(morph);}const blur=document.createElementNS(NS,'feGaussianBlur');blur.setAttribute('stdDeviation',String(shadow.blurPx/2));filter.append(blur);svg.append(filter);shape.setAttribute('filter','url(#'+filter.id+')');svg.append(shape);}
   const shape=document.createElementNS(NS,'path');shape.setAttribute('d',union.d);shape.setAttribute('fill',svgInk(svg,paint.ink,family(node.nodeKey)+'_box_'+boxes.length));svg.append(shape);
   if(paint.border){const border=svgInk(svg,paint.border.ink,family(node.nodeKey)+'_border_'+boxes.length);if(paint.border.widthPx.every(w=>w===paint.border.widthPx[0])){shape.setAttribute('stroke',border);shape.setAttribute('stroke-width',String(paint.border.widthPx[0]));if(paint.border.style!=='solid')shape.setAttribute('stroke-dasharray',paint.border.style==='dotted'?'1 3':'6 4');}else for(const edge of union.edges){const line=document.createElementNS(NS,'line');line.setAttribute('x1',String(edge.from[0]));line.setAttribute('y1',String(edge.from[1]));line.setAttribute('x2',String(edge.to[0]));line.setAttribute('y2',String(edge.to[1]));line.setAttribute('stroke',border);line.setAttribute('stroke-width',String(paint.border.widthPx[edge.side]));if(paint.border.style!=='solid')line.setAttribute('stroke-dasharray',paint.border.style==='dotted'?'1 3':'6 4');svg.append(line);}}
   if(paint.tail){const t=paint.tail,r=rectangles[0],polygon=document.createElementNS(NS,'polygon');let points;if(t.side==='top')points=[[r.left+t.offsetPx,r.top],[r.left+t.offsetPx+t.widthPx/2,r.top-t.heightPx],[r.left+t.offsetPx+t.widthPx,r.top]];else if(t.side==='bottom')points=[[r.left+t.offsetPx,r.bottom],[r.left+t.offsetPx+t.widthPx/2,r.bottom+t.heightPx],[r.left+t.offsetPx+t.widthPx,r.bottom]];else if(t.side==='left')points=[[r.left,r.top+t.offsetPx],[r.left-t.widthPx,r.top+t.offsetPx+t.heightPx/2],[r.left,r.top+t.offsetPx+t.heightPx]];else points=[[r.right,r.top+t.offsetPx],[r.right+t.widthPx,r.top+t.offsetPx+t.heightPx/2],[r.right,r.top+t.offsetPx+t.heightPx]];polygon.setAttribute('points',points.map(p=>p.join(',')).join(' '));polygon.setAttribute('fill',t.color);svg.append(polygon);}
   boxes.push(svg);continue;
  }
  for(const rect of ranges){const box=document.createElement('div');Object.assign(box.style,{position:'absolute',pointerEvents:'none',zIndex:'-1',boxSizing:'border-box',left:px(rect.left-parent.left-paint.paddingPx[3]),top:px(rect.top-parent.top-paint.paddingPx[0]),width:px(rect.right-rect.left+paint.paddingPx[1]+paint.paddingPx[3]),height:px(rect.bottom-rect.top+paint.paddingPx[0]+paint.paddingPx[2]),background:ink(paint.ink),borderRadius:paint.radiusPx.map(px).join(' '),boxShadow:paint.shadows.map(s=>[px(s.xPx),px(s.yPx),px(s.blurPx),px(s.spreadPx),s.color].join(' ')).join(',')});
   if(paint.border){box.style.borderWidth=paint.border.widthPx.map(px).join(' ');box.style.borderStyle=paint.border.style;box.style.borderColor=ink(paint.border.ink);}
   if(paint.tail){const t=paint.tail,tail=document.createElement('div');Object.assign(tail.style,{position:'absolute',width:px(t.widthPx),height:px(t.heightPx),background:t.color});if(t.side==='top'||t.side==='bottom'){tail.style.left=px(t.offsetPx);tail.style[t.side]=px(-t.heightPx);tail.style.clipPath=t.side==='top'?'polygon(0 100%,50% 0,100% 100%)':'polygon(0 0,100% 0,50% 100%)';}else{tail.style.top=px(t.offsetPx);tail.style[t.side]=px(-t.widthPx);tail.style.clipPath=t.side==='left'?'polygon(100% 0,100% 100%,0 50%)':'polygon(0 0,100% 50%,0 100%)';}box.append(tail);}
   root.prepend(box);boxes.push(box);
  }
 }
 const fillStates=new Map(Array.from(root.querySelectorAll('[data-dv-fill=true]'),el=>[el,el.getAttribute('fill')]));
 return {seek(frame){
  if(!Number.isSafeInteger(frame)||frame<0)throw new Error('TEXT_FRAME: local frame must be nonnegative integer');
  for(const [el,style]of baseStyles)el.setAttribute('style',style);
  for(const [el,fill]of fillStates)fill===null?el.removeAttribute('fill'):el.setAttribute('fill',fill);
  for(const a of animations){
   const s=a.sequence,elapsed=frame-s.startFrame-a.rank*s.staggerFrames;
   const progress=elapsed<0?0:elapsed>=s.durationFrames*s.cycles?1:(elapsed%s.durationFrames)/s.durationFrames;
   for(const el of a.elements){el.style.display='inline-block';for(const d of pose(s.poses,progress)){
    el.style.setProperty(d.property,d.value);
    if(d.property==='color'){el.style.webkitTextFillColor=d.value;for(const painted of el.querySelectorAll('[data-dv-fill=true]'))painted.setAttribute('fill',d.value);}
   }}
  }
  if(pathState){
   let margin=node.startMarginPx;
   if(node.marginKeys.length){const poses=node.marginKeys.map(k=>({progress:k.offsetFrames,easing:k.easing,declarations:[{property:'margin',value:String(k.marginPx)}]}));margin=Number(pose(poses,frame)[0].value);}
   let offset=margin+(pathState.total-margin-node.endMarginPx-pathState.width)*(node.align==='center'?.5:node.align==='end'?1:0);
   for(const g of pathState.glyphs){
    const distance=node.reverse?pathState.total-offset-g.width/2:offset+g.width/2;
    const a=pathState.path.getPointAtLength(Math.max(0,Math.min(pathState.total,distance))),b=pathState.path.getPointAtLength(Math.max(0,Math.min(pathState.total,distance+.1)));
    const angle=node.orientation==='upright'?0:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+(node.reverse?180:0);
    g.el.setAttribute('transform','translate('+a.x+' '+a.y+') rotate('+angle+') translate('+(-g.width/2)+' '+(node.side==='left'?0:flow.format.sizePx)+')');
    g.el.style.visibility=node.overflow==='clip'&&(distance<margin||distance>pathState.total-node.endMarginPx)?'hidden':'inherit';
    offset+=g.width;
   }
  }
 }};
}};
})();`;
}
