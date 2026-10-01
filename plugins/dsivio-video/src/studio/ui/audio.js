import { decodeAudio, clearMaterials } from './materials.js';
/** @typedef {import('../../render/ir.ts').AudioClip} AudioClip */
/** @type {AudioContext|null} */let context=null;
/** @type {GainNode|null} */let master=null;
/** @type {{source:AudioBufferSourceNode,nodes:GainNode[]}[]} */const voices=[];
/** @type {Map<string,{buffer:AudioBuffer,prepared:boolean}>} */let clips=new Map();
let generation=0,muted=false;
/** Exact B(f), not a sum of rounded per-frame steps. @param {number} frame @param {import('../../timeline/types.ts').Clock} clock */
export function frameToSample48k(frame,clock) { const n=BigInt(frame)*48000n*BigInt(clock.fps.denominator),d=BigInt(clock.fps.numerator);return Number((2n*n+d)/(2n*d)); }
/** @param {import('../../render/ir.ts').GainPoint[]} points @param {number} sample */
export function curveGain(points,sample) {
  if(!points.length)return 1;
  const first=points[0],last=points.at(-1);if(!first||!last)return 1;
  if(sample<=first.sample)return first.gain;
  for(let i=1;i<points.length;i++){const b=points[i],a=points[i-1];if(a&&b&&sample<=b.sample)return a.gain+(b.gain-a.gain)*(sample-a.sample)/(b.sample-a.sample);}
  return last.gain;
}
/** @param {import('../protocol.ts').ViewRevision} view */
export async function prepareAudio(view) {
  const current=++generation;
  if(!context){context=new AudioContext({sampleRate:48000});master=context.createGain();master.gain.value=muted?0:1;master.connect(context.destination);context.addEventListener('statechange',()=>{if(context?.state==='interrupted')window.dispatchEvent(new Event('studio-audio-interrupted'));});}
  const ctx=context;
  const entries=await Promise.all(view.audioTracks.flatMap(track=>track.clips).map(async clip=>{
    const prepared=view.audioPlayback?.find(item=>item.clipKey===clip.clipKey);
    const speedOne=clip.speed.numerator===clip.speed.denominator;
    if(!speedOne&&!prepared)throw new Error(`Pitch-preserving PCM is not prepared for ${clip.clipKey}`);
    const resource=prepared?.resource??clip.source;
    const buffer=await decodeAudio(resource,ctx);
    const expected=prepared?.totalSamples??clip.sourceTotalSamples;
    if(Math.abs(buffer.duration-expected/48000)>1/ctx.sampleRate)throw new Error(`Audio decoded duration mismatch for ${clip.clipKey}`);
    return [clip.clipKey,{buffer,prepared:!!prepared}];
  }));
  if(current!==generation)return;
  clips=new Map(/** @type {[string,{buffer:AudioBuffer,prepared:boolean}][]} */(entries));
}
export function stopAudio() { for(const voice of voices){voice.source.stop();voice.source.disconnect();for(const node of voice.nodes){node.gain.cancelScheduledValues(0);node.disconnect();}}voices.length=0; }
/** @param {boolean} value */
export function muteAudio(value) { muted=value;if(master&&context)master.gain.setValueAtTime(value?0:1,context.currentTime); }
export function isMuted() { return muted; }
export function audioTime() { return context?.currentTime??0; }
/** @param {import('../protocol.ts').ViewRevision} view @param {number} frame */
export async function startAudio(view,frame) {
  if(!context||!master)throw new Error('Audio is not prepared');
  await context.resume();if(context.state!=='running')throw new Error('AudioContext could not resume');
  stopAudio();
  const ctx=context,anchor=ctx.currentTime+0.025,startSample=frameToSample48k(frame,view.clock);
  for(const track of view.audioTracks)for(const clip of track.clips){
    if(clip.targetSamples.end<=startSample)continue;
    const decoded=clips.get(clip.clipKey);if(!decoded)throw new Error(`Missing decoded AudioTrack clip ${clip.clipKey}`);
    const begin=Math.max(startSample,clip.targetSamples.start),end=clip.targetSamples.end;
    let duration=(end-begin)/48000;
    const when=anchor+(begin-startSample)/48000;
    const source=ctx.createBufferSource();source.buffer=decoded.buffer;source.playbackRate.value=1;
    const fixed=ctx.createGain(),curve=ctx.createGain(),mask=ctx.createGain(),fadeIn=ctx.createGain(),fadeOut=ctx.createGain();
    fixed.gain.value=clip.gain;curve.gain.setValueAtTime(curveGain(clip.gainCurve,begin),when);
    for(const point of clip.gainCurve)if(point.sample>begin&&point.sample<=end)curve.gain.linearRampToValueAtTime(point.gain,when+(point.sample-begin)/48000);
    const windows=clip.audible??[clip.targetSamples];mask.gain.setValueAtTime(windows.some(window=>begin>=window.start&&begin<window.end)?1:0,when);
    for(const window of windows){if(window.start>begin)mask.gain.setValueAtTime(1,when+(window.start-begin)/48000);if(window.end>begin)mask.gain.setValueAtTime(0,when+(window.end-begin)/48000);}
    const position=begin-clip.targetSamples.start,length=clip.targetSamples.end-clip.targetSamples.start;
    fadeIn.gain.setValueAtTime(clip.fadeInSamples?Math.min(1,position/clip.fadeInSamples):1,when);
    if(clip.fadeInSamples>position)fadeIn.gain.linearRampToValueAtTime(1,when+(clip.fadeInSamples-position)/48000);
    const fadeStart=length-clip.fadeOutSamples;
    fadeOut.gain.setValueAtTime(clip.fadeOutSamples?Math.min(1,(length-position)/clip.fadeOutSamples):1,when);
    if(clip.fadeOutSamples){if(position<fadeStart)fadeOut.gain.setValueAtTime(1,when+(fadeStart-position)/48000);fadeOut.gain.linearRampToValueAtTime(0,when+duration);}
    source.connect(fixed).connect(curve).connect(mask).connect(fadeIn).connect(fadeOut).connect(master);
    let offset=position/48000;
    if(!decoded.prepared){const trim=clip.sourceSamples;const size=trim.end-trim.start;offset=(trim.start+(clip.loop?(position+clip.loop.phaseSamples)%size:position))/48000;if(clip.loop){source.loop=true;source.loopStart=trim.start/48000;source.loopEnd=trim.end/48000;}else{duration=Math.min(duration,Math.max(0,(trim.end/48000)-offset));}}
    if(duration>0){voices.push({source,nodes:[fixed,curve,mask,fadeIn,fadeOut]});source.start(when,offset,duration);}
    else {source.disconnect();for(const node of [fixed,curve,mask,fadeIn,fadeOut])node.disconnect();}
  }
  return {time:anchor,sample:startSample};
}
export async function disposeAudio() { ++generation;stopAudio();clips.clear();clearMaterials();await context?.close();context=null;master=null; }
