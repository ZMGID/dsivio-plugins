import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { createPreviewBridge } from './transport.js';
const html = htm.bind(h);
/** @typedef {import('../protocol.ts').NumberedComment} Comment */
/** @typedef {{state:import('./state.js').AppState,api:typeof import('./api.js').api,transport:typeof import('./transport.js').transport,t:(key:string,vars?:Record<string,unknown>)=>string}} Props */
/** @param {Props} props */
export function Comments({state,api,transport,t}) {
  const [comments,setComments] = useState(/** @type {readonly Comment[]} */([]));
  const [filter,setFilter] = useState('open');
  const [draft,setDraft] = useState('');
  const [at,setAt] = useState(0);
  const [editing,setEditing] = useState(/** @type {Comment|null} */(null));
  const [selected,setSelected] = useState(/** @type {string|null} */(null));
  const [error,setError] = useState('');
  const [loaded,setLoaded] = useState(false);
  const [busy,setBusy] = useState(false);
  const [hoverFrame,setHoverFrame] = useState(/** @type {number|null} */(null));
  const preview = useRef(/** @type {HTMLIFrameElement|null} */(null));
  const hoverBridge = useRef(/** @type {import('./transport.js').PreviewBridge|null} */(null));
  const hoverTarget = useRef(0);
  const captured = useRef(false);
  const sequence = useRef(0);
  const view = state.view;
  const seconds = view ? state.frame * view.clock.fps.denominator / view.clock.fps.numerator : 0;
  async function load() {
    const request = ++sequence.current;
    try {
      /** @type {import('../protocol.ts').CommentsList} */ const list = await api.get('/__studio/comments');
      if (request !== sequence.current) return;
      setComments(list.comments); setLoaded(true); setError('');
    } catch (cause) { if(request===sequence.current) setError(cause instanceof Error?cause.message:String(cause)); }
  }
  useEffect(()=>{ void load(); const refresh=()=>{void load();}; window.addEventListener('studio-comments-changed',refresh); return ()=>{sequence.current++;window.removeEventListener('studio-comments-changed',refresh);}; },[state.session]);
  useEffect(()=>{if(state.page!=='comments')setHoverFrame(null);},[state.page]);
  useEffect(()=>{const clear=/** @param {PointerEvent} event */event=>{if(!(event.target instanceof Element)||!event.target.closest('.comments-list article'))setSelected(null);};document.addEventListener('pointerdown',clear);return()=>document.removeEventListener('pointerdown',clear);},[]);
  useEffect(()=>{if(hoverFrame===null||state.page!=='comments'||state.status!=='ready'){hoverBridge.current?.close();hoverBridge.current=null;}},[hoverFrame,state.page,state.status]);
  useEffect(()=>()=>{hoverBridge.current?.close();hoverBridge.current=null;},[]);
  /** @param {number} frame */
  function hoverSeek(frame) {
    hoverTarget.current=frame;setHoverFrame(frame);
    const bridge=hoverBridge.current;
    if(bridge)void bridge.ready.then(()=>bridge===hoverBridge.current?bridge.seekFrame(hoverTarget.current):undefined).catch(cause=>{if(bridge===hoverBridge.current)setError(cause instanceof Error?cause.message:String(cause));});
  }
  /** @param {Comment} comment */
  function locate(comment) {
    setSelected(comment.id);transport.pause();
    if(!view)return;
    const frame=Math.round(comment.at*view.clock.fps.numerator/view.clock.fps.denominator);
    if(frame>=view.totalFrames)setError(t('comments.outside'));
    void transport.seekFrame(Math.min(view.totalFrames-1,frame));
  }
  async function submit() {
    if(busy||!draft.trim())return;
    setBusy(true);
    try {
      /** @type {import('../protocol.ts').CommentsList} */ const list=editing
        ? await api.write(`/__studio/comments/${encodeURIComponent(editing.id)}`,{expectedComment:editing.expectedComment,changes:{text:draft,at}},'PUT')
        : await api.write('/__studio/comments',{comment:{id:`comment_${crypto.randomUUID()}`,at,text:draft,resolved:false}});
      setComments(list.comments);setDraft('');setEditing(null);captured.current=false;setError('');
    } catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  /** @param {Comment} comment @param {'resolve'|'delete'} action */
  async function change(comment,action) {
    if(busy)return;setBusy(true);
    try {
      /** @type {import('../protocol.ts').CommentsList} */ const list=await api.write(`/__studio/comments/${encodeURIComponent(comment.id)}`,{expectedComment:comment.expectedComment,...(action==='resolve'?{changes:{resolved:!comment.resolved}}:{})},action==='resolve'?'PUT':'DELETE');
      setComments(list.comments);setError('');if(action==='delete'&&selected===comment.id)setSelected(null);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}
  }
  /** @param {Comment} comment */
  function edit(comment){transport.pause();setEditing(comment);setDraft(comment.text);setAt(comment.at);captured.current=true;setSelected(comment.id);}
  /** @param {KeyboardEvent} event */
  function keydown(event){if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void submit();}}
  const visible=comments.filter(comment=>filter==='all'||!!comment.resolved===(filter==='resolved'));
  return html`<section class="comments-panel" aria-label=${t('comments.title')} data-comments-ready=${loaded?'':undefined} onClick=${()=>setSelected(null)}>
    <header><h2>${t('comments.title')}</h2><select aria-label=${t('comments.filter')} value=${filter} onChange=${(/** @type {Event} */event)=>setFilter(/** @type {HTMLSelectElement} */(event.currentTarget).value)}><option value="open">${t('comments.open')}</option><option value="resolved">${t('comments.resolved')}</option><option value="all">${t('comments.all')}</option></select></header>
    ${error&&html`<p role="alert">${error}</p>`}
    <div class="comments-list">${visible.map(comment=>html`<article key=${comment.id} class=${selected===comment.id?'selected':''} onClick=${(/** @type {MouseEvent} */event)=>{event.stopPropagation();locate(comment);}}>
      <button class="comment-time" title=${comment.id}>#${comment.number} · ${comment.at.toFixed(3)}s</button><p style="white-space:pre-wrap">${comment.text}</p>
      <small>${comment.id}</small><div><button disabled=${busy} onClick=${(/** @type {MouseEvent} */event)=>{event.stopPropagation();edit(comment);}}>${t('comments.edit')}</button><button disabled=${busy} onClick=${(/** @type {MouseEvent} */event)=>{event.stopPropagation();void change(comment,'resolve');}}>${t(comment.resolved?'comments.reopen':'comments.resolve')}</button><button disabled=${busy} onClick=${(/** @type {MouseEvent} */event)=>{event.stopPropagation();void change(comment,'delete');}}>${t('comments.delete')}</button></div>
    </article>`)}${loaded&&!visible.length&&html`<p>${t('comments.empty')}</p>`}</div>
    <form onSubmit=${(/** @type {SubmitEvent} */event)=>{event.preventDefault();void submit();}} onClick=${(/** @type {MouseEvent} */event)=>event.stopPropagation()}>
      <button type="button" class="time-chip" onClick=${()=>{transport.pause();setAt(seconds);captured.current=true;}} title=${t('comments.capture')}>${at.toFixed(3)}s · ${t('comments.capture')}</button>
      <textarea aria-label=${t('comments.draft')} value=${draft} placeholder=${t('comments.placeholder')} onFocus=${()=>{transport.pause();if(!captured.current){setAt(seconds);captured.current=true;}}} onInput=${(/** @type {Event} */event)=>setDraft(/** @type {HTMLTextAreaElement} */(event.currentTarget).value)} onKeyDown=${keydown}></textarea>
      <button type="submit" disabled=${busy||!draft.trim()}>${t(editing?'comments.save':'comments.send')}</button>${editing&&html`<button type="button" onClick=${()=>{setEditing(null);setDraft('');captured.current=false;}}>${t('comments.cancel')}</button>`}<small>${t('comments.hint')}</small>
    </form>
    ${view&&html`<div class="comment-progress" onPointerLeave=${()=>setHoverFrame(null)}><input type="range" min="0" max=${view.totalFrames-1} value=${state.frame} aria-label=${t('comments.progress')} onInput=${(/** @type {Event} */event)=>{void transport.seekFrame(Number(/** @type {HTMLInputElement} */(event.currentTarget).value));}} onPointerMove=${(/** @type {PointerEvent} */event)=>{const rect=/** @type {HTMLInputElement} */(event.currentTarget).getBoundingClientRect();hoverSeek(Math.max(0,Math.min(view.totalFrames-1,Math.round((event.clientX-rect.left)/rect.width*(view.totalFrames-1)))));}}/>
      ${hoverFrame!==null&&state.page==='comments'&&state.status==='ready'&&html`<div style=${`width:240px;height:${240*view.document.extent.heightPx/view.document.extent.widthPx}px;overflow:hidden`}><iframe ref=${preview} sandbox="allow-scripts" title=${t('comments.hover')} src=${`/__studio/preview?revision=${view.viewRevision}`} style=${`width:${view.document.extent.widthPx}px;height:${view.document.extent.heightPx}px;transform-origin:top left;transform:scale(${240/view.document.extent.widthPx});pointer-events:none;border:0`} onLoad=${()=>{hoverBridge.current?.close();if(preview.current){hoverBridge.current=createPreviewBridge(preview.current);hoverSeek(hoverTarget.current);}}}></iframe></div>`}</div>`}
  </section>`;
}
