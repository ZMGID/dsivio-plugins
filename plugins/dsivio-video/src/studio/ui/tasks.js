import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { update } from './state.js';
const html=htm.bind(h);
/** @typedef {import('../protocol.ts').TaskCard} Task */
/** @param {import('./comments.js').Props} props */
export function Tasks({state,api,t}) {
  const [tasks,setTasks]=useState(/** @type {readonly Task[]} */([]));
  const [filter,setFilter]=useState('all');
  const [before,setBefore]=useState(/** @type {string|undefined} */(undefined));
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const generation=useRef(0);
  async function load(older=false) {
    if(older&&(busy||!before))return;
    const current=++generation.current;setBusy(true);
    try{
      /** @type {import('../protocol.ts').TasksPage} */const page=await api.get(`/__studio/tasks?state=${filter}&limit=20${older?`&before=${encodeURIComponent(before??'')}`:''}`);
      if(current!==generation.current)return;
      setTasks(previous=>older?[...previous,...page.tasks.filter(task=>!previous.some(row=>row.id===task.id))]:page.tasks);
      setBefore(page.before);setLoaded(true);setError('');
    }catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(current===generation.current)setBusy(false);}
  }
  useEffect(()=>{if(state.library==='tasks'&&!loaded)void load();},[state.library,loaded]);
  useEffect(()=>{if(loaded)void load();},[filter]);
  useEffect(()=>()=>{generation.current++;},[]);
  const selected=tasks.find(task=>task.id===state.taskContext);
  async function copyError(){try{await navigator.clipboard.writeText(JSON.stringify(selected,null,2));}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}}
  return html`<section class="tasks-panel" aria-label=${t('tasks.title')} data-tasks-ready=${loaded?'':undefined}>
    <header><h2>${t('tasks.title')}</h2><button disabled=${busy} onClick=${()=>{void load();}}>${t('tasks.refresh')}</button><select aria-label=${t('tasks.filter')} value=${filter} onChange=${(/** @type {Event} */event)=>setFilter(/** @type {HTMLSelectElement} */(event.currentTarget).value)}><option value="all">${t('tasks.all')}</option><option value="active">${t('tasks.active')}</option><option value="ended">${t('tasks.ended')}</option></select></header>
    ${error&&html`<p role="alert">${error}</p>`}
    ${state.taskContext&&html`<nav><span>${state.taskContext}</span><button onClick=${()=>update({taskContext:null})}>${t('tasks.clear')}</button><button onClick=${()=>update({library:'artifacts'})}>${t('tasks.artifacts')}</button></nav>`}
    <div class="task-list" onScroll=${(/** @type {Event} */event)=>{const node=/** @type {HTMLElement} */(event.currentTarget);if(node.scrollTop+node.clientHeight>=node.scrollHeight-24)void load(true);}}>
      ${tasks.map(task=>html`<article key=${task.id} class=${state.taskContext===task.id?'selected':''}><button onClick=${()=>update({taskContext:task.id})}>${task.title??task.id}</button><p><strong>${t(`tasks.state.${task.state}`)}</strong> · ${task.id}</p><p>${task.runFile??''}</p>${task.error&&html`<p role="alert">${task.error}</p>`}<pre>${JSON.stringify({work:task.work,result:task.result,attention:task.attention},null,2)}</pre></article>`)}
      ${loaded&&!tasks.length&&html`<p>${t('tasks.empty')}</p>`}${before&&html`<button disabled=${busy} onClick=${()=>{void load(true);}}>${t('tasks.older')}</button>`}
    </div>${selected&&html`<details open><summary>${t('tasks.details')}</summary><button onClick=${()=>{void copyError();}}>${t('tasks.copy')}</button><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${JSON.stringify(selected,null,2)}</pre></details>`}
  </section>`;
}
