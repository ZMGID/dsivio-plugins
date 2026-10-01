import { h } from 'preact';
import htm from 'htm';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { getState, update } from './state.js';
import { attachPreview, createPreviewBridge, transport } from './transport.js';
import { prepareAudio, muteAudio, isMuted } from './audio.js';
import { Menu } from './menus.js';
const html=htm.bind(h);
/** @param {{state:import('./state.js').AppState,t:typeof import('./locale.js').t}} props */
export function Stage({state,t}) {
  const frame=useRef(/** @type {HTMLIFrameElement|null} */(null)),box=useRef(/** @type {HTMLDivElement|null} */(null)),fileMedia=useRef(/** @type {HTMLMediaElement|null} */(null));
  const proxy=useRef(/** @type {import('./transport.js').PreviewBridge|null} */(null));
  const [scale,setScale]=useState(1),[muted,setMuted]=useState(isMuted()),[menu,setMenu]=useState(/** @type {{key:string,title:string}[]} */([]));
  const [outlines,setOutlines]=useState(/** @type {{x:number,y:number,width:number,height:number}[]} */([]));
  const view=state.view,extent=view?.document.extent;
  useEffect(()=>{if(!box.current||!extent)return;const resize=()=>{const bounds=box.current?.getBoundingClientRect();if(bounds)setScale(Math.min(bounds.width/extent.widthPx,bounds.height/extent.heightPx));};const observer=new ResizeObserver(resize);observer.observe(box.current);resize();return()=>observer.disconnect();},[extent?.widthPx,extent?.heightPx]);
  useLayoutEffect(()=>{update({mediaReady:false,audioError:null});attachPreview(null);return()=>{proxy.current?.close();proxy.current=null;attachPreview(null);};},[view?.viewRevision]);
  useEffect(()=>{
    const entity=view?.entities.find(entity=>entity.editorKey===state.selectedKey);
    const preview=proxy.current;
    if(!entity||!preview||state.page==='comments'){setOutlines([]);return;}
    let cancelled=false;
    void preview.outline(entity.pictureParts).then(hits=>{if(!cancelled)setOutlines(hits.map(({rect})=>({x:rect.x*scale,y:rect.y*scale,width:rect.width*scale,height:rect.height*scale})));}).catch(error=>{if(!cancelled)update({audioError:String(error)});});
    return()=>{cancelled=true;};
  },[state.selectedKey,state.frame,state.mediaReady,state.page,scale]);
  async function loaded() {
    try{if(!view||!frame.current)return;const revision=view.viewRevision;const preview=createPreviewBridge(frame.current);proxy.current?.close();proxy.current=preview;await Promise.all([preview.ready,prepareAudio(view)]);if(getState().view?.viewRevision!==revision)return;attachPreview(preview);await transport.seekFrame(getState().frame);}catch(error){if(getState().view?.viewRevision===view?.viewRevision)update({audioError:error instanceof Error?error.message:String(error)});}
  }
  /** @param {MouseEvent} event */async function pictureClick(event){
    if(state.page==='comments'){if(state.playing)transport.pause();else void transport.play();return;}
    if(event.type==='contextmenu')event.preventDefault();
    const rect=frame.current?.getBoundingClientRect(),preview=proxy.current;if(!rect||!preview||!view)return;
    let hits;try{hits=await preview.hitTest((event.clientX-rect.left)/scale,(event.clientY-rect.top)/scale);}catch(error){update({audioError:String(error)});return;}
    const entities=view.entities.filter(entity=>hits.some(hit=>entity.pictureParts.includes(hit.partKey)||entity.pictureParts.includes(hit.nodeKey))).sort((a,b)=>b.paintRank-a.paintRank);
    if(event.type==='contextmenu'){event.preventDefault();setMenu(entities.map(entity=>({key:entity.editorKey,title:entity.title})));}else transport.select(entities[0]?.editorKey??null);
  }
  const preview=state.filePreview;
  return html`<section class="stage-panel" aria-label=${t('player.preview')}>
    <div class="stage-heading"><strong>${preview?preview.name:t('player.preview')}</strong>${preview&&html`<button onClick=${()=>transport.setFilePreview(null)}>${t('player.return')}</button>`}<span>${view?.clock.fps.numerator}/${view?.clock.fps.denominator} fps</span></div>
    <div ref=${box} class="stage-viewport">
      ${view&&html`<div class="composition-frame" style=${{width:(extent?.widthPx??1)*scale,height:(extent?.heightPx??1)*scale,display:preview?'none':'block'}}><iframe key=${view.viewRevision} ref=${frame} title=${t('player.preview')} sandbox="allow-scripts" src=${`/__studio/preview?revision=${view.viewRevision}`} onLoad=${loaded} style=${{width:extent?.widthPx,height:extent?.heightPx,transform:`scale(${scale})`}}/><div class="stage-hit-surface" onClick=${pictureClick} onContextMenu=${pictureClick} role="button" tabIndex="0" aria-label=${t('player.select')} onKeyDown=${/** @param {KeyboardEvent} event */event=>{if(event.key==='Enter'){if(state.playing)transport.pause();else void transport.play();}}}/>${outlines.map(rect=>html`<div class="picture-outline" style=${{left:rect.x,top:rect.y,width:rect.width,height:rect.height}}/>`)}</div>`}
      ${!view&&html`<div class="empty" role="status">${t(state.status==='error'?'player.unavailable':'app.loading')}</div>`}
      ${preview?.kind==='image'&&html`<img class="file-picture" src=${preview.url} alt=${preview.name}/>`}
      ${preview&&preview.kind!=='image'&&html`<${preview.kind==='video'?'video':'audio'} key=${preview.url} ref=${fileMedia} class="file-media" src=${preview.url} controls playsInline/>`}
      ${state.status!=='ready'&&view&&html`<div class="stale-banner" role="status">${t('app.stale')}</div>`}
      ${!preview&&!state.mediaReady&&state.status==='ready'&&html`<div class="stage-loading">${t('player.loading')}</div>`}
      ${menu.length>0&&html`<${Menu} label=${t('player.select')} items=${menu.map(entity=>({key:entity.key,label:entity.title,action:()=>transport.select(entity.key)}))} onClose=${()=>setMenu([])}/>`}
    </div>
    ${state.audioError&&html`<div class="error" role="alert">${state.audioError}</div>`}
    ${!preview?html`<div class="transport"><button onClick=${()=>void transport.seekFrame(state.frame-1)} aria-label=${t('player.previous')}>◀</button><button disabled=${state.status!=='ready'||!state.mediaReady||!!state.audioError} onClick=${()=>{if(state.playing)transport.pause();else void transport.play();}}>${t(state.playing?'player.pause':'player.play')}</button><button onClick=${()=>void transport.seekFrame(state.frame+1)} aria-label=${t('player.next')}>▶</button><button onClick=${()=>{muteAudio(!muted);setMuted(!muted);}}>${t(muted?'player.unmute':'player.mute')}</button><input aria-label=${t('player.time')} type="range" min="0" max=${Math.max(0,(view?.totalFrames??1)-1)} value=${state.frame} onInput=${/** @param {Event} event */event=>{if(event.currentTarget instanceof HTMLInputElement)void transport.seekFrame(Number(event.currentTarget.value));}}/><output>${t('player.frame',{frame:state.frame,total:Math.max(0,(view?.totalFrames??1)-1)})}</output></div>`:preview.kind!=='image'&&html`<div class="transport"><button onClick=${()=>{if(fileMedia.current)fileMedia.current.currentTime=Math.max(0,fileMedia.current.currentTime-5);}}>${t('player.back')}</button><button onClick=${()=>{if(fileMedia.current)fileMedia.current.currentTime=Math.min(fileMedia.current.duration,fileMedia.current.currentTime+5);}}>${t('player.forward')}</button></div>`}
  </section>`;
}
