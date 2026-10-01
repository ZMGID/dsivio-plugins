import { h } from 'preact';
import htm from 'htm';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getState } from './state.js';
const html=htm.bind(h);
/** @typedef {{text:string,saved:string,version:string,viewRevision:number,saving:boolean,error:string|null,sequence:number}} Draft */
/** @type {Map<string,Draft>} */const drafts=new Map();
/** @type {Map<string,ReturnType<typeof setTimeout>>} */const timers=new Map();
/** Syntax is presentation only; saves always use the untouched original draft. @param {string} text @param {import('../companion.ts').SourceSlice|undefined} selected */
function highlighted(text,selected) {
  const tokens=text.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[\w:-]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\{[^{}\n]*\}|\b\d+(?:\.\d+)?(?:ms|px|s|f|%)?\b/g);
  /** @type {import('preact').ComponentChildren[]} */const result=[];
  /** @param {string} value @param {number} start @param {string} kind */
  function append(value,start,kind){const from=selected?.span.start??-1,to=selected?.span.end??-1,end=start+value.length;if(from<end&&to>start){const left=Math.max(0,from-start),right=Math.min(value.length,to-start);result.push(html`<span class=${kind}>${value.slice(0,left)}<mark>${value.slice(left,right)}</mark>${value.slice(right)}</span>`);}else result.push(html`<span class=${kind}>${value}</span>`);}
  let offset=0;for(const token of tokens){append(text.slice(offset,token.index),offset,'');const value=token[0];append(value,token.index,value.startsWith('<!--')?'syntax-comment':value.startsWith('<')?'syntax-tag':value.startsWith('{')?'syntax-reference':/^[\d]/.test(value)?'syntax-number':'syntax-string');offset=token.index+value.length;}append(text.slice(offset),offset,'');return result;
}
/** @param {{state:import('./state.js').AppState,api:typeof import('./api.js').api,transport:typeof import('./transport.js').transport,t:typeof import('./locale.js').t}} props */
export function Source({state,api,transport,t}) {
  const [unit,setUnit]=useState(''),[editing,setEditing]=useState(false),[wrap,setWrap]=useState(false),[tick,setTick]=useState(0);
  const editor=useRef(/** @type {HTMLTextAreaElement|null} */(null));
  const units=state.sourceUnits;const active=unit||units[0]?.unit||'';const draft=drafts.get(active);
  const redraw=()=>setTick(value=>value+1);
  /** @param {string} key */async function load(key) {
    try {
      /** @type {import('../protocol.ts').SourceResponse} */
      const response=await api.get(`/__studio/source?unit=${encodeURIComponent(key)}`);
      const old=drafts.get(key);
      if(old&&(old.saving||response.viewRevision<old.viewRevision))return;
      if(!old||old.text===old.saved){drafts.set(key,{text:response.text,saved:response.text,version:response.sourceVersion,viewRevision:response.viewRevision,saving:false,error:null,sequence:old?.sequence??0});}
      else if(old.text===response.text){old.saved=response.text;old.version=response.sourceVersion;old.viewRevision=response.viewRevision;old.error=null;}
      else if(old.version!==response.sourceVersion){old.error=t('source.conflict');}
      redraw();
    } catch(error) { const old=drafts.get(key);if(old)old.error=String(error);else drafts.set(key,{text:'',saved:'',version:'',viewRevision:0,saving:false,error:String(error),sequence:0});redraw(); }
  }
  /** @param {string} key */async function save(key) {
    clearTimeout(timers.get(key));timers.delete(key);const current=drafts.get(key);if(!current||current.saving||current.text===current.saved||!current.version)return;
    const text=current.text,sequence=current.sequence;current.saving=true;current.error=null;redraw();
    try{/** @type {import('../protocol.ts').SourceResponse} */const result=await api.write('/__studio/source',{unit:key,text,expectedSourceVersion:current.version,expectedViewRevision:getState().requestedRevision},'PUT');current.saved=text;current.version=result.sourceVersion;current.viewRevision=result.viewRevision;}catch(error){current.error=error instanceof Error?error.message:String(error);}finally{current.saving=false;redraw();if(current.sequence!==sequence&&!current.error)void save(key);}
  }
  useEffect(()=>{if(active)void load(active);},[active,state.requestedRevision]);
  useEffect(()=>{
    /** @param {KeyboardEvent} event */
    function listener(event){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'&&getState().library==='source'){event.preventDefault();void save(active);}}
    document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);
  },[active]);
  useEffect(()=>{const entity=state.view?.entities.find(entity=>entity.editorKey===state.selectedKey);const slice=entity?.sourceSlice;if(slice){if(slice.unit!==active)setUnit(slice.unit);else if(editor.current){editor.current.setSelectionRange(slice.span.start,slice.span.end);editor.current.scrollTop=Math.max(0,(slice.span.line-4)*20);}}},[state.selectedKey,active]);
  /** @param {Event} event */function input(event){const target=event.currentTarget;if(!(target instanceof HTMLTextAreaElement)||!draft)return;draft.text=target.value;draft.sequence++;draft.error=null;redraw();clearTimeout(timers.get(active));timers.set(active,setTimeout(()=>void save(active),480));}
  const lines=(draft?.text??'').split('\n');
  const selected=state.view?.entities.find(entity=>entity.editorKey===state.selectedKey)?.sourceSlice;
  const speaking=state.playing?state.view?.entities.find(entity=>entity.semanticKind==='word'&&entity.intervals.some(window=>state.frame>=window.start&&state.frame<window.end))?.sourceSlice:undefined;
  const slice=selected?.unit===active?selected:speaking?.unit===active?speaking:undefined;
  /** @param {Event} event */
  function scroll(event){if(event.currentTarget instanceof HTMLElement){const gutter=event.currentTarget.previousElementSibling;if(gutter instanceof HTMLElement)gutter.scrollTop=event.currentTarget.scrollTop;}}
  return html`<section class="source-panel" aria-label=${t('source.label')} data-source-panel>
    <div class="panel-toolbar"><select aria-label=${t('app.source')} value=${active} onChange=${/** @param {Event} event */event=>{if(event.currentTarget instanceof HTMLSelectElement)setUnit(event.currentTarget.value);}}>${units.map(source=>html`<option value=${source.unit}>${source.fileName}</option>`)}</select>
    <button onClick=${()=>{transport.pause();setEditing(!editing);}}>${t(editing?'source.read':'source.edit')}</button><button disabled=${!draft||draft.saving||draft.text===draft.saved} onClick=${()=>void save(active)}>${t('source.save')}</button></div>
    <div class="source-status"><span>${t(draft?.saving?'source.saving':draft&&draft.text!==draft.saved?'source.draft':'source.saved')}</span><label><input type="checkbox" checked=${wrap} onChange=${()=>setWrap(!wrap)}/>${t('source.wrap')}</label></div>
    ${draft?.error&&html`<div class="error" role="alert">${draft.error}</div>`}
    ${!active?html`<p class="empty">${t('source.empty')}</p>`:html`<div class="source-code"><pre class="line-numbers" aria-hidden="true">${lines.map((_,index)=>index+1).join('\n')}</pre>${editing?html`<textarea ref=${editor} aria-label=${t('source.label')} spellcheck="false" wrap=${wrap?'soft':'off'} value=${draft?.text??''} onInput=${input} onScroll=${scroll}/>`:html`<pre class=${`source-reader ${wrap?'wrapped':''}`} tabIndex="0" aria-label=${t('source.label')} onScroll=${scroll}>${highlighted(draft?.text??'',slice)}</pre>`}</div>`}
  </section>`;
}
