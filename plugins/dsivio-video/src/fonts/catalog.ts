import { homedir } from "node:os";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { FontFaceRequest } from "./types.ts";
import { FONT_PACKAGE_PINS } from "./types.ts";
export const fontDirectory = join(homedir(), ".dsivio-video", "fonts");
export const families = {
 inter: { package: "@fontsource/inter", styles: ["normal", "italic"], weights: [100,200,300,400,500,600,700,800,900] },
 "noto-sans-sc": { package: "@fontsource/noto-sans-sc", styles: ["normal"], weights: [100,200,300,400,500,600,700,800,900] },
 "noto-emoji": { package: "@fontsource/noto-emoji", styles: ["normal"], weights: [400] },
 "noto-color-emoji": { package: "@infolektuell/noto-color-emoji", styles: ["normal"], weights: [400] },
} as const;
export type CatalogFace = { family: string; weight: number; style: string; shards: { file: string; unicodeRange: string }[]; license: string };
export type FontCatalog = { format: string; pins: typeof FONT_PACKAGE_PINS; faces: CatalogFace[] };
export function validateFaceRequest(data: unknown): asserts data is FontFaceRequest {
 if(data === null || typeof data !== "object" || Array.isArray(data)) throw new DvError("FONT_UNSUPPORTED", "Font request must be an object");
 const r = data as FontFaceRequest;
 if(typeof r.faceKey !== "string" || !r.faceKey.trim() || /[\uD800-\uDFFF]/u.test(r.faceKey) || Object.keys(r).some(k=>!["faceKey","family","weight","style"].includes(k))) throw new DvError("FONT_UNSUPPORTED", "Invalid exact face identity");
 if(typeof r.family!=="string"||!Object.hasOwn(families,r.family))throw new DvError("FONT_UNSUPPORTED","Font family is not in the pinned catalog");
 const family = families[r.family as keyof typeof families];
 if(!family || !(family.weights as readonly number[]).includes(r.weight) || !(family.styles as readonly string[]).includes(r.style)) throw new DvError("FONT_UNSUPPORTED", `Unsupported exact font ${r.family} ${r.weight} ${r.style}`);
}
export function fontFamilyName(faceKey: string): string {
 if(typeof faceKey!=="string"||!faceKey.trim()||/[\uD800-\uDFFF]/u.test(faceKey)) throw new DvError("FONT_UNSUPPORTED", "Font identity must be nonempty valid Unicode");
 return `dv-font-${Buffer.from(faceKey, "utf8").toString("hex")}`;
}
