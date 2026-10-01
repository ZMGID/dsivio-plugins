import { fork, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { writeFile, stat } from "node:fs/promises";
import * as engine from "@hyperframes/engine";
import type { CaptureSession } from "@hyperframes/engine";
import { createFileServer } from "@hyperframes/producer";
import type { Page } from "puppeteer-core";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { DvError } from "../core/errors.ts";
import { runTool } from "../tools/index.ts";
import type { ExecuteContext } from "../core/capability.ts";
import type { PreparedProject } from "./resources.ts";
import type { RenderQuality } from "./requests.ts";
import type { VisualNode } from "./ir.ts";
import type { BrowserWindow } from "./runtime.ts";
import { probeVisual } from "./resources.ts";
import { sampleFrame } from "./validate.ts";
export type ChildJob = { project:PreparedProject;frames:number[];chromePath:string;ffmpeg:string;ffprobe:string;workDir:string;quality?:RenderQuality };
export type ChildResult = {paths:string[];video?:string};
interface ChildFailure { error: string; code: string }
interface BrowserMediaNode { id: string; node: Extract<VisualNode,{kind:"video"|"surface"}> }
export async function runCaptureChild(job:ChildJob,ctx:ExecuteContext):Promise<ChildResult> {
  const {promise,resolve,reject}=Promise.withResolvers<ChildResult>();
  const child=fork(fileURLToPath(import.meta.url),[],{cwd:ctx.workDir,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,SystemRoot:process.env.SystemRoot},stdio:["ignore","pipe","pipe","ipc"]});let result:ChildResult|undefined;let logs=0;let failure:DvError|undefined;let killer:NodeJS.Timeout|undefined;
  const fail=(error:DvError)=>{failure=error;child.kill("SIGTERM");killer??=setTimeout(()=>child.kill("SIGKILL"),5000);}; const abort=()=>fail(new DvError("ABORTED","Render cancelled"));ctx.signal.addEventListener("abort",abort,{once:true});const timer=setTimeout(()=>fail(new DvError("RENDER_TIMEOUT","Render exceeded 30-minute deadline")),30*60*1000);
  for(const stream of [child.stdout,child.stderr])stream?.on("data",(chunk:Buffer)=>{logs+=chunk.length;if(logs>4*1024*1024)fail(new DvError("RENDER_LOG_LIMIT","Render logs exceeded 4 MiB"));else ctx.log(chunk.toString().trim());});
  child.on("message",(raw:unknown)=>{if(!raw||typeof raw!=="object"||failure)return;if("error" in raw){const payload=raw as ChildFailure;failure=new DvError(payload.code,payload.error);}else if("paths" in raw)result=raw as ChildResult;});
  child.on("error",cause=>{failure=new DvError("RENDER_CHILD_FAILED",cause.message,{cause});});child.on("exit",()=>{clearTimeout(timer);if(killer)clearTimeout(killer);ctx.signal.removeEventListener("abort",abort);if(failure)reject(failure);else if(result)resolve(result);else reject(new DvError("RENDER_CHILD_FAILED","Capture worker exited without a validated result"));});if(ctx.signal.aborted)abort();else child.send(job);
  return promise;
}

/** Chrome cannot paint HTML foreignObject in an SVG mask. Rasterize the mounted
 * terminal source, rather than reimplementing text layout, then CSS-composite it. */
