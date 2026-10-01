import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { frameToSample48k } from "../timeline/math.ts";
import sharp from "sharp";
import { DvError } from "../core/errors.ts";
import type { ExecuteContext } from "../core/capability.ts";
import type { ResourceRef } from "../core/value.ts";
import { runTool } from "../tools/index.ts";
import type { FrameCaptureRequest, HtmlProject } from "./requests.ts";
import type { RenderDocument, Surface } from "./ir.ts";
import { validateDocument, validateDomain, extent, integer } from "./validate.ts";
export type PreparedProject = { projectDir:string; html:string; resources:Record<string,string>; domain:RenderDocument["domain"]; extent:RenderDocument["extent"] };
export async function probeVisual(path:string,signal?:AbortSignal):Promise<Record<string,unknown>[]> {
  const output=await runTool("ffprobe",["-v","error","-show_streams","-count_frames","-of","json",path],{signal,maxStdoutBytes:8*1024*1024});let raw:unknown;try{raw=JSON.parse(output.stdout.toString());}catch(cause){throw new DvError("RENDER_PROBE_INVALID","Invalid ffprobe JSON",{cause});}if(!raw||typeof raw!=="object"||!("streams" in raw)||!Array.isArray(raw.streams))throw new DvError("RENDER_PROBE_INVALID","Missing probe streams");return raw.streams as Record<string,unknown>[];
}
export async function verifySurface(surface:Surface,path:string,signal:AbortSignal):Promise<void> {
  const streams=await probeVisual(path,signal);const s=streams[0];if(streams.length!==1||!s||s.codec_type!=="video"||s.width!==surface.extent.widthPx||s.height!==surface.extent.heightPx)throw new DvError("SURFACE_PROBE_REJECTED","Surface must have exactly its declared visual stream and extent");
  const disposition=s.disposition as Record<string,unknown>|undefined;const sides=s.side_data_list as Record<string,unknown>[]|undefined;
  if(disposition?.attached_pic===1||s.sample_aspect_ratio!==undefined&&!["1:1","N/A"].includes(String(s.sample_aspect_ratio))||s.field_order!==undefined&&!["progressive","unknown"].includes(String(s.field_order))||s.tags&&typeof s.tags==="object"&&"rotate" in s.tags&&Number(s.tags.rotate)!==0||sides?.some(x=>Number(x.rotation??0)!==0))throw new DvError("SURFACE_PROBE_REJECTED","Surface has rotation, interlacing or non-square pixels");
  if(["smpte2084","arib-std-b67"].includes(String(s.color_transfer))||["bt2020","bt2020nc","bt2020c"].includes(String(s.color_primaries)))throw new DvError("SURFACE_PROBE_REJECTED","HDR surface is unsupported");
  const alpha=/^(?:yuva|rgba|bgra|argb|abgr|gbrap|ya)/.test(String(s.pix_fmt))||s.tags&&typeof s.tags==="object"&&"alpha_mode" in s.tags&&String(s.tags.alpha_mode)==="1";if(Boolean(alpha)!==(surface.alpha==="straight"))throw new DvError("SURFACE_PROBE_REJECTED","Surface alpha declaration disagrees with bytes");
  const count=Number(s.nb_read_frames);if(count!==(surface.timing.kind==="still"?1:surface.timing.totalFrames))throw new DvError("SURFACE_PROBE_REJECTED","Surface decoded frame count mismatch");
  if(surface.timing.kind==="frames"){const parts=String(s.avg_frame_rate).split("/").map(Number);if(!Number.isSafeInteger(parts[0])||!Number.isSafeInteger(parts[1])||BigInt(parts[0]!)*BigInt(surface.timing.clock.fps.denominator)!==BigInt(parts[1]!)*BigInt(surface.timing.clock.fps.numerator))throw new DvError("SURFACE_PROBE_REJECTED","Surface FPS mismatch");}
}
export async function prepareProject(request:FrameCaptureRequest,ctx:ExecuteContext):Promise<PreparedProject> {
  const input=request.input;const document=input.kind==="document"?input.document:null;if(document)validateDocument(document);const domain=document?.domain??(input.kind==="html"?input.project.domain:null);const size=document?.extent??(input.kind==="html"?input.project.extent:null);validateDomain(domain);extent(size);
  const sourceHtml=document?.html??(input.kind==="html"?input.project.html:"");
  const metadata=parseHtmlDomain(sourceHtml);
  if(metadata.domain.totalFrames!==domain.totalFrames||metadata.domain.clock.fps.numerator!==domain.clock.fps.numerator||metadata.domain.clock.fps.denominator!==domain.clock.fps.denominator||metadata.extent.widthPx!==size!.widthPx||metadata.extent.heightPx!==size!.heightPx)throw new DvError("RENDER_HTML_DOMAIN_MISMATCH","HTML integer clock/frame domain and canvas do not match the request");
  if(!request.frames.length)throw new DvError("RENDER_FRAMES_INVALID","At least one frame required");let last=-1;for(const f of request.frames){integer(f);if(f<=last||f>=domain.totalFrames)throw new DvError("RENDER_FRAMES_INVALID","Frame indexes must be strictly increasing and in domain");last=f;}
  const projectDir=join(ctx.workDir,"project");await mkdir(projectDir,{recursive:true});const resources:Record<string,string>={};const refs=document?document.resources.filter(u=>u.required==="global"||u.frames.some(w=>request.frames.some(f=>f>=w.start&&f<w.end))).map(u=>u.resource):input.kind==="html"?input.project.resources:[];
  for(let i=0;i<refs.length;i++){const ref=refs[i]!;const source=ctx.store.pathOf(ref);const info=await stat(source);if(!info.isFile()||info.size!==ref.bytes)throw new DvError("RESOURCE_BYTES_MISMATCH",`Resource bytes disagree for ${ref.$resource}`);const suffix:Record<string,string>={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","video/mp4":"mp4","video/webm":"webm","font/woff2":"woff2","font/woff":"woff","font/ttf":"ttf","font/otf":"otf"};if(!suffix[ref.mime])throw new DvError("RENDER_RESOURCE_UNSUPPORTED",`Unsupported render resource MIME ${ref.mime}`);const name=`resource-${i}.${suffix[ref.mime]}`;await copyFile(source,join(projectDir,name));resources[ref.$resource]=name;if(ref.mime.startsWith("image/")){const metadata=await sharp(source).metadata();if(!metadata.width||!metadata.height||(metadata.pages??1)!==1)throw new DvError("RENDER_IMAGE_INVALID","Expected decodable still image");}}
  if(document)for(const surface of document.surfaces)if(resources[surface.resource.$resource])await verifySurface(surface,join(projectDir,resources[surface.resource.$resource]!),ctx.signal);
  let html=document?.html??(input.kind==="html"?input.project.html:"");
  const omitted=new Set(document?.resources.filter(u=>u.required==="windows"&&!refs.includes(u.resource)).map(u=>u.resource.$resource)??[]);
  const transparent=await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  html=html.replace(/dv-resource:\/\/([^\s"'<>\)]+)/g,(_m,id:string)=>{const key=decodeURIComponent(id);if(resources[key])return resources[key];if(omitted.has(key))return `data:image/png;base64,${transparent.toString("base64")}`;throw new DvError("RENDER_RESOURCE_MISSING",`Unmaterialized resource ${key}`);});
  html=html.replace(/data-dv-src=/g,"src=");await writeFile(join(projectDir,"index.html"),html);
  return {projectDir,html,resources,domain,extent:size as RenderDocument["extent"]};
}

export function parseHtmlDomain(html:string): Pick<HtmlProject,"domain"|"extent"> {
  const roots=[...html.matchAll(/<[^>]+\bdata-composition-id\s*=\s*["'][^"']+["'][^>]*>/gi)];
  if(roots.length!==1)throw new DvError("SNAPSHOT_HTML_INVALID","HTML must contain exactly one explicit Composition root");
  const tag=roots[0]![0];
  function attr(name:string):string {
    const matches=[...tag.matchAll(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,"g"))];
    if(matches.length!==1)throw new DvError("SNAPSHOT_HTML_INVALID",`Composition requires exactly one ${name}`);
    return matches[0]![1]!;
  }
  function numeric(name:string):number {
    const value=attr(name);
    if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw new DvError("SNAPSHOT_HTML_INVALID",`Invalid integer ${name}`);
    return Number(value);
  }
  const clock={fps:{numerator:numeric("data-dv-fps-numerator"),denominator:numeric("data-dv-fps-denominator")}};
  const totalFrames=numeric("data-dv-total-frames");
  return {domain:{axisKey:attr("data-composition-id"),clock,totalFrames,totalSamples48k:frameToSample48k(totalFrames,clock)},extent:{widthPx:numeric("data-width"),heightPx:numeric("data-height")}};
}

export async function localizeHtml(input:string,ctx:ExecuteContext):Promise<HtmlProject> {
  await mkdir(ctx.workDir,{recursive:true});
  const base=/^https?:\/\//i.test(input)?new URL(input):pathToFileURL(resolve(input));
  let html:string;
  if(base.protocol==="file:")html=await readFile(fileURLToPath(base),"utf8");
  else {const response=await fetch(base,{signal:ctx.signal});if(!response.ok)throw new DvError("SNAPSHOT_FETCH_FAILED",`HTTP ${response.status} loading HTML`);html=await response.text();}
  const shape=parseHtmlDomain(html);const resources:ResourceRef[]=[];
  if(/<(?:script|link)\b[^>]*(?:src|href)\s*=/i.test(html))throw new DvError("SNAPSHOT_EXTERNAL_CODE","Snapshot HTML must inline scripts and styles");
  const urls=new Set<string>();
  for(const match of html.matchAll(/\b(?:src|href|data-dv-src|data-dv-source)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi))urls.add((match[1]??match[2])!);
  const mimeByExtension:Record<string,string>={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".mp4":"video/mp4",".webm":"video/webm",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf"};
  for(const url of urls){
    if(url.startsWith("data:")||url.startsWith("#"))continue;
    const resolved=new URL(url,base);
    if(!["file:","http:","https:"].includes(resolved.protocol)||base.protocol!=="file:"&&resolved.protocol==="file:")throw new DvError("SNAPSHOT_RESOURCE_PROTOCOL",`Unsupported resource protocol ${resolved.protocol}`);
    const temporary=join(ctx.workDir,`localized-${resources.length}`);let mime:string|undefined;
    if(resolved.protocol==="file:"){mime=mimeByExtension[extname(resolved.pathname).toLowerCase()];if(!mime)throw new DvError("SNAPSHOT_RESOURCE_UNSUPPORTED",`Unsupported local resource ${url}`);await copyFile(fileURLToPath(resolved),temporary);}
    else {const response=await fetch(resolved,{signal:ctx.signal});if(!response.ok)throw new DvError("SNAPSHOT_FETCH_FAILED",`HTTP ${response.status} loading ${url}`);mime=response.headers.get("content-type")?.split(";")[0];if(!mime||!Object.values(mimeByExtension).includes(mime))throw new DvError("SNAPSHOT_RESOURCE_UNSUPPORTED",`Unsupported resource MIME ${mime}`);await writeFile(temporary,Buffer.from(await response.arrayBuffer()));}
    const ref=await ctx.store.putFile(temporary,mime);resources.push(ref);html=html.split(url).join(`dv-resource://${encodeURIComponent(ref.$resource)}`);
  }
  return {html,...shape,resources};
}
