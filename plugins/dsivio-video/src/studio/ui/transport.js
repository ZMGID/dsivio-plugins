import { getState, update, select as selectState, subscribe } from './state.js';
import { startAudio, stopAudio, audioTime } from './audio.js';
/** @typedef {{partKey:string,nodeKey:string,rect:{x:number,y:number,width:number,height:number}}} Hit */
/** @typedef {{ready:Promise<void>,seekFrame:(frame:number)=>Promise<void>,play:(frame:number)=>void,pause:()=>void,hitTest:(x:number,y:number)=>Promise<Hit[]>,outline:(parts:readonly string[])=>Promise<Hit[]>,close:()=>void}} PreviewBridge */
/** @type {PreviewBridge|null} */let bridge=null;
let seekGeneration=0,raf=0,playGeneration=0,anchorTime=0,anchorFrame=0;
/** @param {PreviewBridge|null} value */
export function attachPreview(value) { bridge=value; }
/** Read-only RPC to an opaque-origin preview. Author programs never share the UI origin. @param {HTMLIFrameElement} iframe @returns {PreviewBridge} */
export function createPreviewBridge(iframe) {
  const remote=iframe.contentWindow;if(!remote)throw new Error('Preview window is unavailable');
  const target=remote;
  let sequence=0,closed=false;
  /** @type {Map<number,{resolve:(value:any)=>void,reject:(error:Error)=>void,timer:ReturnType<typeof setTimeout>}>} */const pending=new Map();
  /** @param {MessageEvent} event */
  function receive(event){if(event.source!==remote||event.origin!=='null'||event.data?.type!=='studio-preview-response')return;const request=pending.get(event.data.id);if(!request)return;clearTimeout(request.timer);pending.delete(event.data.id);if(event.data.ok)request.resolve(event.data.result);else request.reject(new Error(String(event.data.error)));}
  window.addEventListener('message',receive);
  /** @template T @param {string} method @param {unknown} [payload] @returns {Promise<T>} */
  function request(method,payload){if(closed)return Promise.reject(new Error('Preview bridge closed'));const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Preview ${method} timed out`));},30000);pending.set(id,{resolve,reject,timer});target.postMessage({type:'studio-preview-request',id,method,payload},'*');});}
  /** @param {string} method @param {unknown} payload */
  function fire(method,payload){void request(method,payload).catch(error=>{if(!closed)update({audioError:String(error)});});}
  return {ready:request('ready'),seekFrame(frame){return request('seekFrame',frame);},play(frame){fire('play',frame);},pause(){fire('pause',undefined);},hitTest(x,y){return request('hitTest',{x,y});},outline(parts){return request('outline',parts);},close(){closed=true;window.removeEventListener('message',receive);for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Preview bridge closed'));}pending.clear();}};
}
export function pause() { ++playGeneration;cancelAnimationFrame(raf);bridge?.pause();stopAudio();update({playing:false}); }
/** @param {number} value */
export async function seekFrame(value) {
  pause();const state=getState();if(!state.view)return;
  const frame=Math.max(0,Math.min(state.view.totalFrames-1,Math.round(value))),current=++seekGeneration;
  update({frame,filePreview:null,mediaReady:false});
  try{await bridge?.seekFrame(frame);if(current===seekGeneration)update({mediaReady:!!bridge});}catch(error){if(current===seekGeneration)update({audioError:error instanceof Error?error.message:String(error)});}
}
export async function play() {
  const state=getState();if(state.status!=='ready'||state.dirty||!state.view||!bridge||state.filePreview)return;
  if(state.frame===state.view.totalFrames-1)await seekFrame(0);
  const current=++playGeneration;const frame=getState().frame;
  try{
    const anchor=await startAudio(state.view,frame);if(current!==playGeneration){stopAudio();return;}
    anchorTime=anchor.time;anchorFrame=frame;bridge.play(frame);update({playing:true,audioError:null});
    const tick=()=>{const latest=getState();if(!latest.playing||current!==playGeneration||!latest.view)return;const fps=latest.view.clock.fps;const elapsed=Math.max(0,audioTime()-anchorTime);const next=Math.min(latest.view.totalFrames-1,anchorFrame+Math.floor(elapsed*fps.numerator/fps.denominator));update({frame:next});void bridge?.seekFrame(next).catch(error=>{pause();update({audioError:String(error)});});if(next===latest.view.totalFrames-1){pause();return;}raf=requestAnimationFrame(tick);};
    raf=requestAnimationFrame(tick);
  }catch(error){pause();update({audioError:error instanceof Error?error.message:String(error)});}
}
/** @param {string|null} key */
export function select(key) { if(getState().filePreview)void seekFrame(getState().frame);selectState(key); }
/** @param {import('./state.js').FilePreview|null} preview */
export function setFilePreview(preview) { pause();update({filePreview:preview});if(!preview)void seekFrame(getState().frame); }
export const transport={seekFrame,play,pause,select,setFilePreview};
let revision=0,lastReady=false;
subscribe(state=>{
  const changed=!!state.view&&state.view.viewRevision!==revision;
  const ready=state.status==='ready'&&!state.dirty;
  const invalidated=lastReady&&!ready;
  revision=state.view?.viewRevision??revision;lastReady=ready;
  if(changed||invalidated)pause();
});
export function installShortcuts() {
  /** @param {KeyboardEvent} event */const keydown=event=>{
    const target=event.target;if(target instanceof Element&&target.closest('input,textarea,select,button,[contenteditable="true"],[role="menu"],[data-inspector]'))return;
    const state=getState();let next=state.frame;const step=event.shiftKey?10:1;
    if(event.code==='Space'){event.preventDefault();if(state.playing)pause();else void play();return;}
    if(event.key==='Escape'){select(null);return;}
    if(event.key==='ArrowLeft'||event.key===',')next-=step;else if(event.key==='ArrowRight'||event.key==='.')next+=step;else if(event.key==='Home')next=0;else if(event.key==='End')next=(state.view?.totalFrames??1)-1;else return;
    event.preventDefault();void seekFrame(next);
  };
  document.addEventListener('keydown',keydown);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('studio-audio-interrupted',pause);
  return ()=>document.removeEventListener('keydown',keydown);
}
