import { DvError } from "../core/errors.ts";
import type { CapabilityDef, Resolution } from "../core/capability.ts";
import { isPending } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import { renderTypes } from "./ir.ts";
import { renderVisual, validateVisualRequest } from "./visual.ts";
import { captureFrames } from "./frames.ts";
import { array, extent, integer, object, validateDocument, validateDomain } from "./validate.ts";
import type { FrameCaptureRequest } from "./requests.ts";
import { audioCapability } from "./audio.ts";
import { muxCapability } from "./mux.ts";
import { locateBrowser } from "./browser.ts";
function containsPending(data:Json):boolean {
  if(isPending(data))return true;
  if(Array.isArray(data))return data.some(containsPending);
  return data!==null&&typeof data==="object"&&Object.values(data).some(containsPending);
}
export function validateFrameRequest(data:unknown):asserts data is FrameCaptureRequest {
  const r=object(data);const input=object(r.input);let total:number;
  if(input.kind==="document"){validateDocument(input.document);total=input.document.domain.totalFrames;}
  else if(input.kind==="html"){const project=object(input.project);validateDomain(project.domain);extent(project.extent);if(typeof project.html!=="string")throw new DvError("TYPE_INVALID","Missing HTML");array(project.resources);total=project.domain.totalFrames;}
  else throw new DvError("TYPE_INVALID","Expected document or HTML capture input");
  const frames=array(r.frames);if(!frames.length)throw new DvError("RENDER_FRAMES_INVALID","Nonempty frame list required");let last=-1;for(const frame of frames){integer(frame);if(frame<=last||frame>=total)throw new DvError("RENDER_FRAMES_INVALID","Frames must be strictly increasing and in domain");last=frame;}
}
export const visualCapability:CapabilityDef={name:"local/render-visual",returns:renderTypes.silentVideo,async resolve(request):Promise<Resolution>{try{if(containsPending(request))return {ok:true,request,backend:"local",cost:"local",summary:{operation:"render-visual",browser:"pending"}};validateVisualRequest(request);const browser=await locateBrowser("render");return {ok:true,request,backend:"local",cost:"local",summary:{operation:"render-visual",browserPath:browser.path,browserVersion:browser.version,workers:1}};}catch(cause){if(cause instanceof DvError)return {ok:false,code:cause.code,reason:cause.message};throw cause;}},executor:{kind:"immediate",async run(request,ctx){validateVisualRequest(request);const result=await renderVisual(request,ctx);return {type:renderTypes.silentVideo,data:result as unknown as Json};}}};
export const framesCapability:CapabilityDef={name:"local/render-frames",returns:renderTypes.frames,async resolve(request){try{if(!containsPending(request))validateFrameRequest(request);return {ok:true,request,backend:"local",cost:"local",summary:{operation:"render-frames"}};}catch(cause){if(cause instanceof DvError)return {ok:false,code:cause.code,reason:cause.message};throw cause;}},executor:{kind:"immediate",async run(request,ctx){validateFrameRequest(request);const result=await captureFrames(request,ctx);return {type:renderTypes.frames,data:result as unknown as Json};}}};
export const localCapabilities:CapabilityDef[]=[visualCapability,framesCapability,audioCapability,muxCapability];
