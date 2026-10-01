import { stat } from "node:fs/promises";
import { DvError } from "../core/errors.ts";
import type { ExecuteContext } from "../core/capability.ts";
import { locateTool } from "../tools/index.ts";
import type { RenderVisualRequest, SilentVideo } from "./requests.ts";
import { bounds, object, validateDocument } from "./validate.ts";
import { prepareProject, probeVisual } from "./resources.ts";
import { locateBrowser } from "./browser.ts";
import { runCaptureChild } from "./child.ts";
import { withRenderAdmission } from "./frames.ts";
export function validateVisualRequest(data:unknown):asserts data is RenderVisualRequest {
  const r=object(data);validateDocument(r.document);bounds(r.frames,r.document.domain.totalFrames);if(!["draft","standard","high"].includes(String(r.quality)))throw new DvError("RENDER_QUALITY_INVALID","Quality must be draft, standard or high");const e=r.document.extent;if(e.widthPx%2||e.heightPx%2)throw new DvError("RENDER_ODD_EXTENT","H.264 yuv420p render requires an even canvas width and height");
}
export async function verifySilentVideo(path:string,expected:Omit<SilentVideo,"resource">,ctx:ExecuteContext):Promise<void> {
  const info=await stat(path);if(!info.size||info.size>16*1024*1024*1024)throw new DvError("RENDER_OUTPUT_LIMIT","Video is empty or exceeds 16 GiB");const streams=await probeVisual(path,ctx.signal);const stream=streams[0];const fps=String(stream?.avg_frame_rate).split("/").map(Number);
  if(streams.length!==1||!stream||stream.codec_type!=="video"||stream.codec_name!=="h264"||stream.width!==expected.extent.widthPx||stream.height!==expected.extent.heightPx||Number(stream.nb_read_frames)!==expected.totalFrames||fps.length!==2||!fps.every(Number.isSafeInteger)||fps[1]===0||BigInt(fps[0]!)*BigInt(expected.clock.fps.denominator)!==BigInt(fps[1]!)*BigInt(expected.clock.fps.numerator))throw new DvError("RENDER_VIDEO_MISMATCH","Visual output failed H.264 stream, extent, rational FPS or decoded frame-count gate");
}
export async function renderVisual(request:RenderVisualRequest,ctx:ExecuteContext):Promise<SilentVideo> {
  validateVisualRequest(request);return withRenderAdmission(ctx,async context=>{
    const frames=Array.from({length:request.frames.end-request.frames.start},(_v,index)=>request.frames.start+index);const project=await prepareProject({input:{kind:"document",document:request.document},frames},context);const browser=await locateBrowser("render");context.log(`Rendering with ${browser.kind} ${browser.version} at ${browser.path}`);const ffmpeg=await locateTool("ffmpeg",{projectRoot:context.projectRoot});const ffprobe=await locateTool("ffprobe",{projectRoot:context.projectRoot});const result=await runCaptureChild({project,frames,quality:request.quality,chromePath:browser.path,ffmpeg:ffmpeg.path,ffprobe:ffprobe.path,workDir:context.workDir},context);if(!result.video)throw new DvError("RENDER_VIDEO_MISSING","Capture worker did not produce video");const shape={clock:request.document.domain.clock,totalFrames:frames.length,extent:request.document.extent};await verifySilentVideo(result.video,shape,context);return {...shape,resource:await context.store.putFile(result.video,"video/mp4")};
  });
}
