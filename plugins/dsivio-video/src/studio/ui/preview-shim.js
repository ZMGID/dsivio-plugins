(()=>{
/** @typedef {{id:string,lifetime:import('../../timeline/types.ts').Bounds,visible?:import('../../timeline/types.ts').Bounds[],nodes:{id:string,node:import('../../render/ir.ts').VisualNode}[]}} BrowserPresent */
/** @typedef {{__dvDocument:{clock:import('../../timeline/types.ts').Clock,totalFrames:number,presents:BrowserPresent[]},__dvReady:Promise<void>,__hf:{seek:(seconds:number)=>void}}} RenderWindow */
/** @typedef {{partKey:string,nodeKey:string,rect:{x:number,y:number,width:number,height:number}}} Hit */
const win=/** @type {Window & RenderWindow} */(/** @type {unknown} */(window));
/** @type {{video:HTMLVideoElement,node:import('../../render/ir.ts').VisualNode,present:BrowserPresent,visibility:string}[]} */
const media=[];
let generation=0,continuous=false;
/** @param {number} frame @param {import('../../render/ir.ts').VideoSamplingMap} map */
function sample(frame,map) {
  const piece=map.pieces.find(piece=>frame>=piece.target.start&&frame<piece.target.end);
  if(!piece)return undefined;
  const start=BigInt(piece.sourceStart.numerator),startDen=BigInt(piece.sourceStart.denominator);
  const step=BigInt(piece.sourceStep.numerator),stepDen=BigInt(piece.sourceStep.denominator);
  const numerator=start*stepDen+BigInt(frame-piece.target.start)*step*startDen;
  const denominator=startDen*stepDen;
  let wrapped=numerator;
  if(piece.loop){const loop=piece.loop.sourceFrames;const origin=BigInt(loop.start)*denominator;const length=BigInt(loop.end-loop.start)*denominator;wrapped=origin+((numerator-origin)%length+length)%length;}
  const sourceFrame=wrapped/denominator;
  const seconds=(Number(sourceFrame)+0.5)*map.sourceClock.fps.denominator/map.sourceClock.fps.numerator;
  return {seconds,rate:Number(step)/Number(stepDen)*win.__dvDocument.clock.fps.numerator/win.__dvDocument.clock.fps.denominator*map.sourceClock.fps.denominator/map.sourceClock.fps.numerator,hold:step===0n};
}
/** @param {HTMLVideoElement} video @param {number} seconds @param {number} current */
async function decode(video,seconds,current) {
  if(video.readyState<1) await new Promise((resolve,reject)=>{video.addEventListener('loadedmetadata',resolve,{once:true});video.addEventListener('error',()=>reject(new Error(`Video cannot load ${video.currentSrc}`)),{once:true});});
  if(current!==generation)return;
  if(Math.abs(video.currentTime-seconds)>0.00001) await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('Video seek timed out'));},15000);
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',failed);};
    const done=()=>{cleanup();resolve(undefined);}; const failed=()=>{cleanup();reject(new Error('Video seek failed'));};
    video.addEventListener('seeked',done,{once:true});video.addEventListener('error',failed,{once:true});video.currentTime=seconds;
  });
  if(current!==generation)return;
  if(video.readyState<2) throw new Error('Video frame has not decoded');
}
const ready=(async()=>{
  for(const present of win.__dvDocument.presents) for(const {id,node} of present.nodes) {
    if(node.kind!=='video'&&!(node.kind==='surface'&&node.surface.timing.kind==='frames'))continue;
    const original=document.getElementById(id); if(!original)throw new Error(`Missing video node ${id}`);
    const video=document.createElement('video');for(const attribute of original.attributes)video.setAttribute(attribute.name,attribute.value);
    video.src=original.getAttribute('data-dv-source')??'';video.muted=true;video.playsInline=true;video.preload='auto';original.replaceWith(video);media.push({video,node,present,visibility:video.style.visibility});
  }
  await win.__dvReady;
  await seekFrame(0);
})();
/** @param {number} frame */
async function seekFrame(frame) {
  const current=++generation;
  win.__hf.seek(frame*win.__dvDocument.clock.fps.denominator/win.__dvDocument.clock.fps.numerator);
  await Promise.all(media.map(async entry=>{
    const {video,node,present}=entry;
    const active=frame>=present.lifetime.start&&frame<present.lifetime.end&&(present.visible===undefined||present.visible.some(window=>frame>=window.start&&frame<window.end));
    if(!active){video.pause();return;}
    const sampling=('sampling' in node)?node.sampling:undefined;
    if(!sampling)throw new Error('Moving media is missing its sampling map');
    const phase=sample(frame-present.lifetime.start,sampling);
    if(!phase){video.pause();video.style.visibility='hidden';return;}
    video.style.visibility=entry.visibility;
    if(!continuous||phase.hold||Math.abs(video.currentTime-phase.seconds)>0.08){video.pause();await decode(video,phase.seconds,current);}
    if(current!==generation)return;
    if(continuous&&!phase.hold){video.playbackRate=phase.rate;await video.play();}else video.pause();
  }));
}
/** @param {number} [x] @param {number} [y] @param {readonly string[]} [parts] */
function pictureHits(x,y,parts) {
  /** @type {Hit[]} */const hits=[];
  for(const present of win.__dvDocument.presents){const part=document.getElementById(present.id);if(!part||getComputedStyle(part).display==='none')continue;for(const {id,node} of present.nodes){const element=document.getElementById(id);if(!element)continue;const rect=element.getBoundingClientRect();const partKey=part.getAttribute('data-dv-present')??'';if(parts?(parts.includes(partKey)||parts.includes(node.nodeKey)):(x!==undefined&&y!==undefined&&x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom))hits.push({partKey,nodeKey:node.nodeKey,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});}}
  return hits.reverse();
}
const parentOrigin=new URL(location.href).origin;
window.addEventListener('message',async event=>{
  if(event.source!==window.parent||event.origin!==parentOrigin||event.data?.type!=='studio-preview-request'||!Number.isSafeInteger(event.data.id))return;
  const {id,method,payload}=event.data;
  try {
    await ready;
    let result;
    if(method==='ready')result=true;
    else if(method==='pause'){continuous=false;++generation;for(const {video} of media)video.pause();}
    else if(method==='seekFrame'||method==='play'){if(!Number.isSafeInteger(payload)||payload<0||payload>=win.__dvDocument.totalFrames)throw new Error('Invalid preview program frame');if(method==='play')continuous=true;await seekFrame(payload);}
    else if(method==='hitTest'){if(!Number.isFinite(payload?.x)||!Number.isFinite(payload?.y))throw new Error('Invalid picture hit coordinates');result=pictureHits(payload.x,payload.y);}
    else if(method==='outline'){if(!Array.isArray(payload)||!payload.every(part=>typeof part==='string'))throw new Error('Invalid outline identities');result=pictureHits(undefined,undefined,payload);}
    else throw new Error('Unknown preview method');
    window.parent.postMessage({type:'studio-preview-response',id,ok:true,result},parentOrigin);
  } catch(error) {window.parent.postMessage({type:'studio-preview-response',id,ok:false,error:error instanceof Error?error.message:String(error)},parentOrigin);}
});
})();
