import { DvError } from "../../core/errors.ts";
import type { Binding, ModuleDef, ProducerInputs } from "../../core/module.ts";
import { canonicalJson, isPending } from "../../core/value.ts";
import type { Json, Value } from "../../core/value.ts";
import { renderTypes } from "../../render/ir.ts";
import type { Composition } from "../../render/ir.ts";
import type { Timeline } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { compileDocument } from "../../render/document.ts";
import { bounds, clock, extent, integer, object, resource, validateDocument } from "../../render/validate.ts";
import { validateAudioRequest } from "../../render/audio.ts";
import { validateMuxRequest } from "../../render/mux.ts";
import { videoType } from "../media/index.ts";
const MODULE="dsivio-video/render@1";
function data(inputs:ProducerInputs,name:string):Json {const value=inputs[name];if(!value||Array.isArray(value)||isPending(value))throw new DvError("PRODUCER_INPUT_INVALID",`Missing concrete ${name}`);return value.data;}
function videoShape(raw:unknown):void {const v=object(raw);resource(v.resource);const ref=object(v.resource);if(ref.mime!=="video/mp4"||ref.bytes===0)throw new DvError("TYPE_INVALID","Video delivery requires nonempty MP4 bytes");clock(v.clock);integer(v.totalFrames,1);extent(v.extent);}
const render:ModuleDef={id:MODULE,summary:"Compile visual documents, render silent frames and sample-exact audio, and mux MP4 delivery.",types:{
  RenderDocument:{summary:"Pure compiled HTML with exact integer domain and resource dependencies.",validate:validateDocument},
  SilentVideo:{summary:"Probed silent H.264 video.",validate:videoShape},
  MixedAudio:{summary:"Exact rebased 48 kHz stereo PCM WAV.",validate(raw){const v=object(raw);resource(v.resource);const ref=object(v.resource);if(ref.mime!=="audio/wav"||ref.bytes===0)throw new DvError("TYPE_INVALID","Mixed audio requires nonempty WAV bytes");integer(v.totalSamples,1);}},
  FinalVideo:{summary:"Muxed H.264/AAC with planned presentation samples.",validate(raw){videoShape(raw);integer(object(raw).presentationSamples48k,1);}},
  CapturedFrames:{summary:"Original frame indexes with full-canvas PNG resources.",validate(raw){const v=object(raw);if(!Array.isArray(v.frames)||!v.frames.length)throw new DvError("TYPE_INVALID","Expected captured frames");let last=-1;for(const raw of v.frames){const f=object(raw);integer(f.frame);resource(f.resource);const ref=object(f.resource);if(ref.mime!=="image/png"||ref.bytes===0)throw new DvError("TYPE_INVALID","Captured frames require nonempty PNG resources");if(f.frame<=last)throw new DvError("TYPE_INVALID","Frame indexes must increase");last=f.frame;}}},
  FrameRange:{summary:"Nonempty original-program half-open frame boundaries.",validate:bounds},
  Quality:{summary:"draft, standard or high.",validate(raw){if(!["draft","standard","high"].includes(String(raw)))throw new DvError("TYPE_INVALID","Invalid render quality");}},
},surfaces:{Video:{mode:"structured",doc:{summary:"Render a Film Composition to an MP4 resource on the identical Timeline.",attributes:[{name:"id",required:true,accepts:"text",summary:"Output identity."},{name:"composition",required:true,accepts:renderTypes.composition,summary:"Film composition."},{name:"timeline",required:true,accepts:timelineTypes.timeline,summary:"Identical program timeline."},{name:"start-frame",required:false,accepts:"text",summary:"Original inclusive frame; paired with end."},{name:"end-frame-exclusive",required:false,accepts:"text",summary:"Original exclusive end frame; paired with start."}],outputs:[{name:"video",type:videoType,summary:"Final MP4 bytes."}]},elaborate(element,ctx){
  if(element.kind!=="element")return ctx.fail("MARKUP_ELEMENT","Video must be structured",element.span);
  if(element.children.some(c=>c.kind!=="text"||c.text.trim()))return ctx.fail("MARKUP_CHILD","Video must be empty",element.span);
  const attrs=new Map(element.attributes.map(a=>[a.name,a]));if(attrs.size!==element.attributes.length)return ctx.fail("MARKUP_ATTRIBUTE","Duplicate Video attribute",element.span);for(const name of attrs.keys())if(!["id","composition","timeline","start-frame","end-frame-exclusive"].includes(name))return ctx.fail("MARKUP_ATTRIBUTE",`Unknown Video attribute ${name}`,element.span);
  const id=attrs.get("id");if(!id||id.value.kind!=="literal"||!id.value.text)return ctx.fail("MARKUP_ATTRIBUTE","Video id is required",element.span);
  const bindings:Record<string,Binding>={};for(const [name,type] of [["composition",renderTypes.composition],["timeline",timelineTypes.timeline]] as const){const attr=attrs.get(name);if(!attr||attr.value.kind!=="ref")return ctx.fail("MARKUP_REFERENCE",`${name} requires a typed reference`,element.span);const binding=ctx.lookup(attr.value.name,attr.span);if(binding.type!==type)return ctx.fail("MARKUP_REFERENCE",`${name} requires ${type}`,attr.span);bindings[name]=binding;}
  const start=attrs.get("start-frame");const end=attrs.get("end-frame-exclusive");if(Boolean(start)!==Boolean(end))return ctx.fail("MARKUP_ATTRIBUTE","Render range attributes must be paired",element.span);if(start&&end){if(start.value.kind!=="literal"||end.value.kind!=="literal"||!/^\d+$/.test(start.value.text)||!/^\d+$/.test(end.value.text))return ctx.fail("MARKUP_ATTRIBUTE","Frame range requires nonnegative integer text",element.span);const range={start:Number(start.value.text),end:Number(end.value.text)};bounds(range);bindings.range=ctx.record(null,{type:renderTypes.range,data:range},element.span);}
  const range=ctx.operation({producer:`${MODULE}#range`,inputs:bindings,publish:{},label:`${id.value.text}:range`,span:element.span}).range!;
  const document=ctx.operation({producer:`${MODULE}#document`,inputs:{composition:bindings.composition!},publish:{},label:`${id.value.text}:document`,span:element.span}).document!;
  const quality=ctx.record(null,{type:renderTypes.quality,data:"standard"},element.span);
  const visual=ctx.operation({producer:`${MODULE}#visual`,inputs:{document,range,quality},publish:{},label:`${id.value.text}:visual`,span:element.span}).visual!;
  const audio=ctx.operation({producer:`${MODULE}#audio`,inputs:{composition:bindings.composition!,range},publish:{},label:`${id.value.text}:audio`,span:element.span}).audio!;
  const final=ctx.operation({producer:`${MODULE}#mux`,inputs:{visual,audio},publish:{},label:`${id.value.text}:mux`,span:element.span}).final!;
  ctx.operation({producer:`${MODULE}#video`,inputs:{final},publish:{video:`${id.value.text}.video`},label:id.value.text,span:element.span});
}}},producers:{
  range:{inputs:{composition:{type:renderTypes.composition},timeline:{type:timelineTypes.timeline},range:{type:renderTypes.range,optional:true}},outputs:{range:renderTypes.range},run(inputs){const composition=data(inputs,"composition") as unknown as Composition;const timeline=data(inputs,"timeline") as unknown as Timeline;if(composition.domain.axisKey!==timeline.axisKey||composition.domain.totalFrames!==timeline.totalFrames||canonicalJson(composition.domain.clock)!==canonicalJson(timeline.clock))throw new DvError("RENDER_DOMAIN_MISMATCH","Composition and Timeline must have identical axis, clock and total frames");const range=inputs.range?data(inputs,"range"):{start:0,end:timeline.totalFrames};bounds(range,timeline.totalFrames);return {outputs:{range:{type:renderTypes.range,data:range}}};}},
  document:{inputs:{composition:{type:renderTypes.composition}},outputs:{document:renderTypes.document},run(inputs){const composition=data(inputs,"composition") as unknown as Composition;return {outputs:{document:{type:renderTypes.document,data:compileDocument(composition) as unknown as Json}}};}},
  visual:{inputs:{document:{type:renderTypes.document},range:{type:renderTypes.range},quality:{type:renderTypes.quality}},outputs:{visual:renderTypes.silentVideo},run(inputs){return {needs:{visual:{capability:"local/render-visual",request:{document:data(inputs,"document"),frames:data(inputs,"range"),quality:data(inputs,"quality")}}}};}},
  audio:{inputs:{composition:{type:renderTypes.composition},range:{type:renderTypes.range}},outputs:{audio:renderTypes.mixedAudio},run(inputs){const c=data(inputs,"composition") as unknown as Composition;const request={domain:c.domain,tracks:c.audioTracks,frames:data(inputs,"range")};validateAudioRequest(request);return {needs:{audio:{capability:"local/render-audio",request:request as unknown as Json}}};}},
  mux:{inputs:{visual:{type:renderTypes.silentVideo},audio:{type:renderTypes.mixedAudio}},outputs:{final:renderTypes.finalVideo},run(inputs){const request={visual:data(inputs,"visual"),audio:data(inputs,"audio")};validateMuxRequest(request);return {needs:{final:{capability:"local/mux",request}}};}},
  video:{inputs:{final:{type:renderTypes.finalVideo}},outputs:{video:videoType},run(inputs){const final=object(data(inputs,"final"));resource(final.resource);return {outputs:{video:{type:videoType,data:final.resource as Json}}};}},
}};
export default render;
