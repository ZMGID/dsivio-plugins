import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import type { Instant, Timeline } from "../../timeline/types.ts";
import { scheduleStages } from "../../timeline/temporal.ts";
import { finite, integer } from "../sound/validate.ts";
import { parseAppearance } from "../media-track/appearance.ts";
import { parseMotion } from "../media-track/motion.ts";
import type { MediaSource } from "../media-track/types.ts";
import type { DeckLabel, DeckPlan, DeckPose, DeckProgram, DeckStage, DeckStep, DeckStyle } from "./types.ts";
import { validateDeckProgram } from "./validate.ts";

export const DECK_KEYS = ["visible-previous", "visible-next", "wrap", "reflow-frames", "reflow-easing", "playback-future", "playback-past", ...["x", "y", "rotation", "scale", "opacity", "stacking", "brightness", "contrast", "saturation"].flatMap(key => [`current-${key}`, `previous-${key}-step`, `next-${key}-step`]), "previous-rotation-mode", "next-rotation-mode"];
export const MOTION_KEYS = ["enter", "exit", "sustain", ...["enter", "exit"].flatMap(prefix => ["frames", "easing", "direction", "amount", "origin"].map(key => `${prefix}-${key}`))];
function choice<T extends string>(p: Record<string, Json>, name: string, fallback: T, choices: readonly T[]): T {
  const value = p[name] ?? fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) throw new DvError("DECK_RECIPE", `Invalid '${name}'.`);
  return value as T;
}
export function parseDeckStyle(p: Record<string, Json>): DeckStyle {
  if (Object.values(p).some(value => value === null)) throw new DvError("DECK_RECIPE", "Appearance values cannot be null.");
  const n = (key: string, fallback: number, min = -Infinity, max = Infinity): number => { const value = p[key] ?? fallback; finite(value, min, max); return value; };
  const count = (key: string, fallback: number, max = Infinity): number => { const value = n(key, fallback, 0, max); integer(value); return value; };
  const pose = (prefix: string, suffix: string, defaults: DeckPose): DeckPose => {
    const value: DeckPose = { x: n(`${prefix}-x${suffix}`, defaults.x), y: n(`${prefix}-y${suffix}`, defaults.y), rotation: n(`${prefix}-rotation${suffix}`, defaults.rotation), scale: n(`${prefix}-scale${suffix}`, defaults.scale, Number.MIN_VALUE), opacity: n(`${prefix}-opacity${suffix}`, defaults.opacity, 0, 1), stacking: n(`${prefix}-stacking${suffix}`, defaults.stacking), brightness: n(`${prefix}-brightness${suffix}`, defaults.brightness, 0), contrast: n(`${prefix}-contrast${suffix}`, defaults.contrast, 0), saturation: n(`${prefix}-saturation${suffix}`, defaults.saturation, 0) };
    integer(value.stacking, -Infinity); return value;
  };
  const current = pose("current", "", { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, stacking: 0, brightness: 1, contrast: 1, saturation: 1 });
  // research/05 §6.7 documents the source's missing '-step' lookup defect.
  // Read the accepted *-step keys themselves: author tone factors really are adjustable.
  const previous: DeckStep = { ...pose("previous", "-step", { x: 0, y: 28, rotation: -2.5, scale: 0.94, opacity: 0.82, stacking: -1, brightness: 0.92, contrast: 1, saturation: 0.86 }), rotationMode: choice(p, "previous-rotation-mode", "alternate", ["linear", "alternate"]) };
  const next: DeckStep = { ...pose("next", "-step", { x: 0, y: -20, rotation: 2, scale: 0.92, opacity: 0.72, stacking: -1, brightness: 0.88, contrast: 1, saturation: 0.78 }), rotationMode: choice(p, "next-rotation-mode", "alternate", ["linear", "alternate"]) };
  const wrap = p.wrap ?? false;
  if (typeof wrap !== "boolean") throw new DvError("DECK_RECIPE", "wrap requires a boolean.");
  return { current, previous, next, wrap, visiblePrevious: count("visible-previous", 2, 1000), visibleNext: count("visible-next", 1, 1000), reflowFrames: count("reflow-frames", 8), reflowEasing: choice(p, "reflow-easing", "ease-in-out", ["linear", "ease-in", "ease-out", "ease-in-out"]), playbackFuture: choice(p, "playback-future", "hold-head", ["hold-head", "continue"]), playbackPast: choice(p, "playback-past", "hold-tail", ["hold-tail", "continue", "hide"]) };
}
export function depthPose(style: DeckStyle, depth: number): DeckPose {
  if (depth === 0) return { ...style.current };
  const n = Math.abs(depth), step = depth < 0 ? style.previous : style.next, c = style.current;
  const pose = { x: c.x + step.x * n, y: c.y + step.y * n, rotation: c.rotation + step.rotation * (step.rotationMode === "linear" ? n : n % 2 ? 1 : -1), scale: c.scale * step.scale ** n, opacity: c.opacity * step.opacity ** n, stacking: c.stacking + step.stacking * n, brightness: c.brightness * step.brightness ** n, contrast: c.contrast * step.contrast ** n, saturation: c.saturation * step.saturation ** n };
  for (const value of Object.values(pose)) finite(value);
  integer(pose.stacking, -Infinity); return pose;
}
export function deckStages(program: DeckProgram): DeckStage[] {
  const { style, cards } = program;
  if (style.wrap && style.visiblePrevious + style.visibleNext >= cards.length) throw new DvError("DECK_DEPTH", "Wrapped visibility would put a card at more than one depth.");
  return scheduleStages({ start: cards[0]!.activation.frame, end: program.terminal.frame }, cards.map(card => ({ id: card.cardKey, frame: card.activation.frame }))).map((stage, activeIndex) => {
    if (activeIndex && style.reflowFrames > stage.frames.end - stage.frames.start) throw new DvError("DECK_REFLOW", "Reflow exceeds its activation stage.");
    const poses = new Map<number, DeckPose>([[activeIndex, depthPose(cards[activeIndex]!.depth, 0)]]);
    for (const sign of [-1, 1]) {
      const limit = sign < 0 ? style.visiblePrevious : style.visibleNext;
      for (let n = 1; n <= limit; n++) {
        let index = activeIndex + sign * n;
        if (style.wrap) index = ((index % cards.length) + cards.length) % cards.length;
        if (index < 0 || index >= cards.length) continue;
        if (poses.has(index)) throw new DvError("DECK_DEPTH", "A card cannot occupy two depths.");
        if (index < activeIndex && cards[index]!.depth.playbackPast === "hide") continue;
        poses.set(index, depthPose(cards[index]!.depth, sign * n));
      }
    }
    return { frames: stage.frames, activeIndex, poses };
  });
}
export function assembleDeck(timeline: Timeline, canvas: Canvas, frame: Frame, plan: DeckPlan, sources: MediaSource[], instants: Instant[], terminal: Instant, labels: DeckLabel[]): DeckProgram {
  const style = parseDeckStyle(plan.appearance);
  const cards = plan.cards.map((card, index) => {
    const properties = { ...plan.appearance, ...card.appearance };
    // Depth controls belong to the stack, not the source's sampling/frame recipe.
    const mediaProperties = Object.fromEntries(Object.entries(properties).filter(([key]) => !DECK_KEYS.includes(key) && !MOTION_KEYS.includes(key)));
    const motionProperties = Object.fromEntries(Object.entries(properties).filter(([key]) => MOTION_KEYS.includes(key)));
    const source = sources[index], activation = instants[index];
    if (!source || !activation) throw new DvError("DECK_INPUT", "Each Card requires a source and activation.");
    const still = source.kind === "image" || source.kind === "surface" && source.surface.timing.kind === "still";
    if (still && ["playback", "trim-start", "trim-end"].some(key => properties[key] !== undefined)) throw new DvError("DECK_PLAYBACK", "Static sources prohibit playback and trim.");
    const label = card.labelIndex === undefined ? undefined : labels[card.labelIndex];
    if (card.labelIndex !== undefined && !label) throw new DvError("DECK_INPUT", "Missing Card label.");
    return { cardKey: card.cardKey, source, activation, depth: parseDeckStyle(properties), appearance: parseAppearance(card.cardKey, frame, { "stack-order": 30, ...mediaProperties }), motion: parseMotion(motionProperties), ...(label ? { label } : {}) };
  });
  const program: DeckProgram = { trackKey: plan.trackKey, timeline, canvas, frame, terminal, style, cards };
  validateDeckProgram(program); deckStages(program); return program;
}
