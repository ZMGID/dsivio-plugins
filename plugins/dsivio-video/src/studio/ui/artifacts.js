import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { update } from './state.js';
import { materialUrl, waveform } from './materials.js';
const html=htm.bind(h);
/** @typedef {import('../protocol.ts').ArtifactCard} Artifact */
/** @typedef {import('../protocol.ts').ArtifactSource} Source */
/** @param {{artifact:Artifact,t:(key:string)=>string}} props */
function Thumbnail({artifact,t}) {
  const root=useRef(/** @type {HTMLDivElement|null} */(null));
  const canvas=useRef(/** @type {HTMLCanvasElement|null} */(null));
  const [visible,setVisible]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{if(!root.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}});observer.observe(root.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    if(!visible||artifact.kind!=='audio')return;
    let cancelled=false;
    const context=new AudioContext();
    void (async()=>{try{const response=await fetch(materialUrl(artifact.resource));if(!response.ok)throw new Error(`Audio thumbnail HTTP ${response.status}`);const buffer=await context.decodeAudioData(await response.arrayBuffer());if(cancelled)return;const peaks=waveform(buffer,128),drawing=canvas.current?.getContext('2d');if(!drawing)return;drawing.clearRect(0,0,256,128);drawing.fillStyle='#718ee8';peaks.forEach((peak,index)=>{const height=Math.max(1,peak*120);drawing.fillRect(index*2,64-height/2,1,height);});}catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:String(cause));}finally{await context.close();}})();
    return()=>{cancelled=true;};
  },[visible,artifact.resource.$resource]);
  const style='width:100%;height:100%;object-fit:contain';
  return html`<div ref=${root} style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--panel);overflow:hidden">${visible&&(artifact.kind==='image'?html`<img src=${materialUrl(artifact.resource)} alt="" style=${style} onError=${()=>setError(t('artifacts.thumbnailError'))}/>`:artifact.kind==='video'?html`<video src=${materialUrl(artifact.resource)} muted playsInline preload="metadata" style=${style} onLoadedMetadata=${(/** @type {Event} */event)=>{const video=/** @type {HTMLVideoElement} */(event.currentTarget);video.currentTime=Math.min(0.1,video.duration/2);}} onError=${()=>setError(t('artifacts.thumbnailError'))}></video>`:html`<canvas ref=${canvas} width="256" height="128" style="width:100%" aria-label=${t('artifacts.waveform')}></canvas>`)}${error&&html`<small role="alert">${error}</small>`}</div>`;
}
/** @param {import('./comments.js').Props} props */
export function Artifacts({state,api,transport,t}) {
  const [artifacts,setArtifacts]=useState(/** @type {readonly Artifact[]} */([]));
  const [kind,setKind]=useState('all');
  const [before,setBefore]=useState(/** @type {string|undefined} */(undefined));
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState(/** @type {string|null} */(null));
  const [sourceIndex,setSourceIndex]=useState(/** @type {Record<string,number>} */({}));
  const [renaming,setRenaming]=useState(/** @type {{key:string,source:Source}|null} */(null));
  const [name,setName]=useState('');
  const [savingName,setSavingName]=useState(false);
  const generation=useRef(0),saving=useRef(false);
  const cancelledRename=useRef(false);
  const selection=artifacts.find(card=>card.key===selected);
  /** @param {Artifact} card */
  function source(card){return card.sources[sourceIndex[card.key]??0]??card.sources[0];}
  async function load(older=false) {
    if(older&&(busy||!before))return;
    const current=++generation.current;setBusy(true);
    try{
      const query=new URLSearchParams({kind,limit:'20'});if(state.taskContext)query.set('build',state.taskContext);if(older&&before)query.set('before',before);
      /** @type {import('../protocol.ts').ArtifactsPage} */const page=await api.get(`/__studio/artifacts?${query}`);
      if(current!==generation.current)return;
      setArtifacts(previous=>{if(!older)return page.artifacts;const merged=[...previous];for(const card of page.artifacts){const index=merged.findIndex(row=>row.key===card.key);if(index<0)merged.push(card);else{const prior=merged[index];if(prior)merged[index]={...prior,sources:[...prior.sources,...card.sources.filter(item=>!prior.sources.some(old=>old.build===item.build&&old.output===item.output))]};}}return merged;});
      setBefore(page.before);setLoaded(true);setError('');
    }catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(current===generation.current)setBusy(false);}
  }
  useEffect(()=>{if(state.library==='artifacts'&&!loaded)void load();},[state.library,loaded]);
  useEffect(()=>{if(loaded)void load();},[kind,state.taskContext]);
  useEffect(()=>()=>{generation.current++;},[]);
  /** @param {Artifact} card */
  function rename(card){if(saving.current)return;const target=source(card);if(!target)return;cancelledRename.current=false;setSelected(card.key);setRenaming({key:card.key,source:target});setName(target.displayName);setError('');}
  async function save() {
    if(!renaming||saving.current||cancelledRename.current)return;saving.current=true;setSavingName(true);
    try{
      /** @type {{manifestVersion:string,displayName:string}} */const result=await api.write('/__studio/artifacts/rename',{build:renaming.source.build,output:renaming.source.output,expectedManifestVersion:renaming.source.manifestVersion,displayName:name});
      const target=renaming;
      setArtifacts(previous=>previous.map(card=>({...card,sources:card.sources.map(item=>item.build===target.source.build&&item.output===target.source.output?{...item,displayName:result.displayName,manifestVersion:result.manifestVersion}:item.build===target.source.build?{...item,manifestVersion:result.manifestVersion}:item)})));
      cancelledRename.current=true;setRenaming(null);setError('');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{saving.current=false;setSavingName(false);}
  }
  /** @param {Artifact} card */
  function preview(card){setSelected(card.key);transport.pause();transport.setFilePreview({kind:card.kind,url:materialUrl(card.resource),name:source(card)?.displayName??card.owner.output});}
  return html`<section class="artifacts-panel" aria-label=${t('artifacts.title')} data-artifacts-ready=${loaded?'':undefined} onKeyDown=${(/** @type {KeyboardEvent} */event)=>{if(event.key==='F2'&&selection&&!renaming){event.preventDefault();rename(selection);}}}>
    <header><h2>${t('artifacts.title')}</h2><button disabled=${busy} onClick=${()=>{void load();}}>${t('artifacts.refresh')}</button><select aria-label=${t('artifacts.filter')} value=${kind} onChange=${(/** @type {Event} */event)=>setKind(/** @type {HTMLSelectElement} */(event.currentTarget).value)}>${['all','video','image','audio'].map(value=>html`<option value=${value}>${t(`artifacts.${value}`)}</option>`)}</select></header>
    ${state.taskContext&&html`<nav><span>${state.taskContext}</span><button onClick=${()=>update({taskContext:null})}>${t('artifacts.clear')}</button><button onClick=${()=>update({library:'tasks'})}>${t('artifacts.tasks')}</button></nav>`}${error&&html`<p role="alert">${error}</p>`}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px" onScroll=${(/** @type {Event} */event)=>{const node=/** @type {HTMLElement} */(event.currentTarget);if(node.scrollTop+node.clientHeight>=node.scrollHeight-24)void load(true);}}>
      ${artifacts.map(card=>html`<article key=${card.key} tabindex="0" class=${selected===card.key?'selected':''} onFocus=${()=>setSelected(card.key)}><button style="width:100%" onClick=${()=>preview(card)} aria-label=${source(card)?.displayName}><${Thumbnail} artifact=${card} t=${t}/></button>
        ${renaming?.key===card.key?html`<input autofocus disabled=${savingName} aria-label=${t('artifacts.name')} value=${name} onInput=${(/** @type {Event} */event)=>setName(/** @type {HTMLInputElement} */(event.currentTarget).value)} onBlur=${()=>{void save();}} onKeyDown=${(/** @type {KeyboardEvent} */event)=>{if(event.key==='Enter'){event.preventDefault();void save();}else if(event.key==='Escape'){event.preventDefault();cancelledRename.current=true;setRenaming(null);}}}/>`:html`<button class="artifact-name" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere" onDblClick=${()=>rename(card)} onClick=${()=>setSelected(card.key)}>${source(card)?.displayName??card.owner.output}</button>`}
        <details><summary>${t('artifacts.sources')} (${card.sources.length})</summary>${card.sources.map((item,index)=>html`<button onClick=${()=>setSourceIndex(previous=>({...previous,[card.key]:index}))}>${item.build} · ${item.output} · ${item.displayName}</button>`)}<small>${t('artifacts.owner')}: ${card.owner.build} · ${card.owner.output}</small></details>
      </article>`)}
    </div>${loaded&&!artifacts.length&&html`<p>${t('artifacts.empty')}</p>`}${before&&html`<button disabled=${busy} onClick=${()=>{void load(true);}}>${t('artifacts.older')}</button>`}
  </section>`;
}
