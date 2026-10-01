import { useEffect, useState } from 'preact/hooks';
/** @typedef {import('../protocol.ts').ViewRevision} ViewRevision */
/** @typedef {{kind:'image'|'video'|'audio',url:string,name:string}} FilePreview */
/** @typedef {{view:ViewRevision|null,sourceUnits:readonly import('../protocol.ts').SourceUnit[],session:string,status:'compiling'|'ready'|'error',requestedRevision:number,publishedRevision:number,dirty:boolean,error:import('../protocol.ts').StudioDiagnostic|null,frame:number,playing:boolean,selectedKey:string|null,locale:'en'|'zh-CN',theme:'dark'|'light',page:'studio'|'comments',library:'source'|'tasks'|'artifacts',filePreview:FilePreview|null,taskContext:string|null,mediaReady:boolean,audioError:string|null,notice:string|null}} AppState */
/** @type {AppState} */
let state = {view:null,sourceUnits:[],session:'',status:'compiling',requestedRevision:0,publishedRevision:0,dirty:true,error:null,frame:0,playing:false,selectedKey:null,locale:'en',theme:'dark',page:location.hash === '#comments'?'comments':'studio',library:'source',filePreview:null,taskContext:null,mediaReady:false,audioError:null,notice:null};
/** @type {Set<(state:AppState)=>void>} */
const listeners = new Set();
export function getState() { return state; }
/** @param {(state:AppState)=>void} listener */
export function subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** @param {Partial<AppState>} patch */
export function update(patch) { state = {...state,...patch}; for (const listener of listeners) listener(state); }
/** @param {string|null} editorKey */
export function select(editorKey) { update({selectedKey:editorKey,filePreview:null}); }
/** @param {AppState['page']} page */
export function setPage(page) { location.hash = page==='comments'?'comments':''; update({page}); }
/** @param {AppState['library']} library */
export function setLibrary(library) { update({library}); }
export function useStudioState() { const [snapshot,setSnapshot]=useState(state); useEffect(()=>{setSnapshot(state);return subscribe(setSnapshot);},[]); return snapshot; }
/** @param {import('../protocol.ts').StudioState} next */
export function acceptServerState(next) {
  if (next.requestedRevision < state.requestedRevision) return;
  const view = next.view && (!state.view || next.view.viewRevision > state.view.viewRevision) ? next.view : state.view;
  const changed = view !== state.view;
  const selectedKey = view?.entities.some(entity=>entity.editorKey===state.selectedKey)?state.selectedKey:null;
  update({status:next.status,dirty:next.dirty,requestedRevision:next.requestedRevision,publishedRevision:next.publishedRevision,error:next.error??null,view,sourceUnits:next.sourceUnits??next.view?.sourceUnits??state.sourceUnits,playing:changed||next.status!=='ready'?false:state.playing,frame:Math.min(state.frame,Math.max(0,(view?.totalFrames??1)-1)),selectedKey,mediaReady:changed?false:state.mediaReady});
}
