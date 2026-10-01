import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { Bounds } from "../../timeline/types.ts";
import type { Canvas, Rect } from "../../space/types.ts";
import type { Keyframe, Easing } from "../../render/ir.ts";
import { finite, integer } from "../sound/validate.ts";
import type { MediaMotion, MotionEdge, MotionEffect, Direction } from "./types.ts";
const EFFECTS = ["none", "fade", "slide", "scale", "pop", "bounce", "blur-reveal", "wipe", "flip", "spin"];
const EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"];
const DIRECTIONS = ["left", "right", "up", "down"];
export function parseMotion(properties: Record<string, Json>): MediaMotion {
  const allowed = ["sustain", ...["enter", "exit"].flatMap(k => [k, `${k}-frames`, `${k}-easing`, `${k}-direction`, `${k}-amount`, `${k}-origin`])];
  if (Object.keys(properties).some(k => !allowed.includes(k))) throw new DvError("MEDIA_MOTION", "Unknown motion property.");
  function edge(name: string): MotionEdge {
    const effect = properties[name] ?? "none";
    if (!EFFECTS.includes(String(effect))) throw new DvError("MEDIA_MOTION", "Invalid motion effect.");
    const frames = properties[`${name}-frames`] ?? 0, easing = properties[`${name}-easing`] ?? "ease-in-out";
    integer(frames, effect === "none" ? 0 : 1);
    if (!EASINGS.includes(String(easing))) throw new DvError("MEDIA_MOTION", "Invalid motion easing.");
    const e: MotionEdge = { effect: effect as MotionEffect, frames, easing: easing as Easing };
    const direction = properties[`${name}-direction`];
    if (direction !== undefined) { if (!DIRECTIONS.includes(String(direction))) throw new DvError("MEDIA_MOTION", "Invalid direction."); e.direction = direction as Direction; }
    if (["slide", "wipe", "flip"].includes(e.effect) && !direction) throw new DvError("MEDIA_MOTION", "Slide/wipe/flip require direction.");
    const amount = properties[`${name}-amount`];
    if (amount !== undefined) { finite(amount); e.amount = amount; }
    if (properties[`${name}-origin`] !== undefined) { if (properties[`${name}-origin`] !== "outside-canvas" || e.effect !== "slide" || e.amount !== undefined) throw new DvError("MEDIA_MOTION", "Outside-canvas origin only supports slide without amount."); e.outsideCanvas = true; }
    if (effect === "none" && Object.keys(properties).some(k => k.startsWith(`${name}-`))) throw new DvError("MEDIA_MOTION", "Disabled motion cannot have effect options.");
    return e;
  }
  const result: MediaMotion = { enter: edge("enter"), exit: edge("exit"), sustain: [] };
  if (properties.sustain !== undefined) {
    if (typeof properties.sustain !== "string" || !properties.sustain.trim()) throw new DvError("MEDIA_MOTION", "Sustain must list effect amount cycles [direction].");
    for (const part of properties.sustain.split(",")) {
      const fields = part.trim().split(/\s+/), effect = fields[0];
      if (!["float", "breathe", "pulse", "wobble", "shake", "drift"].includes(String(effect)) || fields.length < 3 || fields.length > 4) throw new DvError("MEDIA_MOTION", "Invalid sustain effect.");
      const amount = Number(fields[1]), cycles = Number(fields[2]); finite(amount, 0); integer(cycles, 1); if (cycles > 100) throw new DvError("MEDIA_MOTION", "Sustain cycles exceed 100.");
      const direction = fields[3]; if (direction !== undefined && !DIRECTIONS.includes(direction) || effect === "drift" && !direction) throw new DvError("MEDIA_MOTION", "Invalid or missing sustain direction.");
      const s: MediaMotion["sustain"][number] = { effect: effect as MediaMotion["sustain"][number]["effect"], amount, cycles }; if (direction) s.direction = direction as Direction; result.sustain.push(s);
    }
  }
  return result;
}
function ease(t: number, easing: Easing): number { return easing === "linear" ? t : easing === "ease-in" ? t * t : easing === "ease-out" ? 1 - (1 - t) ** 2 : t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; }
export function motionKeyframes(motion: MediaMotion, lifetime: Bounds, rect: Rect, canvas: Canvas): Keyframe[] {
  const length = lifetime.end - lifetime.start;
  if (motion.enter.frames + motion.exit.frames > length) throw new DvError("MEDIA_MOTION", "Enter and exit motion durations exceed unit lifetime.");
  if (motion.enter.effect === "none" && motion.exit.effect === "none" && !motion.sustain.length) return [];
  const frames: Keyframe[] = [];
  for (let f = 0; f <= length; f++) {
    let opacity = 1, blur = 0, x = 0, y = 0, scale = 1, rotate = 0, rx = 0, ry = 0, clip = "none";
    for (const [edge, progress] of [[motion.enter, Math.min(1, f / Math.max(1, motion.enter.frames))], [motion.exit, Math.min(1, Math.max(0, (f - length + motion.exit.frames) / Math.max(1, motion.exit.frames)))]] as const) {
      const out = edge === motion.enter ? 1 - ease(progress, edge.easing) : ease(progress, edge.easing), amount = edge.amount;
      if (edge.effect === "fade" || edge.effect === "blur-reveal") opacity *= 1 - out;
      if (edge.effect === "blur-reveal") blur += out * (amount ?? 20);
      if (edge.effect === "slide") { const sign = edge.direction === "left" || edge.direction === "up" ? -1 : 1; let distance = amount ?? (edge.direction === "left" || edge.direction === "right" ? rect.widthPx : rect.heightPx); if (edge.outsideCanvas) distance = edge.direction === "left" ? rect.xPx + rect.widthPx : edge.direction === "right" ? canvas.extent.widthPx - rect.xPx : edge.direction === "up" ? rect.yPx + rect.heightPx : canvas.extent.heightPx - rect.yPx; if (edge.direction === "left" || edge.direction === "right") x += sign * out * distance; else y += sign * out * distance; }
      if (["scale", "pop", "bounce"].includes(edge.effect)) { scale *= 1 - out * (amount ?? .2); if (edge.effect !== "scale") scale += Math.sin(progress * Math.PI * (edge.effect === "bounce" ? 3 : 1)) * .12 * (1 - progress); }
      if (edge.effect === "spin") rotate += out * (amount ?? 180);
      if (edge.effect === "flip") { const sign = edge.direction === "left" || edge.direction === "up" ? -1 : 1; if (edge.direction === "left" || edge.direction === "right") ry += sign * out * (amount ?? 90); else rx += sign * out * (amount ?? 90); }
      if (edge.effect === "wipe") { const pct = out * 100; clip = edge.direction === "left" ? `inset(0 ${pct}% 0 0)` : edge.direction === "right" ? `inset(0 0 0 ${pct}%)` : edge.direction === "up" ? `inset(0 0 ${pct}% 0)` : `inset(${pct}% 0 0 0)`; }
    }
    for (const s of motion.sustain) { const t = f / length, wave = Math.sin(t * s.cycles * 2 * Math.PI) * s.amount; if (s.effect === "float") y += wave; if (s.effect === "breathe" || s.effect === "pulse") scale *= 1 + wave; if (s.effect === "wobble") rotate += wave; if (s.effect === "shake") x += wave; if (s.effect === "drift") { const amount = t * s.amount, sign = s.direction === "left" || s.direction === "up" ? -1 : 1; if (s.direction === "left" || s.direction === "right") x += sign * amount; else y += sign * amount; } }
    frames.push({ offsetFrames: f, easing: "linear", declarations: [{ property: "opacity", value: String(opacity) }, { property: "transform", value: `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotate}deg) rotateX(${rx}deg) rotateY(${ry}deg)` }, { property: "filter", value: `blur(${blur}px)` }, { property: "clip-path", value: clip }] });
  }
  return frames;
}
