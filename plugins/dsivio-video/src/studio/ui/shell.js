import { h, render } from 'preact';
import htm from 'htm';
import { useEffect, useState } from 'preact/hooks';
import { useStudioState, update, setPage, setLibrary } from './state.js';
import { api } from './api.js';
import { transport } from './transport.js';
import { t, setLocale } from './locale.js';
import { Source } from './source.js';
import { Stage } from './stage.js';
import { Timeline } from './timeline.js';
import { Inspector } from './inspector.js';
import { Comments } from './comments.js';
import { Tasks } from './tasks.js';
import { Artifacts } from './artifacts.js';
const html=htm.bind(h);
/** A single Preact host; external panels never create another application root. @param {Element} container @param {{component:import('preact').ComponentType<any>,props:Record<string,unknown>}} componentProps */
export function mountPanel(container,componentProps) { render(h(componentProps.component,componentProps.props),container);return()=>render(null,container); }
/** @typedef {{source:number,inspector:number,timeline:number,comments:number}} Layout */
export function Shell() {
  const state=useStudioState();
  const [layout,setLayout]=useState(/** @type {Layout} */({source:360,inspector:310,timeline:Math.min(420,Math.round(innerHeight*0.42)),comments:380}));
  const preferenceKey=`dsivio-video.studio.layout:${state.view?.projectRoot??''}:${state.view?.runFile??''}`;
  useEffect(()=>{try{const saved=localStorage.getItem(preferenceKey);if(saved){const value=JSON.parse(saved);if(['source','inspector','timeline','comments'].every(key=>Number.isFinite(value[key])))setLayout(value);}}catch(error){update({notice:String(error)});}},[preferenceKey]);
  useEffect(()=>{document.documentElement.dataset.theme=state.theme;document.documentElement.lang=state.locale;},[state.theme,state.locale]);
  /** @param {PointerEvent} event @param {keyof Layout} key */function resize(event,key){
    event.preventDefault();const initial=layout[key],origin=key==='timeline'?event.clientY:event.clientX;
    const move=/** @param {PointerEvent} next */next=>{const delta=(key==='timeline'?next.clientY:next.clientX)-origin;const value=Math.max(key==='timeline'?150:220,Math.min(key==='timeline'?600:700,initial+(key==='source'?delta:-delta)));setLayout(previous=>({...previous,[key]:value}));};
    const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});
  }
  useEffect(()=>{if(state.view)localStorage.setItem(preferenceKey,JSON.stringify(layout));},[layout]);
  const props={state,api,transport,t};
  const ready=state.status==='ready'&&!state.dirty&&state.mediaReady&&!state.audioError;
  return html`<div class="studio-app" data-studio-ready=${ready?'':undefined}>
    <header class="app-header"><div class="brand">dsivio<span>video</span><small>STUDIO</small></div><nav aria-label="Studio"><button class=${state.page==='studio'?'active':''} onClick=${()=>setPage('studio')}>${t('app.studio')}</button><button class=${state.page==='comments'?'active':''} onClick=${()=>{transport.pause();setPage('comments');}}>${t('app.comments')}</button></nav><span class=${`compile-state ${state.status}`}>${t(`app.${state.status==='ready'?'ready':state.status==='error'?'error':'compiling'}`)}</span><span class="run-title">${state.view?.runFile??''}</span><select aria-label=${t('app.language')} value=${state.locale} onChange=${/** @param {Event} event */event=>{if(event.currentTarget instanceof HTMLSelectElement)setLocale(event.currentTarget.value==='zh-CN'?'zh-CN':'en');}}><option value="en">English</option><option value="zh-CN">简体中文</option></select><button aria-label=${t('app.theme')} onClick=${()=>{const theme=state.theme==='dark'?'light':'dark';localStorage.setItem('dsivio-video.studio.theme',theme);update({theme});}}>${t(state.theme==='dark'?'app.light':'app.dark')}</button></header>
    ${state.error&&html`<div class="error compilation-error" role="alert"><strong>${state.error.code}</strong> ${state.error.message}</div>`}
    ${state.notice&&html`<div class="notice" role="status">${state.notice}<button onClick=${()=>update({notice:null})}>×</button></div>`}
    <div class="workspace" style=${{'--source-width':`${layout.source}px`,'--inspector-width':`${layout.inspector}px`,'--timeline-height':`${layout.timeline}px`,'--comments-width':`${layout.comments}px`}}>
      <aside class="library" hidden=${state.page!=='studio'}><nav class="library-tabs">${['source','tasks','artifacts'].map(name=>html`<button class=${state.library===name?'active':''} onClick=${()=>setLibrary(/** @type {import('./state.js').AppState['library']} */(name))}>${t(`app.${name}`)}</button>`)}</nav><div hidden=${state.library!=='source'}><${Source} ...${props}/></div><div hidden=${state.library!=='tasks'}><${Tasks} ...${props}/></div><div hidden=${state.library!=='artifacts'}><${Artifacts} ...${props}/></div></aside>
      <div class="resize-handle source-resize" hidden=${state.page!=='studio'} role="separator" aria-label=${t('app.resize')} onPointerDown=${/** @param {PointerEvent} event */event=>resize(event,'source')}/>
      <main class=${state.page==='comments'?'center comments-center':'center'}><${Stage} state=${state} t=${t}/><div class="resize-handle timeline-resize" hidden=${state.page!=='studio'} role="separator" aria-label=${t('app.resize')} aria-orientation="horizontal" aria-valuemin="150" aria-valuemax="600" aria-valuenow=${layout.timeline} tabIndex="0" onPointerDown=${/** @param {PointerEvent} event */event=>resize(event,'timeline')} onKeyDown=${/** @param {KeyboardEvent} event */event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const delta=event.key==='ArrowUp'?20:-20;setLayout(previous=>({...previous,timeline:Math.max(150,Math.min(600,previous.timeline+delta))}));}}}/><div class="timeline-host" hidden=${state.page!=='studio'}><${Timeline} ...${props}/></div></main>
      <div class="resize-handle inspector-resize" role="separator" aria-label=${t('app.resize')} onPointerDown=${/** @param {PointerEvent} event */event=>resize(event,state.page==='comments'?'comments':'inspector')}/>
      <aside class="inspector-host" hidden=${state.page!=='studio'} data-inspector><${Inspector} ...${props}/></aside><aside class="comments-host" hidden=${state.page!=='comments'}><${Comments} ...${props}/></aside>
    </div>
  </div>`;
}
