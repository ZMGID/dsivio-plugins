import type { ResourceRef, TypeRef } from "../core/value.ts";

export const fontTypes = {
  face: "dsivio-video/fonts@1#Face",
  stack: "dsivio-video/fonts@1#Stack",
} as const satisfies Record<string, TypeRef>;
export type FontStyle = "normal" | "italic" | "oblique";
export type FontFaceRequest = { faceKey: string; family: string; weight: number; style: FontStyle };
/** Exact font bytes; no machine-local family lookup. Each shard carries its coverage declaration. */
export type FontFace = {
  faceKey: string;
  family: string;
  weight: number;
  style: FontStyle;
  shards: { resource: ResourceRef; unicodeRange: string }[];
  license: { spdx: string; notice: ResourceRef };
};
/** Nonempty, duplicate-free; order is observable fallback precedence. */
export type FontStack = { stackKey: string; faces: FontFace[] };
export const FONT_CATALOG_VERSION = "dsivio-video.fonts/1";
export const FONT_PACKAGE_PINS = {
  "@fontsource/inter": "5.3.0",
  "@fontsource/noto-sans-sc": "5.3.0",
  "@fontsource/noto-emoji": "5.3.2",
  "@infolektuell/noto-color-emoji": "0.2.0",
} as const;
