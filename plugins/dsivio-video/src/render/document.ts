import { DvError } from "../core/errors.ts";
import { canonicalJson } from "../core/value.ts";
import type { Json, ResourceRef } from "../core/value.ts";
import type { FontFace } from "../fonts/types.ts";
import type { Bounds } from "../timeline/types.ts";
import { VISUAL_IR_VERSION } from "./ir.ts";
import type { Composition, Present, RenderDocument, ResourceUsage, Surface, TextFormat, VisualNode } from "./ir.ts";
import { validateComposition } from "./composition.ts";
import { runtimeSource } from "./runtime.ts";
import { fontFamilyName } from "./text-runtime.ts";
export function escapeHtml(value: string): string { return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
export function resourceUrl(ref: ResourceRef): string { return `dv-resource://${encodeURIComponent(ref.$resource)}`; }
export function compileDocument(composition: Composition): RenderDocument {
  validateComposition(composition);
  const usage = new Map<string,ResourceUsage>(); const faces = new Map<string,FontFace>(); const surfaces: Surface[]=[];
  function add(ref:ResourceRef,frames?:Bounds[]) { const old=usage.get(ref.$resource); if(old&&canonicalJson({...old.resource})!==canonicalJson({...ref}))throw new DvError("RESOURCE_CONFLICT",`Conflicting declarations for ${ref.$resource}`);if(!frames||old?.required==="global")usage.set(ref.$resource,{resource:ref,required:"global"});else usage.set(ref.$resource,{resource:ref,required:"windows",frames:[...(old?.required==="windows"?old.frames:[]),...frames]}); }
  function format(format:TextFormat) { for(const face of format.fonts.faces){const old=faces.get(face.faceKey);if(old&&canonicalJson(old as unknown as Json)!==canonicalJson(face as unknown as Json))throw new DvError("FONT_CONFLICT",`Conflicting face ${face.faceKey}`);faces.set(face.faceKey,face);for(const shard of face.shards)add(shard.resource);} }
  const all=composition.visualTracks.flatMap(t=>t.presents.map(p=>({p,track:t.trackKey}))).sort((a,b)=>a.p.layer-b.p.layer||a.p.layerKey.localeCompare(b.p.layerKey)||a.p.lifetime.start-b.p.lifetime.start||a.track.localeCompare(b.track)||a.p.presentKey.localeCompare(b.p.presentKey));
  const metadata:{id:string;lifetime:Bounds;visible?:Bounds[];nodes:{id:string;node:VisualNode}[]}[]=[];const css:string[]=[];
  const body=all.map(({p},index)=>{
    const pid=`dvp${index}`;const ids=new Map(p.nodes.map((n,i)=>[n.nodeKey,`dvn${index}_${i}`])); const entries=p.nodes.map(n=>({id:ids.get(n.nodeKey)!,node:n})); metadata.push({id:pid,lifetime:p.lifetime,...(p.visible===undefined?{}:{visible:p.visible}),nodes:entries});
    const windows=p.visible??[p.lifetime];
    for(const n of p.nodes){if(n.kind==="image"||n.kind==="video")add(n.resource,windows);if(n.kind==="surface"){add(n.surface.resource,windows);surfaces.push(n.surface);}if(n.kind==="text")format(n.format);if(n.kind==="text-flow"||n.kind==="path-text"){format(n.flow.format);for(const para of n.flow.paragraphs){if(para.format)format(para.format);for(const run of para.runs)if(run.kind==="run"&&run.format)format(run.format);}}if(n.kind==="program"){for(const r of n.program.resources)add(r);css.push(`@scope (#${ids.get(n.nodeKey)}) {${n.program.css}}`);} }
    function nodeHtml(n:VisualNode):string {
      const id=ids.get(n.nodeKey)!;const style=escapeHtml(n.style.map(d=>`${d.property}:${d.value}`).join(";"));const attrs=n.attributes.map(a=>`${a.name}="${escapeHtml(a.value)}"`).join(" ");const children=p.nodes.filter(c=>c.parentKey===n.nodeKey).sort((a,b)=>a.order-b.order);
      const common=`id="${id}" data-dv-node="${escapeHtml(n.nodeKey)}" style="${style}" ${attrs}`;
      if(n.kind==="image"||n.kind==="surface"&&n.surface.timing.kind==="still") {const ref=n.kind==="image"?n.resource:n.surface.resource;return `<img ${common} data-dv-src="${resourceUrl(ref)}">`;}
      if(n.kind==="video"||n.kind==="surface"&&n.surface.timing.kind==="frames"){const ref=n.kind==="video"?n.resource:n.surface.resource;return `<img ${common} data-dv-video-resource="${escapeHtml(ref.$resource)}" data-dv-source="${resourceUrl(ref)}">`;}
      if(n.kind==="mask") {const mask=children.find(c=>c.nodeKey===n.maskRootKey)!;const content=children.find(c=>c.nodeKey===n.contentRootKey)!;return `<div ${common} data-dv-mask-mode="${n.mode}"><div id="${id}_source" data-dv-mask-source style="position:absolute;inset:0;visibility:hidden">${nodeHtml(mask)}</div><div id="${id}_content" data-dv-mask-content style="position:absolute;inset:0">${nodeHtml(content)}</div></div>`;}
      const content=n.kind==="program"?n.program.html.replace(/\{\{([^{}]+)\}\}/g,(_m,key:string)=>nodeHtml(children.find(c=>c.nodeKey===key)!)):children.map(nodeHtml).join("");return `<div ${common}>${content}</div>`;
    }
    return `<div id="${pid}" data-dv-present="${escapeHtml(p.presentKey)}" style="position:absolute;inset:0;visibility:hidden">${nodeHtml(p.nodes.find(n=>n.nodeKey===p.rootKey)!)}</div>`;
  }).join("");
  const fontCss=[...faces.values()].flatMap(face=>face.shards.map(shard=>`@font-face{font-family:'${fontFamilyName(face.faceKey)}';font-weight:${face.weight};font-style:${face.style};font-display:block;src:url('${resourceUrl(shard.resource)}') format('woff2');unicode-range:${shard.unicodeRange};}`)).join("");
  const pageData={clock:composition.domain.clock,totalFrames:composition.domain.totalFrames,presents:metadata};const json=canonicalJson(pageData as unknown as Json).replace(/</g,"\\u003c");const duration=composition.domain.totalFrames*composition.domain.clock.fps.denominator/composition.domain.clock.fps.numerator;
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000;overflow:hidden}*{box-sizing:border-box}img{display:block}#composition{position:relative;overflow:hidden;width:${composition.extent.widthPx}px;height:${composition.extent.heightPx}px;background:${composition.background}}${fontCss}${css.join("\n")}</style></head><body><div id="composition" data-no-timeline data-composition-id="${escapeHtml(composition.compositionKey)}" data-duration="${duration}" data-dv-fps-numerator="${composition.domain.clock.fps.numerator}" data-dv-fps-denominator="${composition.domain.clock.fps.denominator}" data-dv-total-frames="${composition.domain.totalFrames}" data-width="${composition.extent.widthPx}" data-height="${composition.extent.heightPx}">${body}</div><script>window.__dvDocument=${json};${runtimeSource().replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
  return {version:VISUAL_IR_VERSION,compositionKey:composition.compositionKey,domain:composition.domain,extent:composition.extent,resources:[...usage.values()],surfaces,html};
}
