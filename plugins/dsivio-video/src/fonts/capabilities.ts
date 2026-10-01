import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { CapabilityDef } from "../core/capability.ts";
import type { Json } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import { fontDirectory, validateFaceRequest } from "./catalog.ts";
import { readFontCatalog } from "./setup.ts";
import { fontTypes } from "./types.ts";
import type { FontFace } from "./types.ts";
import { validateFontFace } from "./validate.ts";
export const localCapabilities:CapabilityDef[]=[{
 name:"local/font-face",returns:fontTypes.face,
 async resolve(request){try{validateFaceRequest(request);return{ok:true,request,backend:"local",cost:"local",summary:{family:request.family,weight:request.weight,style:request.style}};}catch(error){if(error instanceof DvError)return{ok:false,code:error.code,reason:error.message};throw error;}},
 executor:{kind:"immediate",async run(request,ctx){
  validateFaceRequest(request); const catalog=await readFontCatalog();const entry=catalog.faces.find(f=>f.family===request.family&&f.weight===request.weight&&f.style===request.style);if(!entry)throw new DvError("FONT_NOT_PREPARED","Exact face has not been prepared");
  const path=(file:string):string=>{const p=resolve(fontDirectory,file);if(!p.startsWith(fontDirectory+sep))throw new DvError("FONT_NOT_PREPARED","Invalid prepared font path");return p;};
  try { const shards:FontFace["shards"]=[];for(const s of entry.shards){if(ctx.signal.aborted)throw new DvError("ABORTED","Font materialization aborted");const source=path(s.file);const magic=(await readFile(source)).subarray(0,4).toString("ascii");if(magic!=="wOF2")throw new DvError("FONT_NOT_PREPARED","Prepared shard is not WOFF2");shards.push({resource:await ctx.store.putFile(source,"font/woff2"),unicodeRange:s.unicodeRange});}
   const face:FontFace={...request,shards,license:{spdx:"OFL-1.1",notice:await ctx.store.putFile(path(entry.license),"text/plain")}};validateFontFace(face);ctx.log(`Materialized ${request.family} ${request.weight} ${request.style}: ${shards.length} shards`);return{type:fontTypes.face,data:face as unknown as Json};
  }catch(cause){if(cause instanceof DvError)throw cause;throw new DvError("FONT_NOT_PREPARED","Prepared font bytes are unavailable; run setup fonts",{cause});}
 }}
}];
