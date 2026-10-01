import { acceptServerState, getState, update } from './state.js';
import { t } from './locale.js';
/** @type {string} */ let token='';
/** @type {EventSource|null} */ let events=null;
export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status,code,message) { super(message); this.name='ApiError'; this.status=status; this.code=code; }
}
/** @template T @param {string} path @param {RequestInit} [options] @returns {Promise<T>} */
async function request(path,options={}) {
  const response=await fetch(path.startsWith('/')?path:`/__studio/${path}`,{...options,cache:'no-store'});
  const data=await response.json();
  if (!response.ok) throw new ApiError(response.status,data.code??'STUDIO_HTTP_ERROR',data.message??response.statusText);
  return data;
}
export const api = {
  /** @template T @param {string} path @returns {Promise<T>} */
  get(path) { return request(path); },
  /** @template T @param {string} path @param {unknown} payload @param {string} [method] @returns {Promise<T>} */
  write(path,payload,method='POST') { return request(path,{method,headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(payload)}); }
};
export async function connect() {
  /** @type {import('../protocol.ts').Bootstrap} */ const bootstrap=await api.get('/__studio/bootstrap');
  if (bootstrap.protocol!=='dsivio-video.studio/1') throw new Error('Unsupported Studio protocol');
  token=bootstrap.token;
  update({session:bootstrap.sessionId}); acceptServerState(bootstrap.state);
  events=new EventSource('/__studio/events');
  for (const name of ['compiling','view','compile-error','comments-changed']) events.addEventListener(name, event=>{
    const payload=JSON.parse(/** @type {MessageEvent} */(event).data);
    if (payload.sessionId!==getState().session) return;
    if (payload.state) acceptServerState(payload.state);
    else if (name==='view' && payload.view) acceptServerState({requestedRevision:payload.view.viewRevision,publishedRevision:payload.view.viewRevision,dirty:false,status:'ready',view:payload.view});
    if (name==='comments-changed') window.dispatchEvent(new CustomEvent('studio-comments-changed',{detail:payload}));
  });
  events.onopen=async()=>{ try { acceptServerState(await api.get('/__studio/view'));update({notice:null}); } catch(error) { update({notice:error instanceof Error?error.message:String(error)}); } };
  events.onerror=()=>update({notice:t('app.reconnecting')});
}
export function disconnect() { events?.close(); events=null; token=''; }
