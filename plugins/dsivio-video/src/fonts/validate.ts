import { DvError } from "../core/errors.ts";
import { object, exact, key } from "../space/validate.ts";
import type { FontFace, FontStack } from "./types.ts";
import { validateFaceRequest } from "./catalog.ts";
export function validateFontFace(data: unknown): asserts data is FontFace {
 const d=object(data); exact(d,["faceKey","family","weight","style","shards","license"]); validateFaceRequest({faceKey:d.faceKey,family:d.family,weight:d.weight,style:d.style});
 const resource=(v:unknown):void=>{const r=object(v);exact(r,["$resource","bytes","mime"]);key(r.$resource);if(!Number.isSafeInteger(r.bytes)||Number(r.bytes)<=0||typeof r.mime!=="string") throw new DvError("TYPE_INVALID","Invalid font resource");};
 if(!Array.isArray(d.shards)||!d.shards.length) throw new DvError("TYPE_INVALID","Font requires WOFF2 shards");
 const seen=new Set<string>(); for(const v of d.shards) {const s=object(v);exact(s,["resource","unicodeRange"]);resource(s.resource);const r=object(s.resource);if(r.mime!=="font/woff2"||typeof s.unicodeRange!=="string"||!/^U\+[0-9A-F?]+(?:-[0-9A-F]+)?(?:\s*,\s*U\+[0-9A-F?]+(?:-[0-9A-F]+)?)*$/i.test(s.unicodeRange)||seen.has(String(r.$resource))) throw new DvError("TYPE_INVALID","Invalid or duplicate font shard");seen.add(String(r.$resource));}
 const l=object(d.license);exact(l,["spdx","notice"]);if(l.spdx!=="OFL-1.1") throw new DvError("TYPE_INVALID","Unexpected font licence");resource(l.notice);
}
export function validateFontStack(data: unknown): asserts data is FontStack {
 const d=object(data);exact(d,["stackKey","faces"]);key(d.stackKey);if(!Array.isArray(d.faces)||!d.faces.length) throw new DvError("TYPE_INVALID","Font stack must be nonempty");
 const seen=new Set<string>();for(const face of d.faces){validateFontFace(face);const identity=`${face.family}/${face.weight}/${face.style}`;if(seen.has(identity)) throw new DvError("TYPE_INVALID","Duplicate exact face in font stack");seen.add(identity);}
}
