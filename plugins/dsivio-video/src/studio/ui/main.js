import { h, render } from 'preact';
import { Shell } from './shell.js';
import { connect, disconnect } from './api.js';
import { loadLocales } from './locale.js';
import { update } from './state.js';
import { installShortcuts, pause } from './transport.js';
import { disposeAudio } from './audio.js';
const root=document.getElementById('app');
if(!root)throw new Error('Studio app root is missing');
try {
  await loadLocales();const theme=localStorage.getItem('dsivio-video.studio.theme');if(theme==='dark'||theme==='light')update({theme});
  render(h(Shell,{}),root);installShortcuts();
  window.addEventListener('hashchange',()=>update({page:location.hash==='#comments'?'comments':'studio'}));
  await connect();
} catch(error) { render(h('div',{class:'error',role:'alert'},error instanceof Error?error.message:String(error)),root); }
window.addEventListener('pagehide',()=>{pause();disconnect();void disposeAudio();});
