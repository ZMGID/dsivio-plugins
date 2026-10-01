import type { ResourceRef } from "../core/value.ts";
import type { Extent } from "../space/types.ts";
import type { Bounds, Clock } from "../timeline/types.ts";
import type { AudioTrack, ProgramDomain, RenderDocument } from "./ir.ts";

export const RENDER_PACKAGE_PINS = {
  "@hyperframes/engine": "0.8.99",
  "@hyperframes/producer": "0.8.99",
  "@puppeteer/browsers": "3.2.3",
  "puppeteer-core": "25.8.0",
} as const;
export const RENDER_BROWSER_VERSION = "152.0.7928.2";
export const CAPTURE_BROWSER_VERSION = "153.0.8010.12";
export type RenderQuality = "draft" | "standard" | "high";
export type RenderVisualRequest = { document: RenderDocument; frames: Bounds; quality: RenderQuality };
export type SilentVideo = { resource: ResourceRef; clock: Clock; totalFrames: number; extent: Extent };
export type RenderAudioRequest = { domain: ProgramDomain; tracks: AudioTrack[]; frames: Bounds };
export type MixedAudio = {
  resource: ResourceRef;
  /** Source origin B(start), rebased length B(end-start); see phase3 §4. */
  totalSamples: number;
};
export type MuxRequest = { visual: SilentVideo; audio: MixedAudio };
export type FinalVideo = SilentVideo & { presentationSamples48k: number };
/** Localized HTML must carry an explicit ProgramDomain, not just floating seconds. */
export type HtmlProject = { html: string; domain: ProgramDomain; extent: Extent; resources: ResourceRef[] };
export type FrameCaptureRequest = {
  input: { kind: "document"; document: RenderDocument } | { kind: "html"; project: HtmlProject };
  /** Nonempty, strictly increasing original program frame indexes, all < totalFrames. */
  frames: number[];
};
export type CapturedFrames = { frames: { frame: number; resource: ResourceRef }[] };
