import { DvError } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
import type { Canvas } from "../space/types.ts";
import { validateCanvas } from "../space/validate.ts";
import type { Timeline } from "../timeline/types.ts";
import { validateTimeline } from "../timeline/validate.ts";
import { frameToSample48k } from "../timeline/math.ts";
import type { AudioTrack, Composition, Present, VisualTrack } from "./ir.ts";
import { validateAudioTrack, validateVisualTrack, validateDomain, integer, text, object as readObject } from "./validate.ts";

function object(data: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = readObject(data);
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) throw new DvError("TYPE_INVALID", "Unexpected or missing Composition fields.");
  return record;
}
export function filmBackground(properties: Record<string, Json>): string {
  if (Object.keys(properties).length !== 1 || typeof properties.background !== "string" || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(properties.background)) throw new DvError("FILM_APPEARANCE", "Film appearance must contain only a six/eight-digit hexadecimal background.");
  return properties.background;
}
export function flattenPresents(composition: Composition): { trackKey: string; present: Present }[] {
  return composition.visualTracks.flatMap(track => track.presents.map(present => ({ trackKey: track.trackKey, present }))).sort((a, b) => a.present.layer - b.present.layer || compare(a.present.layerKey, b.present.layerKey) || a.present.lifetime.start - b.present.lifetime.start || compare(a.trackKey, b.trackKey) || compare(a.present.presentKey, b.present.presentKey));
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
export function validateComposition(data: unknown): asserts data is Composition {
  const composition = object(data, ["compositionKey", "domain", "canvasKey", "extent", "background", "visualTracks", "audioTracks"]);
  text(composition.compositionKey); text(composition.canvasKey);
  const extent = object(composition.extent, ["widthPx", "heightPx"]); integer(extent.widthPx, 1); integer(extent.heightPx, 1);
  const domain = object(composition.domain, ["axisKey", "clock", "totalFrames", "totalSamples48k"]);
  validateDomain(domain);
  object(domain.clock, ["fps"]);
  object(domain.clock.fps, ["numerator", "denominator"]);
  filmBackground({ background: composition.background as Json });
  if (!Array.isArray(composition.visualTracks) || !Array.isArray(composition.audioTracks) || composition.visualTracks.length + composition.audioTracks.length === 0) throw new DvError("FILM_TRACKS", "Film requires at least one explicit track.");
  const typedDomain = domain;
  const identities = new Set<string>();
  for (const track of composition.visualTracks) { validateVisualTrack(track, typedDomain); if (identities.has(track.trackKey)) throw new DvError("FILM_TRACK_IDENTITY", "Track identities must be globally unique."); identities.add(track.trackKey); }
  for (const track of composition.audioTracks) { validateAudioTrack(track, typedDomain); if (identities.has(track.trackKey)) throw new DvError("FILM_TRACK_IDENTITY", "Track identities must be globally unique."); identities.add(track.trackKey); }
  const flat = flattenPresents(data as Composition);
  for (let index = 1; index < flat.length; index++) {
    const previous = flat[index - 1]!.present; const current = flat[index]!.present;
    if (previous.layer === current.layer && previous.layerKey === current.layerKey && previous.lifetime.end > current.lifetime.start) throw new DvError("FILM_LAYER_CONFLICT", "Presents on the same layer and layer key must have disjoint lifetimes, regardless of visibility masks.");
  }
}
export function composeComposition(compositionKey: string, canvas: Canvas, timeline: Timeline, appearance: Record<string, Json>, visualTracks: VisualTrack[], audioTracks: AudioTrack[]): Composition {
  validateCanvas(canvas); validateTimeline(timeline);
  const composition: Composition = {
    compositionKey, canvasKey: canvas.canvasKey, extent: canvas.extent, background: filmBackground(appearance),
    domain: { axisKey: timeline.axisKey, clock: timeline.clock, totalFrames: timeline.totalFrames, totalSamples48k: frameToSample48k(timeline.totalFrames, timeline.clock) },
    visualTracks: [...visualTracks].sort((a, b) => compare(a.trackKey, b.trackKey)), audioTracks: [...audioTracks].sort((a, b) => compare(a.trackKey, b.trackKey)),
  };
  validateComposition(composition);
  return composition;
}
