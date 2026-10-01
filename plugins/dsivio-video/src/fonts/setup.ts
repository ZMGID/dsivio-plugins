import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DvError } from "../core/errors.ts";
import { FONT_CATALOG_VERSION, FONT_PACKAGE_PINS } from "./types.ts";
import { families, fontDirectory } from "./catalog.ts";
import type { CatalogFace, FontCatalog } from "./catalog.ts";
function unpack(bytes: Buffer): Map<string,Buffer> {
 const tar=gunzipSync(bytes); const files=new Map<string,Buffer>();
 for(let offset=0;offset+512<=tar.length;) {
  const header=tar.subarray(offset,offset+512); if(header.every(b=>b===0)) break;
  const field=(s:number,e:number)=>header.subarray(s,e).toString("utf8").replace(/\0.*$/s,""); const prefix=field(345,500); const name=(prefix?`${prefix}/`:"")+field(0,100); const size=parseInt(field(124,136).trim(),8); if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length) throw new DvError("FONT_SETUP_FAILED","Malformed npm tarball");
  if((header[156]===0||header[156]===48) && name.startsWith("package/") && !name.split("/").includes("..")) files.set(name.slice(8),tar.subarray(offset+512,offset+512+size));
  offset+=512+Math.ceil(size/512)*512;
 }
 return files;
}
export async function setupFonts(): Promise<{directory:string;families:string[];faces:number}> {
 let staging:string|undefined;
 try {
  await mkdir(dirname(fontDirectory),{recursive:true});
  staging=await mkdtemp(join(dirname(fontDirectory),"fonts-setup-"));
  const faces:CatalogFace[]=[];
  for(const [family,entry] of Object.entries(families)) {
   const packageName=entry.package; const version=FONT_PACKAGE_PINS[packageName];
   const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${version}`); if(!response.ok) throw new DvError("FONT_SETUP_FAILED",`Font metadata download failed: HTTP ${response.status}`);
   const metadata=await response.json() as {dist:{tarball:string;integrity:string}};
   if(!metadata.dist.tarball.startsWith("https://registry.npmjs.org/")) throw new DvError("FONT_SETUP_FAILED","Font tarball must come from the npm registry");
   const archive=await fetch(metadata.dist.tarball); if(!archive.ok) throw new DvError("FONT_SETUP_FAILED",`Font download failed: HTTP ${archive.status}`); const bytes=Buffer.from(await archive.arrayBuffer());
   const [algorithm,digest]=metadata.dist.integrity.split("-"); if(algorithm!=="sha512" || createHash("sha512").update(bytes).digest("base64")!==digest) throw new DvError("FONT_SETUP_FAILED","Font tarball integrity mismatch");
   const files=unpack(bytes); const licence=[...files.keys()].find(n=>/^(?:license|ofl)(?:\.txt)?$/i.test(n)); if(!licence) throw new DvError("FONT_SETUP_FAILED",`Missing licence in ${packageName}`);
   const target=join(staging,family); await mkdir(target,{recursive:true}); await writeFile(join(target,"LICENSE"),files.get(licence)!);
   for(const weight of entry.weights) for(const style of entry.styles) {
    const cssFile=family === "noto-color-emoji" ? "index.css" : style === "normal" ? `${weight}.css` : `${weight}-${style}.css`;
    const css=files.get(cssFile)?.toString("utf8"); if(!css) throw new DvError("FONT_SETUP_FAILED",`Missing ${cssFile} in ${packageName}`);
    const shards:CatalogFace["shards"]=[];
    for(const block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
     const body=block[1]!; const source=/url\(['"]?(?:\.\/)?([^)'"\s]+\.woff2)['"]?\)/.exec(body); if(!source) continue;
     const file=source[1]!; if(family === "inter" && !/inter-latin(?:-ext)?-/.test(file)) continue;
     const content=files.get(file); if(!content) throw new DvError("FONT_SETUP_FAILED",`Missing shard ${file}`);
     const unicodeRange=/unicode-range\s*:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "U+0-10FFFF";
     const destination=join(target,file); await mkdir(dirname(destination),{recursive:true}); await writeFile(destination,content);
     const previous=shards.find(s=>s.file===`${family}/${file}`); if(previous) previous.unicodeRange+=`, ${unicodeRange}`; else shards.push({file:`${family}/${file}`,unicodeRange});
    }
    if(!shards.length) throw new DvError("FONT_SETUP_FAILED",`No WOFF2 shards for ${family} ${weight} ${style}`);
    faces.push({family,weight,style,shards,license:`${family}/LICENSE`});
   }
  }
  const catalog:FontCatalog={format:FONT_CATALOG_VERSION,pins:FONT_PACKAGE_PINS,faces}; await writeFile(join(staging,"catalog.json"),JSON.stringify(catalog));
  await mkdir(fontDirectory,{recursive:true});
  // Family directories are pinned and immutable; the manifest is published last.
  for(const family of Object.keys(families)) { await rm(join(fontDirectory,family),{recursive:true,force:true}); await rename(join(staging,family),join(fontDirectory,family)); }
  await rename(join(staging,"catalog.json"),join(fontDirectory,"catalog.json"));
  return {directory:fontDirectory,families:Object.keys(families),faces:faces.length};
 } catch(cause) { if(cause instanceof DvError) throw cause; throw new DvError("FONT_SETUP_FAILED","Unable to prepare pinned fonts",{cause}); }
 finally { if(staging)await rm(staging,{recursive:true,force:true}); }
}
export async function readFontCatalog(): Promise<FontCatalog> {
 try { const catalog=JSON.parse(await readFile(join(fontDirectory,"catalog.json"),"utf8")) as FontCatalog; if(catalog.format!==FONT_CATALOG_VERSION||JSON.stringify(catalog.pins)!==JSON.stringify(FONT_PACKAGE_PINS)||!Array.isArray(catalog.faces)) throw new DvError("FONT_NOT_PREPARED","Font catalog does not match pinned versions"); return catalog; }
 catch(cause) { if(cause instanceof DvError) throw cause; throw new DvError("FONT_NOT_PREPARED","Run dsivio-video setup fonts before rendering",{cause}); }
}
