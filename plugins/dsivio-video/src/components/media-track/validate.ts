import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import { object, identity, integer, finite } from "../sound/validate.ts";
import { validatePerformanceStyle } from "../performance/validate.ts";
import { validateTimeline, validateSynchronizedMedia } from "../../timeline/validate.ts";
import { validateCanvas, validateFrame, validatePath } from "../../space/validate.ts";
import { parseMotion } from "./motion.ts";
import { validateSource } from "./source.ts";
import { parseAppearance } from "./appearance.ts";
import type { MediaAppearance, MediaMotion, MediaPlan, MediaProgram, GroupPlan, LayerPlan, UnitPlan, HandoffPlan, SoundPlan, ResolvedLayer, ResolvedUnit } from "./types.ts";
import type { Bounds } from "../../timeline/types.ts";
function properties(data: unknown): asserts data is Record<string, Json> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new DvError("MEDIA_RECIPE", "Recipe properties must be an object.");
  for (const value of Object.values(data)) if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" && value !== null) throw new DvError("MEDIA_RECIPE", "Recipe properties must be scalar values.");
}
function bounds(data: unknown, outer?: Bounds): asserts data is Bounds {
  const b = object(data, ["start", "end"]); integer(b.start); integer(b.end, 1);
  if (b.end <= b.start || outer && (b.start < outer.start || b.end > outer.end)) throw new DvError("MEDIA_BOUNDS", "Interval is empty or outside its parent.");
}
function list(data: unknown): asserts data is unknown[] { if (!Array.isArray(data)) throw new DvError("MEDIA_LIST", "Expected an ordered list."); }
export function validateAppearance(data: unknown): asserts data is MediaAppearance {
  const p = object(data, ["styleKey", "frame", "layer", "fit", "outerStyle", "contentInsetPx", "clip", "radiusPx", "playback"], ["framePaint", "trim"]);
  const base = { ...p }; delete base.playback; delete base.trim; validatePerformanceStyle(base);
  if (!["once-start", "once-end", "hold-start", "hold-end", "loop-start", "loop-end", "stretch"].includes(String(p.playback))) throw new DvError("MEDIA_PLAYBACK", "Invalid playback mode.");
  if (p.trim !== undefined) bounds(p.trim);
}
export function validateMotion(data: unknown): asserts data is MediaMotion {
  const m = object(data, ["enter", "exit", "sustain"]), p: Record<string, Json> = {};
  for (const name of ["enter", "exit"]) {
    const e = object(m[name], ["effect", "frames", "easing"], ["direction", "amount", "outsideCanvas"]); identity(e.effect); integer(e.frames); identity(e.easing); p[name] = e.effect;
    if (!["linear", "ease-in", "ease-out", "ease-in-out"].includes(e.easing)) throw new DvError("MEDIA_MOTION", "Invalid easing.");
    if (e.effect !== "none") { p[`${name}-frames`] = e.frames; p[`${name}-easing`] = e.easing; }
    else if (e.frames !== 0 || e.direction !== undefined || e.amount !== undefined || e.outsideCanvas !== undefined) throw new DvError("MEDIA_MOTION", "Disabled edge cannot have options.");
    if (e.direction !== undefined) { identity(e.direction); p[`${name}-direction`] = e.direction; }
    if (e.amount !== undefined) { finite(e.amount); p[`${name}-amount`] = e.amount; }
    if (e.outsideCanvas !== undefined) { if (e.outsideCanvas !== true) throw new DvError("MEDIA_MOTION", "Invalid origin flag."); p[`${name}-origin`] = "outside-canvas"; }
  }
  list(m.sustain); const parts: string[] = [];
  for (const value of m.sustain) { const s = object(value, ["effect", "amount", "cycles"], ["direction"]); identity(s.effect); finite(s.amount, 0); integer(s.cycles, 1); if (s.direction !== undefined) identity(s.direction); parts.push(`${s.effect} ${s.amount} ${s.cycles}${s.direction ? ` ${s.direction}` : ""}`); }
  if (parts.length) p.sustain = parts.join(","); parseMotion(p);
}
function layer(data: unknown): asserts data is LayerPlan {
  const l = object(data, ["id", "kind", "sourceIndex", "properties", "sampling"], ["extentIndex"]); identity(l.id); integer(l.sourceIndex); properties(l.properties); list(l.sampling);
  if (!["image", "media", "surface", "paint"].includes(String(l.kind))) throw new DvError("MEDIA_SOURCE", "Unknown layer kind.");
  if (l.kind === "image") integer(l.extentIndex); else if (l.extentIndex !== undefined) throw new DvError("MEDIA_EXTENT", "Only images accept extent.");
  let previous = -1;
  for (const value of l.sampling) { const s = object(value, ["at", "zoom", "x", "y", "rotate"], ["easing"]); finite(s.at, 0, 1); finite(s.zoom, Number.MIN_VALUE); finite(s.x); finite(s.y); finite(s.rotate); if (s.at <= previous || s.easing !== undefined && !["linear", "ease-in", "ease-out", "ease-in-out"].includes(String(s.easing))) throw new DvError("MEDIA_SAMPLING", "Invalid Sampling order or easing."); previous = s.at; }
  if (l.sampling.length) { const first = object(l.sampling[0], ["at", "zoom", "x", "y", "rotate"], ["easing"]), last = object(l.sampling.at(-1), ["at", "zoom", "x", "y", "rotate"], ["easing"]); if (first.at !== 0 || last.at !== 1) throw new DvError("MEDIA_SAMPLING", "Sampling must cover both edges."); }
}
function unit(data: unknown): asserts data is UnitPlan {
  const u = object(data, ["id", "layers", "audioGain"], ["properties", "sourceAudio", "instant"]); identity(u.id); finite(u.audioGain, 0, 64); list(u.layers); if (u.properties !== undefined) properties(u.properties);
  if (!u.layers.length) throw new DvError("MEDIA_SOURCE", "Unit requires at least one layer.");
  const ids = new Set<string>(); for (const l of u.layers) { layer(l); if (ids.has(l.id)) throw new DvError("MEDIA_DUPLICATE", "Duplicate Layer identity."); ids.add(l.id); }
  if (u.sourceAudio !== undefined) { identity(u.sourceAudio); if (!u.layers.some(l => { layer(l); return l.id === u.sourceAudio && l.kind === "media"; })) throw new DvError("MEDIA_AUDIO", "Unknown audio layer."); }
}
function handoff(data: unknown): asserts data is HandoffPlan {
  const h = object(data, ["id", "from", "operator", "duration", "ratio", "audio"], ["direction"]); identity(h.id); identity(h.from); integer(h.duration); finite(h.ratio, 0, 1);
  if (!["cut", "crossfade", "push", "wipe", "cover", "page-turn"].includes(String(h.operator)) || h.operator === "cut" && h.duration !== 0 || h.operator !== "cut" && h.duration <= 0) throw new DvError("MEDIA_HANDOFF", "Invalid transition operator/duration.");
  if (["push", "wipe", "cover", "page-turn"].includes(String(h.operator)) && !["left", "right", "up", "down"].includes(String(h.direction)) || h.direction !== undefined && !["left", "right", "up", "down"].includes(String(h.direction))) throw new DvError("MEDIA_HANDOFF", "Spatial transition needs a valid direction.");
  if (h.audio !== "cut" && h.audio !== "crossfade" || h.audio === "crossfade" && h.duration === 0) throw new DvError("MEDIA_HANDOFF", "Audio crossfade needs a nonempty transition.");
}
function sound(data: unknown): asserts data is SoundPlan {
  const s = object(data, ["id", "sourceIndex", "gain"], ["at", "handoff"]); identity(s.id); integer(s.sourceIndex); finite(s.gain, 0, 64);
  if (Boolean(s.at) === Boolean(s.handoff) || s.at !== undefined && s.at !== "enter" && s.at !== "exit") throw new DvError("MEDIA_SOUND", "Sound needs exactly one at/handoff trigger.");
  if (s.handoff !== undefined) identity(s.handoff);
}
function group(data: unknown): asserts data is GroupPlan {
  const g = object(data, ["id", "frameIndex", "properties", "motion", "units", "handoffs", "sounds"], ["clipIndex", "windowIndex", "until"]); identity(g.id); integer(g.frameIndex); properties(g.properties); validateMotion(g.motion); list(g.units); list(g.handoffs); list(g.sounds); if (g.clipIndex !== undefined) integer(g.clipIndex);
  if (g.until === undefined) { integer(g.windowIndex); if (g.units.length !== 1 || g.handoffs.length) throw new DvError("MEDIA_GROUP", "Item requires one unit and no handoffs."); }
  else if (g.windowIndex !== undefined || g.units.length < 2 || g.handoffs.length !== g.units.length - 1) throw new DvError("MEDIA_SEQUENCE", "Sequence requires two Members and one Handoff per adjacent pair.");
  const ids = new Set<string>();
  for (const u of g.units) { unit(u); if (ids.has(u.id)) throw new DvError("MEDIA_DUPLICATE", "Duplicate Member."); ids.add(u.id); if (g.until !== undefined && !u.instant || g.until === undefined && u.instant) throw new DvError("MEDIA_INSTANT", "Activation is required only for Sequence Members."); }
  const handoffs = new Set<string>(); for (const [i, h] of g.handoffs.entries()) { handoff(h); const preceding = g.units[i]; unit(preceding); if (h.from !== preceding.id || ids.has(h.id) || handoffs.has(h.id)) throw new DvError("MEDIA_HANDOFF", "Handoffs must uniquely name adjacent Members in order."); handoffs.add(h.id); }
  const sounds = new Set<string>(); for (const s of g.sounds) { sound(s); if (ids.has(s.id) || handoffs.has(s.id) || sounds.has(s.id) || s.handoff && !handoffs.has(s.handoff)) throw new DvError("MEDIA_SOUND", "Invalid or duplicate Sound identity/trigger."); sounds.add(s.id); }
}
export function validateMediaPlan(data: unknown): asserts data is MediaPlan {
  const p = object(data, ["trackKey", "groups", "hasAudio"]); identity(p.trackKey); list(p.groups); if (typeof p.hasAudio !== "boolean" || !p.groups.length) throw new DvError("MEDIA_PLAN", "Track requires groups and an audio declaration flag."); const ids = new Set<string>(); let hasAudio = false;
  for (const g of p.groups) { group(g); if (ids.has(g.id)) throw new DvError("MEDIA_DUPLICATE", "Duplicate group identity."); ids.add(g.id); hasAudio ||= g.sounds.length > 0 || g.units.some(u => u.sourceAudio !== undefined); }
  if (p.hasAudio !== hasAudio) throw new DvError("MEDIA_AUDIO", "Audio export flag must match declarations.");
}
function resolvedLayer(data: unknown, timeline: MediaProgram["timeline"]): asserts data is ResolvedLayer {
  const l = object(data, ["plan"], ["source", "appearance"]); layer(l.plan);
  if (l.plan.kind === "paint") { if (l.source !== undefined || l.appearance !== undefined) throw new DvError("MEDIA_PAINT", "Paint cannot carry a media source."); }
  else { if (l.source === undefined || l.appearance === undefined) throw new DvError("MEDIA_SOURCE", "Missing resolved source or appearance."); validateSource(l.source, timeline); validateAppearance(l.appearance); }
}
function resolvedUnit(data: unknown, lifetime: Bounds, timeline: MediaProgram["timeline"]): asserts data is ResolvedUnit {
  const u = object(data, ["plan", "logical", "visual", "layers"]); unit(u.plan); bounds(u.logical, lifetime); bounds(u.visual, lifetime); list(u.layers); if (u.layers.length !== u.plan.layers.length || u.visual.start > u.logical.start || u.visual.end < u.logical.end) throw new DvError("MEDIA_PROGRAM", "Resolved layer count or visual span mismatch.");
  for (const l of u.layers) resolvedLayer(l, timeline);
}
export function validateMediaProgram(data: unknown): asserts data is MediaProgram {
  const p = object(data, ["trackKey", "timeline", "canvas", "groups", "hasAudio"]); identity(p.trackKey); validateTimeline(p.timeline); validateCanvas(p.canvas); list(p.groups); if (typeof p.hasAudio !== "boolean" || !p.groups.length) throw new DvError("MEDIA_PROGRAM", "Program requires groups."); const plans: GroupPlan[] = [];
  for (const value of p.groups) {
    const g = object(value, ["plan", "frame", "appearance", "lifetime", "units", "handoffs", "sounds"], ["clip"]); group(g.plan); plans.push(g.plan); validateFrame(g.frame); validateAppearance(g.appearance); bounds(g.lifetime, { start: 0, end: p.timeline.totalFrames }); list(g.units); list(g.handoffs); list(g.sounds);
    if (g.frame.canvasKey !== p.canvas.canvasKey || g.units.length !== g.plan.units.length || g.handoffs.length !== g.plan.handoffs.length || g.sounds.length !== g.plan.sounds.length) throw new DvError("MEDIA_PROGRAM", "Canvas or resolved list count mismatch.");
    if (g.clip !== undefined) { validatePath(g.clip); if (g.clip.canvasKey !== p.canvas.canvasKey || g.appearance.clip !== "none") throw new DvError("MEDIA_CLIP", "Path clip conflicts with Canvas/appearance clip."); }
    for (const u of g.units) { resolvedUnit(u, g.lifetime, p.timeline); parseAppearance(`${g.plan.id}/${u.plan.id}`, g.frame, u.plan.properties ?? g.plan.properties); }
    let end = g.lifetime.start; for (const value of g.handoffs) { const h = object(value, ["plan", "boundary", "frames"]); handoff(h.plan); integer(h.boundary); const b = object(h.frames, ["start", "end"]); integer(b.start); integer(b.end); if (b.start < end || b.end < b.start || b.end > g.lifetime.end || b.end - b.start !== h.plan.duration || h.boundary < b.start || h.boundary > b.end) throw new DvError("MEDIA_HANDOFF", "Invalid resolved transition bounds."); end = b.end; }
    for (const value of g.sounds) { const s = object(value, ["plan", "source", "frame"]); sound(s.plan); validateSynchronizedMedia(s.source); integer(s.frame); if (!s.source.sound || s.source.sound.resource.mime !== "audio/wav" || s.frame >= p.timeline.totalFrames) throw new DvError("MEDIA_SOUND", "Sound needs normalized WAV and positive audible lifetime."); }
  }
  validateMediaPlan({ trackKey: p.trackKey, groups: plans, hasAudio: p.hasAudio });
}
