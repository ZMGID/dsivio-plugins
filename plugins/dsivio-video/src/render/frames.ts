import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { ExecuteContext } from "../core/capability.ts";
import { locateTool } from "../tools/index.ts";
import type { CapturedFrames, FrameCaptureRequest } from "./requests.ts";
import { locateBrowser } from "./browser.ts";
import { prepareProject } from "./resources.ts";
import { runCaptureChild } from "./child.ts";
let admission=Promise.resolve();
/** The project worker has one rendering admission lane, never a mutable shared session. */
export async function withRenderAdmission<T>(ctx:ExecuteContext,execute:(context:ExecuteContext)=>Promise<T>):Promise<T> {
  const preceding=admission;const gate=Promise.withResolvers<void>();admission=gate.promise;
  const cancelled=Promise.withResolvers<never>();
  const cancel=()=>cancelled.reject(new DvError("ABORTED","Render cancelled before admission"));
  ctx.signal.addEventListener("abort",cancel,{once:true});
  if(ctx.signal.aborted)cancel();
  try{await Promise.race([preceding,cancelled.promise]);}
  catch(cause){void preceding.then(()=>gate.resolve());throw cause;}
  finally{ctx.signal.removeEventListener("abort",cancel);}
  const timeout=AbortSignal.timeout(30*60*1000);const signal=AbortSignal.any([ctx.signal,timeout]);let workDir:string|undefined;
  try {if(signal.aborted)throw new DvError("ABORTED","Render cancelled before admission");await mkdir(ctx.workDir,{recursive:true});workDir=await mkdtemp(join(ctx.workDir,"render-"));return await execute({...ctx,workDir,signal});}
  catch(cause){if(cause instanceof DvError)throw cause;throw new DvError("RENDER_FAILED",cause instanceof Error?cause.message:String(cause),{cause});}
  finally {try{if(workDir)await rm(workDir,{recursive:true,force:true});}finally{gate.resolve();}}
}
export async function captureFrames(request:FrameCaptureRequest,ctx:ExecuteContext):Promise<CapturedFrames> {
  return withRenderAdmission(ctx,async context=>{
    const project=await prepareProject(request,context);const browser=await locateBrowser("render");const ffmpeg=await locateTool("ffmpeg",{projectRoot:context.projectRoot});const ffprobe=await locateTool("ffprobe",{projectRoot:context.projectRoot});
    const result=await runCaptureChild({project,frames:request.frames,chromePath:browser.path,ffmpeg:ffmpeg.path,ffprobe:ffprobe.path,workDir:context.workDir},context);
    if(result.paths.length!==request.frames.length)throw new DvError("RENDER_FRAME_COUNT_MISMATCH","Capture result does not match requested frames");const frames:CapturedFrames["frames"]=[];for(let i=0;i<result.paths.length;i++)frames.push({frame:request.frames[i]!,resource:await context.store.putFile(result.paths[i]!,"image/png")});return {frames};
  });
}
