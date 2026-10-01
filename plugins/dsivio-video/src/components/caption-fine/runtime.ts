/** Trusted built-in seek program. Static geometry comes from terminal TextFlow's browser layout. */
export function fineRuntimeSource(): string {
 return String.raw`
const p=data.recipe, n=key=>Number(p[key]), clamp=t=>Math.max(0,Math.min(1,t)), NS='http://www.w3.org/2000/svg';
const base=root.querySelector('[data-caption-base]'),active=root.querySelector('[data-caption-active]'),card=root.querySelector('[data-caption-card]');
const bases=Array.from(base.querySelectorAll('[data-run]')).filter(el=>data.units.some(u=>u.unitKey===el.dataset.run));
const actives=Array.from(active.querySelectorAll('[data-run]')).filter(el=>data.units.some(u=>u.unitKey===el.dataset.run));
for(const el of [...bases,...actives]){el.style.whiteSpace=p.wrap==='grapheme'?'pre-wrap':'nowrap';el.style.display='inline-block';if(p.wrap==='grapheme')el.style.maxWidth='100%';}
const svg=document.createElementNS(NS,'svg');Object.assign(svg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',overflow:'visible',pointerEvents:'none',zIndex:'0'});card.prepend(svg);
const origin=card.getBoundingClientRect();
const unitOrigins=bases.map(el=>{const r=el.getBoundingClientRect();return{left:r.left-origin.left,top:r.top-origin.top};});
const glyphs=bases.map(el=>{const output=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){if(text.parentElement.closest('svg'))continue;for(const g of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.textContent)){const range=document.createRange();range.setStart(text,g.index);range.setEnd(text,g.index+g.segment.length);output.push(Array.from(range.getClientRects()).map(r=>({left:r.left-origin.left,right:r.right-origin.left,top:r.top-origin.top,bottom:r.bottom-origin.top})));}}return output;});
const measured=glyphs.map(glyph=>{const lines=[];for(const rect of glyph.flat()){const line=lines.find(line=>Math.abs(line.top-rect.top)<.5&&Math.abs(line.bottom-rect.bottom)<.5);if(line){line.left=Math.min(line.left,rect.left);line.right=Math.max(line.right,rect.right);}else lines.push({...rect});}return lines.sort((a,b)=>a.top-b.top);});
const sides=key=>{const v=String(p[key]).split(/\s+/).map(Number);return[v[0],v[1]===undefined?v[0]:v[1]];};
const boxPadding=sides('active-box-padding');
function action(kind,t,scaleOverride){t=clamp(t);const q=1-t,scale=scaleOverride===undefined?.5:scaleOverride;let transform='',filter='',clip='',opacity=1;
 if(kind==='none')return{transform,filter,clip,opacity};
 if(['fade','blur-in','zoom-blur'].includes(kind))opacity=t;
 if(['pop','scale','spring','bounce','elastic','stamp'].includes(kind)){let value=scale+(1-scale)*t;if(kind==='pop')value=1-q*q+.15*Math.sin(t*Math.PI);if(kind==='spring'||kind==='elastic')value=1-Math.exp(-6*t)*Math.cos(t*Math.PI*4);if(kind==='bounce')value=1-Math.abs(Math.cos(t*Math.PI*2))*q*.5;if(kind==='stamp')value=1+q*.8;transform='scale('+value+')';}
 if(kind==='tilt')transform='rotate('+(-20*q)+'deg) scale('+(1-.2*q)+')';
 if(kind==='zoom-blur'){transform='scale('+(1+.8*q)+')';filter='blur('+(12*q)+'px)';}
 if(kind==='flip-x'||kind==='flip-y')transform='perspective(800px) rotate'+(kind==='flip-x'?'X':'Y')+'('+(90*q)+'deg)';
 if(kind==='spin')transform='rotate('+(-180*q)+'deg) scale('+(1-.5*q)+')';
 if(kind==='squash')transform='scale('+(1+.5*q)+','+(1-.5*q)+')';if(kind==='stretch')transform='scale('+(1-.5*q)+','+(1+.5*q)+')';
 if(kind.startsWith('slide-')){const left=kind==='slide-left',right=kind==='slide-right',up=kind==='slide-up';transform='translate('+(left?-n('slide-distance')*q:right?n('slide-distance')*q:0)+'px,'+(up?-n('slide-distance')*q:kind==='slide-down'?n('slide-distance')*q:0)+'px)';}
 if(kind==='blur-in')filter='blur('+(12*q)+'px)';
 if(kind.startsWith('wipe-')&&t<1)clip='inset('+(kind==='wipe-down'?100*q:0)+'% '+(kind==='wipe-left'?100*q:0)+'% '+(kind==='wipe-up'?100*q:0)+'% '+(kind==='wipe-right'?100*q:0)+'%)';
 return{transform,filter,clip,opacity};
}
function loop(frame){const angle=frame/n('loop-period-frames')*Math.PI*2,i=n('loop-intensity'),s=Math.sin(angle);let transform='',filter='',opacity=1;
 if(p.loop==='shake')transform='translate('+(Math.sin(angle*3)*3*i)+'px,'+(Math.cos(angle*5)*2*i)+'px)';if(p.loop==='wobble')transform='rotate('+(s*3*i)+'deg)';
 if(p.loop==='glow-pulse')filter='drop-shadow(0 0 '+((s+1)*5*i)+'px '+p['active-fill']+')';if(p.loop==='breathe'||p.loop==='pulse')transform='scale('+(1+s*.04*i)+')';
 if(p.loop==='float')transform='translateY('+(-s*4*i)+'px)';if(p.loop==='flicker')opacity=clamp(1-(Math.sin(angle*7)>.6?.4:0)*i);return{transform,filter,opacity};
}
function cssFunctions(...values){return values.filter(value=>value&&value!=='none').join(' ')||'none';}
function intersectClips(...clips){const edges=[0,0,0,0];for(const clip of clips){if(!clip||clip==='none')continue;const values=clip.match(/[\d.]+/g).map(Number);for(let index=0;index<4;index++)edges[index]=Math.max(edges[index],values[index]);}return edges.some(edge=>edge>0)?'inset('+edges.map(edge=>edge+'%').join(' ')+')':'none';}
function pose(el,enter,exit,frame,start,end,enterFrames,exitFrames,extra){const a=action(enter,enterFrames?((frame-start)/enterFrames):1,extra),b=action(exit,exitFrames?((end-frame)/exitFrames):1);el.style.transform=cssFunctions(a.transform,b.transform);el.style.filter=cssFunctions(a.filter,b.filter);el.style.opacity=String(a.opacity*b.opacity);el.style.clipPath=intersectClips(a.clip,b.clip);return a.opacity*b.opacity;}
const path=(rects,radius)=>window.__dvText.rectangleUnion(rects,[radius,radius,radius,radius]).d;
function shape(rects,fill,radius,stroke,width,opacity,transform,filter='',clip=''){if(!rects.length||opacity<=0)return;const el=document.createElementNS(NS,'path');el.setAttribute('d',path(rects,radius));el.setAttribute('fill',fill);if(width){el.setAttribute('stroke',stroke);el.setAttribute('stroke-width',String(width));}Object.assign(el.style,{opacity:String(opacity),transform:transform||'none',filter:filter||'none',clipPath:clip||'none',transformBox:'fill-box',transformOrigin:'center'});svg.append(el);}
return frame=>{
 const absolute=frame+data.start;const regions=data.regions;if(regions){const rect=regions[absolute];root.style.display=rect===null?'none':'';if(rect){root.style.left=(rect.x+rect.width/2)*100+'%';root.style.top=rect.y*100+'%';}}else root.style.display='';
 const cueAlpha=pose(card,p['cue-enter'],p['cue-exit'],frame,0,data.end-data.start,n('cue-enter-frames'),n('cue-exit-frames'),p['cue-enter-start-scale']);
 if(p['loop-target']==='cue'){const l=loop(frame);card.style.transform=cssFunctions(card.style.transform,l.transform);card.style.filter=cssFunctions(card.style.filter,l.filter);card.style.opacity=String(cueAlpha*l.opacity);}
 svg.replaceChildren();const joined=[];let joinedPose={opacity:0,transform:'',filter:'',clip:''};
 data.units.forEach((unit,index)=>{
  const start=unit.frames.start,end=unit.frames.end,duration=end-start,progress=duration?clamp((absolute-start)/duration):absolute>=start?1:0,current=absolute>=start&&absolute<end,trail=absolute>=start;
  const reveal=p['atom-reveal']==='all'?1:p['atom-reveal']==='on-start'?(trail?1:0):progress;
  const shown=p['atom-reveal']==='typewriter'?Math.floor(reveal*glyphs[index].length):reveal?glyphs[index].length:0;
  const enterStart=p['atom-reveal']==='all'?data.start:start;
  const opacity=pose(bases[index],p['atom-enter'],p['atom-exit'],absolute,enterStart,data.end,n('atom-enter-frames'),n('atom-exit-frames'));
  const rect=unitOrigins[index];let shownRects=glyphs[index].slice(0,shown).flat();
  if(shown===glyphs[index].length)shownRects=measured[index];
  const local=rs=>rs.map(r=>({left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top}));
  if(reveal<1)bases[index].style.clipPath=shownRects.length?'path("'+path(local(shownRects),0)+'")':'inset(0 100% 0 0)';
  bases[index].style.opacity=String(opacity*n('opacity'));
  let emphasis=p.karaoke==='current'?current:p.karaoke==='trail'?trail:false;
  let sweep=emphasis?(p['karaoke-transition']==='wipe'&&absolute<end?progress:1):0;
  let remaining=measured[index].reduce((sum,rect)=>sum+rect.right-rect.left,0)*sweep;const swept=measured[index].map(rect=>{const width=Math.min(remaining,rect.right-rect.left);remaining-=width;return{...rect,right:rect.left+width};}).filter(rect=>rect.right>rect.left);
  let activeRects=shownRects.flatMap(rect=>swept.filter(fragment=>fragment.top<rect.bottom&&fragment.bottom>rect.top).map(fragment=>({...rect,left:Math.max(rect.left,fragment.left),right:Math.min(rect.right,fragment.right)}))).filter(rect=>rect.right>rect.left);
  actives[index].style.transform=bases[index].style.transform;actives[index].style.filter=bases[index].style.filter;actives[index].style.opacity=String(opacity*n('active-opacity'));actives[index].style.clipPath=activeRects.length?'path("'+path(local(activeRects),0)+'")':'inset(0 100% 0 0)';
  if(current&&p['active-response']!=='none'){const progress=clamp(n('active-response-frames')?(absolute-start)/n('active-response-frames'):1),response=action(p['active-response'],progress),scale=1+(n('active-scale')-1)*Math.sin(progress*Math.PI);for(const el of [bases[index],actives[index]]){el.style.transform=cssFunctions(el.style.transform,response.transform,'scale('+scale+')');el.style.filter=cssFunctions(el.style.filter,response.filter);el.style.opacity=String(Number(el.style.opacity)*response.opacity);}}
  if(p['loop-target']==='active-atom'&&current){const l=loop(absolute-start);for(const el of [bases[index],actives[index]]){el.style.transform=cssFunctions(el.style.transform,l.transform);el.style.filter=cssFunctions(el.style.filter,l.filter);el.style.opacity=String(Number(el.style.opacity)*l.opacity);}}
  const under=p['active-underline']==='current'?current:p['active-underline']==='trail'?trail:false;
  if(under&&shown)shape(measured[index].map(r=>({left:r.left,right:r.right,top:r.bottom+n('active-underline-offset'),bottom:r.bottom+n('active-underline-offset')+n('active-underline-thickness')})),p['active-underline-color'],0,'',0,1,'');
  const box=p['active-box']==='current'?current:p['active-box']==='trail'?trail:false;
  const transition=n('active-box-transition-frames');let boxAlpha=box?1:0,transform='',filter='',clip='';
  if(p['active-box']!=='off'&&transition&&box){const enter=action(p['active-box-enter'],(absolute-start)/transition),exit=action(p['active-box-exit'],(end-absolute)/transition);boxAlpha=enter.opacity*(p['active-box']==='current'?exit.opacity:1);transform=cssFunctions(enter.transform,p['active-box']==='current'?exit.transform:'');filter=cssFunctions(enter.filter,p['active-box']==='current'?exit.filter:'');clip=intersectClips(enter.clip,p['active-box']==='current'?exit.clip:'');}
  if(boxAlpha&&shown){const rects=measured[index].map(r=>({left:r.left-boxPadding[1],right:r.right+boxPadding[1],top:r.top-boxPadding[0],bottom:r.bottom+boxPadding[0]}));if(p['active-box-continuity']==='joined'){joined.push(...rects);if(boxAlpha>=joinedPose.opacity)joinedPose={opacity:boxAlpha,transform,filter,clip};}else shape(rects,p['active-box-background'],n('active-box-radius'),p['active-box-border-color'],n('active-box-border-width'),boxAlpha,transform,filter,clip);}
 });
 if(joined.length)shape(joined,p['active-box-background'],n('active-box-radius'),p['active-box-border-color'],n('active-box-border-width'),joinedPose.opacity,joinedPose.transform,joinedPose.filter,joinedPose.clip);
};`;
}
