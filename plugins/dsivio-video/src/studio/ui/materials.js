/** @param {import('../../core/value.ts').ResourceRef} resource */
export function materialUrl(resource) { return `/__studio/material/${encodeURIComponent(resource.$resource)}`; }
/** @type {Map<string,Promise<AudioBuffer>>} */ const buffers=new Map();
/** @param {import('../../core/value.ts').ResourceRef} resource @param {BaseAudioContext} context */
export function decodeAudio(resource,context) {
  let promise=buffers.get(resource.$resource);
  if(!promise){promise=(async()=>{const response=await fetch(materialUrl(resource));if(!response.ok)throw new Error(`Audio resource ${resource.$resource}: HTTP ${response.status}`);return context.decodeAudioData(await response.arrayBuffer());})();buffers.set(resource.$resource,promise);promise.catch(()=>buffers.delete(resource.$resource));}
  return promise;
}
/** @param {AudioBuffer} buffer @param {number} [count] */
export function waveform(buffer,count=256) {
  const samples=buffer.getChannelData(0),peaks=new Float32Array(count);
  for(let bin=0;bin<count;bin++){const start=Math.floor(bin*samples.length/count),end=Math.floor((bin+1)*samples.length/count);let peak=0;for(let i=start;i<end;i++)peak=Math.max(peak,Math.abs(samples[i]??0));peaks[bin]=peak;}
  return peaks;
}
export function clearMaterials() { buffers.clear(); }