async function prepareMasks(page:Page,width:number,height:number):Promise<void> {
  const masks=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>("[data-dv-mask-mode]")).filter(root=>root.closest<HTMLElement>("[data-dv-present]")?.style.visibility!=="hidden").map(root=>root.id));
  if(!masks.length)return;
  const cdp=await engine.getCdpSession(page);
  for(const id of masks){
    const pose=await page.evaluate((id)=>{
      const root=document.getElementById(id)!;
      const state:{element:HTMLElement;style:string|null}[]=[];
      for(let element:HTMLElement|null=root;element;element=element.parentElement){state.push({element,style:element.getAttribute("style")});for(const property of ["transform","opacity","filter","backdrop-filter","clip-path","mask-image"])element.style.setProperty(property,property==="opacity"?"1":"none","important");}
      const globals=window as unknown as BrowserWindow;globals.__dvMaskState=state;
      const isolate=document.createElement("style");isolate.id="__dv_mask_isolation";isolate.textContent=`body *{visibility:hidden!important} #${id}_source,#${id}_source *{visibility:visible!important}html,body{background:transparent!important}`;document.head.append(isolate);
      const rect=root.getBoundingClientRect();
      return {x:rect.x,y:rect.y,mode:root.getAttribute("data-dv-mask-mode")!};
    },id);
    let mask:Buffer;
    try{
      await cdp.send("Emulation.setDefaultBackgroundColorOverride",{color:{r:0,g:0,b:0,a:0}});
      mask=Buffer.from(await page.screenshot({type:"png",omitBackground:true,captureBeyondViewport:false}));
    }finally{
      await page.evaluate(()=>{document.getElementById("__dv_mask_isolation")!.remove();const globals=window as unknown as BrowserWindow;for(const entry of globals.__dvMaskState){if(entry.style===null)entry.element.removeAttribute("style");else entry.element.setAttribute("style",entry.style);}globals.__dvMaskState=[];});
      await cdp.send("Emulation.setDefaultBackgroundColorOverride",{color:{r:0,g:0,b:0,a:1}});
    }
    await page.evaluate(({id,data,x,y,mode,width,height})=>{
      const content=document.getElementById(`${id}_content`)!;
      Object.assign(content.style,{maskImage:`url("${data}")`,maskPosition:`${-x}px ${-y}px`,maskSize:`${width}px ${height}px`,maskRepeat:"no-repeat",maskMode:mode});
    },{id,data:`data:image/png;base64,${mask!.toString("base64")}`,...pose,width,height});
  }
}
async function captureJob(job:ChildJob):Promise<ChildResult> {
  process.env[engine.FFMPEG_PATH_ENV]=job.ffmpeg;process.env[engine.FFPROBE_PATH_ENV]=job.ffprobe;
  const fps=job.project.domain.clock.fps;const server=await createFileServer({projectDir:job.project.projectDir,headScripts:[],bodyScripts:[],stripEmbeddedRuntime:false,fps:{num:fps.numerator,den:fps.denominator},preHeadScripts:[`window.__dvRange=${JSON.stringify({start:Math.min(...job.frames),end:Math.max(...job.frames)+1})};`]});
  const cache=new Map<string,{buffer:Buffer;bytes:number}>();let cacheBytes=0;let capturedBytes=0;
  const sourceProofs=new Map<string,Record<string,unknown>>();
  let session:CaptureSession|undefined;let encoder:ChildProcess|undefined;
  const cancel=()=>{encoder?.kill("SIGKILL");server.close();if(session)session.browser.close().catch(cause=>{console.error(cause);process.exitCode=1;});};
  process.once("SIGTERM",cancel);
  try {
    session=await engine.createCaptureSession(server.url,job.workDir,{width:job.project.extent.widthPx,height:job.project.extent.heightPx,fps:{num:fps.numerator,den:fps.denominator},format:"png",compositionDurationSeconds:job.project.domain.totalFrames*fps.denominator/fps.numerator},async(page,time)=>{
      const frame=Math.round(time*fps.numerator/fps.denominator);
      const slots=await page.evaluate((f)=>{const global=window as unknown as BrowserWindow;return global.__dvDocument?.presents.flatMap(p=>p.nodes.filter((n):n is BrowserMediaNode=>n.node.kind==="video"||n.node.kind==="surface"&&n.node.surface.timing.kind==="frames").map(n=>({id:n.id,resource:n.node.kind==="video"?n.node.resource.$resource:n.node.surface.resource.$resource,sourceUrl:document.getElementById(n.id)?.getAttribute("data-dv-source")??"",local:f-p.lifetime.start,duration:p.lifetime.end-p.lifetime.start,sampling:n.node.sampling})))??[];},frame);
      const injection:{id:string;data:string|null}[]=[];
      const preparedFiles=new Set(Object.values(job.project.resources));
      const slotSources=new Map(slots.map(slot=>[slot.id,job.project.resources[slot.resource]??(preparedFiles.has(slot.sourceUrl)?slot.sourceUrl:undefined)]));
      for(const slot of slots){
        const source=slotSources.get(slot.id);if(!source||slot.local<0||slot.local>=slot.duration)continue;
        let proof=sourceProofs.get(slot.resource);
        if(!proof){const streams=await probeVisual(join(job.project.projectDir,source));const videos=streams.filter(s=>s.codec_type==="video");if(videos.length!==1)throw new DvError("RENDER_SOURCE_STREAMS","Source must have one unique visual stream");proof=videos[0]!;sourceProofs.set(slot.resource,proof);}
        if(slot.sampling){const ratio=String(proof.avg_frame_rate).split("/").map(Number);const clock=slot.sampling.sourceClock.fps;if(Number(proof.nb_read_frames)!==slot.sampling.sourceTotalFrames||ratio.length!==2||!ratio.every(Number.isSafeInteger)||ratio[1]===0||BigInt(ratio[0]!)*BigInt(clock.denominator)!==BigInt(ratio[1]!)*BigInt(clock.numerator))throw new DvError("RENDER_SOURCE_TIMING","Source bytes disagree with the integer sampling map clock or total frames");}
      }
      for(const slot of slots){const source=slotSources.get(slot.id);const index=slot.local<0||slot.local>=slot.duration?null:slot.sampling?sampleFrame(slot.sampling,slot.local):slot.local;if(index===null||!source){injection.push({id:slot.id,data:null});continue;}const key=`${source}:${index}`;let entry=cache.get(key);if(entry){cache.delete(key);cache.set(key,entry);}else{const codec=sourceProofs.get(slot.resource)?.codec_name;const decoder=codec==="vp9"?"libvpx-vp9":codec==="vp8"?"libvpx":null;const result=await runTool(job.ffmpeg,["-v","error",...(decoder?["-c:v",decoder]:[]),"-i",join(job.project.projectDir,source),"-vf",`select=eq(n\\,${index})`,"-frames:v","1","-f","image2pipe","-c:v","png","pipe:1"],{maxStdoutBytes:256*1024*1024});const meta=await sharp(result.stdout).metadata();if(meta.format!=="png"||!meta.width||!meta.height)throw new DvError("RENDER_SOURCE_FRAME_INVALID","Source did not decode an exact PNG frame");entry={buffer:result.stdout,bytes:result.stdout.length};while(cacheBytes+entry.bytes>1024*1024*1024&&cache.size){const first=cache.keys().next().value!;cacheBytes-=cache.get(first)!.bytes;cache.delete(first);}if(entry.bytes>1024*1024*1024)throw new DvError("RENDER_SOURCE_LIMIT","Source frame exceeds 1 GiB");cache.set(key,entry);cacheBytes+=entry.bytes;}injection.push({id:slot.id,data:`data:image/png;base64,${entry.buffer.toString("base64")}`});}
      await page.evaluate(async(items)=>{const global=window as unknown as BrowserWindow;await global.__dvReady;if(global.__dvSeekError)throw new Error(String(global.__dvSeekError));for(const item of items){const image=document.getElementById(item.id) as HTMLImageElement;image.style.visibility=item.data?"":"hidden";if(item.data)image.src=item.data;}await document.fonts.ready;for(const image of Array.from(document.images))if(image.src)await image.decode();},injection);
      await prepareMasks(page,job.project.extent.widthPx,job.project.extent.heightPx);
    },{chromePath:job.chromePath,forceScreenshot:true,useDrawElement:false,enableDrawElementWorkerEncode:false,enableBrowserPool:false,staticFrameDedup:false,browserGpuMode:"software"});
    await engine.initializeSession(session);
    // HyperFrames assumes PNG means an alpha-layer job and clears authored backgrounds.
    // This adapter captures the complete opaque Film, including its authored background.
    await session.page.evaluate(()=>document.getElementById("__hf_transparent_bg__")?.remove());
    const cdp=await engine.getCdpSession(session.page);await cdp.send("Emulation.setDefaultBackgroundColorOverride",{color:{r:0,g:0,b:0,a:1}});
    await session.page.evaluate("window.__dvReady");const paths:string[]=[];let encoding:Promise<void>|undefined;let encodingFailure:DvError|undefined;let stderr="";
    const video=job.quality?join(job.workDir,"visual.mp4"):undefined;
    if(video){const crf={draft:28,standard:23,high:18}[job.quality!];encoder=spawn(job.ffmpeg,["-v","error","-f","image2pipe","-c:v","png","-framerate",`${fps.numerator}/${fps.denominator}`,"-i","pipe:0","-frames:v",String(job.frames.length),"-an","-vf","scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p","-c:v","libx264","-crf",String(crf),"-preset",job.quality==="draft"?"veryfast":"medium","-color_primaries","bt709","-color_trc","bt709","-colorspace","bt709","-color_range","tv","-fs",String(16*1024*1024*1024),"-movflags","+faststart",video],{stdio:["pipe","ignore","pipe"],env:{PATH:process.env.PATH}});encoder.stderr!.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-8000);});const completion=Promise.withResolvers<void>();encoding=completion.promise;encoder.on("error",cause=>{encodingFailure=new DvError("RENDER_ENCODER_FAILED",cause.message,{cause});completion.resolve();});encoder.stdin!.on("error",cause=>{encodingFailure=new DvError("RENDER_ENCODER_FAILED",cause.message,{cause});});encoder.on("exit",code=>{if(code!==0)encodingFailure=new DvError("RENDER_ENCODER_FAILED",`FFmpeg failed: ${stderr}`);completion.resolve();});}
    for (const f of job.frames) {
      if (encodingFailure) throw encodingFailure;
      const captured = await engine.captureFrameToBuffer(session, f, f * fps.denominator / fps.numerator);
      if (!captured.buffer?.length || captured.buffer.length > 256 * 1024 * 1024) throw new DvError("RENDER_PNG_LIMIT", "Captured PNG is empty or exceeds 256 MiB");
      const meta = await sharp(captured.buffer).metadata();
      if (meta.format !== "png" || meta.width !== job.project.extent.widthPx || meta.height !== job.project.extent.heightPx) throw new DvError("RENDER_FRAME_INVALID", "Captured PNG extent mismatch");
      capturedBytes += captured.buffer.length;
      if (!video && capturedBytes > 16 * 1024 * 1024 * 1024) throw new DvError("RENDER_OUTPUT_LIMIT", "Capture output exceeds 16 GiB");
      if (encoder) {
        if (encodingFailure) throw encodingFailure;
        if (!encoder.stdin!.write(captured.buffer)) await once(encoder.stdin!, "drain");
      } else {
        const path = join(job.workDir, `capture-${paths.length}-frame-${String(f).padStart(9, "0")}.png`);
        await writeFile(path, captured.buffer);
        paths.push(path);
      }
    }
    if(encoder){encoder.stdin!.end();await encoding;if(encodingFailure)throw encodingFailure;if((await stat(video!)).size>16*1024*1024*1024)throw new DvError("RENDER_OUTPUT_LIMIT","Video output exceeds 16 GiB");}
    return {paths,...(video?{video}:{})};
  } finally {process.removeListener("SIGTERM",cancel);if(encoder&&encoder.exitCode===null)encoder.kill("SIGKILL");try{if(session)await engine.closeCaptureSession(session);}finally{server.close();}}
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.once("message",async(job:ChildJob)=>{try{const result=await captureJob(job);process.send?.(result);}catch(cause){process.send?.({error:cause instanceof Error?cause.message:String(cause),code:cause instanceof DvError?cause.code:"RENDER_FAILED"});}finally{process.disconnect();}});
