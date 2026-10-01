import { DvError } from "../../core/errors.ts";
import type { VisualTrack, VisualNode, Keyframe, StyleDeclaration, AudioTrack, AudioClip } from "../../render/ir.ts";
import type { Rect, Path } from "../../space/types.ts";
import { fitContent } from "../../space/math.ts";
import { frameToSample48k } from "../../timeline/math.ts";
import { frameInkCss, parseFrameInk } from "../performance/author.ts";
import type { MediaProgram, MediaGroup, ResolvedUnit } from "./types.ts";
import { validateMediaProgram } from "./validate.ts";
import { visualSampling } from "./source.ts";
import { parseAppearance } from "./appearance.ts";
import { motionKeyframes } from "./motion.ts";
import { lowerAudio } from "../audio-track/lower.ts";
import { projectWindow } from "../../timeline/temporal.ts";
function geometry(r: Rect): StyleDeclaration[] { return [{ property: "position", value: "absolute" }, { property: "left", value: `${r.xPx}px` }, { property: "top", value: `${r.yPx}px` }, { property: "width", value: `${r.widthPx}px` }, { property: "height", value: `${r.heightPx}px` }, { property: "box-sizing", value: "border-box" }]; }
function pathCss(path: Path, rect: Rect): string {
  const p = (point: Path["start"]) => `${point.xPx - rect.xPx} ${point.yPx - rect.yPx}`;
  const commands = [`M ${p(path.start)}`]; for (const segment of path.segments) commands.push(segment.kind === "line" ? `L ${p(segment.to)}` : segment.kind === "quadratic" ? `Q ${p(segment.control)} ${p(segment.to)}` : `C ${p(segment.control1)} ${p(segment.control2)} ${p(segment.to)}`);
  return `path("${commands.join(" ")} Z")`;
}
function unitKeys(group: MediaGroup, unit: ResolvedUnit, index: number): Keyframe[] {
  const incoming = group.handoffs[index - 1], outgoing = group.handoffs[index], rect = group.frame.rect;
  const edges = new Set<number>([group.lifetime.start, group.lifetime.end, unit.visual.start - 1, unit.visual.start, unit.visual.end - 1, unit.visual.end]);
  for (const h of [incoming, outgoing]) if (h) { edges.add(h.frames.start); edges.add(h.frames.end); }
  const keys: Keyframe[] = [];
  for (const absolute of [...edges].filter(f => f >= group.lifetime.start && f <= group.lifetime.end).sort((a, b) => a - b)) {
    const f = absolute - group.lifetime.start;
    let opacity = absolute >= unit.visual.start && absolute < unit.visual.end ? 1 : 0, x = 0, y = 0, angleX = 0, angleY = 0, clip = "none";
    for (const [h, entering] of [[incoming, true], [outgoing, false]] as const) {
      if (!h || !h.plan.duration || absolute < h.frames.start || absolute > h.frames.end) continue;
      const t = Math.max(0, Math.min(1, (absolute - h.frames.start) / h.plan.duration)), progress = entering ? 1 - t : t, plan = h.plan;
      if (plan.operator === "crossfade") opacity *= 1 - progress;
      const sign = plan.direction === "left" || plan.direction === "up" ? -1 : 1;
      if (plan.operator === "push" || plan.operator === "cover" && entering) { const move = entering ? -sign * progress : sign * progress; if (plan.direction === "left" || plan.direction === "right") x += rect.widthPx * move; else y += rect.heightPx * move; }
      if (plan.operator === "wipe" && entering) { const p = progress * 100; clip = plan.direction === "left" ? `inset(0 ${p}% 0 0)` : plan.direction === "right" ? `inset(0 0 0 ${p}%)` : plan.direction === "up" ? `inset(0 0 ${p}% 0)` : `inset(${p}% 0 0 0)`; }
      if (plan.operator === "page-turn") { if (entering) opacity *= t; else if (plan.direction === "up" || plan.direction === "down") angleX = sign * progress * 90; else angleY = sign * progress * 90; }
    }
    keys.push({ offsetFrames: f, easing: "linear", declarations: [{ property: "opacity", value: String(opacity) }, { property: "transform", value: `translate(${x}px, ${y}px) rotateX(${angleX}deg) rotateY(${angleY}deg)` }, { property: "clip-path", value: clip }] });
  }
  return keys;
}
export function lowerMediaVisual(program: MediaProgram): VisualTrack {
  validateMediaProgram(program);
  const presents: VisualTrack["presents"] = [];
  for (const [gi, g] of program.groups.entries()) {
    const root = `${g.plan.id}/motion`, rect = g.frame.rect, nodes: VisualNode[] = [];
    nodes.push({ kind: "box", nodeKey: root, parentKey: null, order: 0, style: geometry(rect), keyframes: motionKeyframes(g.plan.motion, g.lifetime, rect, program.canvas), attributes: [] });
    const viewport = `${g.plan.id}/viewport`, viewportStyle = geometry({ ...rect, xPx: 0, yPx: 0 });
    if (g.clip) viewportStyle.push({ property: "clip-path", value: pathCss(g.clip, rect) });
    else if (g.appearance.clip !== "none") viewportStyle.push({ property: "clip-path", value: `inset(0${g.appearance.clip === "rounded" ? ` round ${g.appearance.radiusPx}px` : ""})` });
    nodes.push({ kind: "box", nodeKey: viewport, parentKey: root, order: nodes.length, style: viewportStyle, keyframes: [], attributes: [] });
    for (const [ui, u] of g.units.entries()) {
      const key = `${g.plan.id}/${u.plan.id}`, appearance = parseAppearance(key, g.frame, u.plan.properties ?? g.plan.properties);
      const outer: StyleDeclaration[] = [...geometry({ ...rect, xPx: 0, yPx: 0 }), ...appearance.outerStyle.filter(s => s.property !== "opacity" && s.property !== "filter")];
      if (appearance.framePaint?.kind === "fill") outer.push({ property: appearance.framePaint.ink.kind === "solid" ? "background-color" : "background-image", value: frameInkCss(appearance.framePaint.ink) });
      if (g.clip) outer.push({ property: "clip-path", value: pathCss(g.clip, rect) }); else if (appearance.clip !== "none") outer.push({ property: "clip-path", value: `inset(0${appearance.clip === "rounded" ? ` round ${appearance.radiusPx}px` : ""})` });
      const transition = `${key}/handoff`;
      nodes.push({ kind: "box", nodeKey: transition, parentKey: viewport, order: nodes.length, style: geometry({ ...rect, xPx: 0, yPx: 0 }), keyframes: unitKeys(g, u, ui), attributes: [] });
      nodes.push({ kind: "box", nodeKey: key, parentKey: transition, order: nodes.length, style: outer, keyframes: [], attributes: [] });
      const [top, right, bottom, left] = appearance.contentInsetPx, border = Number.parseFloat(appearance.outerStyle.find(s => s.property === "border")?.value ?? "0"), inner = { xPx: rect.xPx + left, yPx: rect.yPx + top, widthPx: rect.widthPx - left - right, heightPx: rect.heightPx - top - bottom };
      for (const [li, layer] of u.layers.entries()) {
        const nodeKey = `${key}/${layer.plan.id}/${li}`;
        if (layer.plan.kind === "paint") { const ink = parseFrameInk(layer.plan.properties.paint); nodes.push({ kind: "box", nodeKey, parentKey: key, order: nodes.length, style: [...geometry({ ...inner, xPx: inner.xPx - rect.xPx - border, yPx: inner.yPx - rect.yPx - border }), { property: ink.kind === "solid" ? "background-color" : "background-image", value: frameInkCss(ink) }, { property: "opacity", value: String(layer.plan.properties.opacity ?? 1) }], keyframes: [], attributes: [] }); continue; }
        const source = layer.source!, style = layer.appearance!, extent = source.kind === "image" ? source.extent : source.kind === "media" ? source.media.picture!.extent : source.surface.extent;
        const fitted = fitContent(inner, extent, style.fit), length = u.visual.end - u.visual.start;
        const samplingKeys: Keyframe[] = layer.plan.sampling.map(s => ({ offsetFrames: u.visual.start - g.lifetime.start + Math.round(s.at * length), easing: s.easing ?? "linear", declarations: [{ property: "transform", value: `translate(${s.x}px, ${s.y}px) rotate(${s.rotate}deg) scale(${s.zoom})` }] }));
        if (samplingKeys.some((s, i) => i > 0 && s.offsetFrames <= samplingKeys[i - 1]!.offsetFrames)) throw new DvError("MEDIA_SAMPLING", "Sampling positions collapse to duplicate frame boundaries.");
        let parentKey = key, localRect = { ...fitted, xPx: fitted.xPx - rect.xPx - border, yPx: fitted.yPx - rect.yPx - border };
        if (samplingKeys.length) {
          parentKey = `${nodeKey}/sampling`;
          nodes.push({ kind: "box", nodeKey: parentKey, parentKey: key, order: nodes.length, style: geometry(localRect), keyframes: samplingKeys, attributes: [] });
          localRect = { ...fitted, xPx: 0, yPx: 0 };
        }
        const base = { nodeKey, parentKey, order: nodes.length, style: [...geometry(localRect), ...style.outerStyle.filter(s => s.property === "filter" || s.property === "opacity")], keyframes: [], attributes: [] };
        if (source.kind === "image") nodes.push({ ...base, kind: "image", resource: source.resource });
        else { const timing = source.kind === "media" ? source.media : source.surface.timing.kind === "frames" ? source.surface.timing : undefined; const sampling = timing ? visualSampling(timing.clock, timing.totalFrames, style.trim ?? { start: 0, end: timing.totalFrames }, style.playback, u.visual, u.visual) : undefined; if (sampling) for (const piece of sampling.pieces) { piece.target.start += u.visual.start - g.lifetime.start; piece.target.end += u.visual.start - g.lifetime.start; } if (source.kind === "media") nodes.push({ ...base, kind: "video", resource: source.media.picture!.resource, sampling: sampling! }); else nodes.push({ ...base, kind: "surface", surface: source.surface, ...(sampling ? { sampling } : {}) }); }
      }
    }
    presents.push({ presentKey: g.plan.id, axisKey: program.timeline.axisKey, lifetime: g.lifetime, layer: g.appearance.layer, layerKey: `${String(gi).padStart(16, "0")}/${program.trackKey}/${g.plan.id}`, rootKey: root, nodes });
  }
  return { kind: "visual", trackKey: `${program.trackKey}/visual`, axisKey: program.timeline.axisKey, presents };
}
export function lowerMediaAudio(program: MediaProgram): AudioTrack {
  validateMediaProgram(program);
  const clips: AudioClip[] = [], clock = program.timeline.clock;
  for (const g of program.groups) {
    for (const [ui, u] of g.units.entries()) {
      if (!u.plan.sourceAudio) continue;
      const layer = u.layers.find(l => l.plan.id === u.plan.sourceAudio)!, source = layer.source!;
      if (source.kind !== "media" || !source.media.sound) throw new DvError("MEDIA_AUDIO", "Source has no normalized sound.");
      const a = layer.appearance!, incoming = g.handoffs[ui - 1], outgoing = g.handoffs[ui];
      const target = { start: incoming?.plan.audio === "crossfade" ? incoming.frames.start : u.logical.start, end: outgoing?.plan.audio === "crossfade" ? outgoing.frames.end : u.logical.end };
      const trim = a.trim ?? { start: 0, end: source.media.totalFrames };
      const mode = a.playback === "hold-start" ? "once-start" : a.playback === "hold-end" ? "once-end" : a.playback;
      const key = `${g.plan.id}/${u.plan.id}/audio`;
      const window = projectWindow(program.timeline, { kind: "edges", start: `${u.visual.start}f`, end: `${u.visual.end}f` }, key);
      let lowered: AudioClip;
      if (mode === "stretch") {
        // The common frame-rate ratio governs both picture sampling and pitch-preserving sound.
        const sourceStart = frameToSample48k(trim.start, source.media.clock), sourceEnd = frameToSample48k(trim.end, source.media.clock);
        lowered = { clipKey: key, source: source.media.sound.resource, sourceTotalSamples: source.media.sound.totalSamples, sourceSamples: { start: sourceStart, end: sourceEnd }, targetSamples: { start: frameToSample48k(u.visual.start, clock), end: frameToSample48k(u.visual.end, clock) }, speed: { numerator: trim.end - trim.start, denominator: u.visual.end - u.visual.start }, preservePitch: true, gain: u.plan.audioGain, fadeInSamples: 0, fadeOutSamples: 0, gainCurve: [] };
      } else lowered = lowerAudio({ trackKey: program.trackKey, timeline: program.timeline, items: [{ source: source.media, window, plan: { itemKey: key, sourceIndex: 0, windowIndex: 0, playback: mode, gain: u.plan.audioGain, trimStart: `${trim.start}f`, trimEnd: `${trim.end}f`, fadeIn: "0f", fadeOut: "0f" } }] }).clips[0]!;
      const audible = { start: Math.max(lowered.targetSamples.start, frameToSample48k(target.start, clock)), end: Math.min(lowered.targetSamples.end, frameToSample48k(target.end, clock)) };
      if (audible.start !== lowered.targetSamples.start || audible.end !== lowered.targetSamples.end) lowered.audible = audible.end > audible.start ? [audible] : [];
      const curve = new Map<number, number>(); curve.set(lowered.targetSamples.start, 1); curve.set(lowered.targetSamples.end, 1);
      for (const [h, enter] of [[incoming, true], [outgoing, false]] as const) if (h?.plan.audio === "crossfade") { const hs = frameToSample48k(h.frames.start, clock), he = frameToSample48k(h.frames.end, clock); const start = Math.max(hs, lowered.targetSamples.start), end = Math.min(he, lowered.targetSamples.end); if (end > start) { curve.set(start, enter ? (start - hs) / (he - hs) : 1 - (start - hs) / (he - hs)); curve.set(end, enter ? (end - hs) / (he - hs) : 1 - (end - hs) / (he - hs)); } }
      lowered.gainCurve = [...curve].sort((a, b) => a[0] - b[0]).map(([sample, gain]) => ({ sample, gain })); clips.push(lowered);
    }
    for (const s of g.sounds) { const sound = s.source.sound!, start = frameToSample48k(s.frame, clock), end = Math.min(start + sound.totalSamples, frameToSample48k(program.timeline.totalFrames, clock)); clips.push({ clipKey: `${g.plan.id}/${s.plan.id}`, source: sound.resource, sourceTotalSamples: sound.totalSamples, sourceSamples: { start: 0, end: end - start }, targetSamples: { start, end }, speed: { numerator: 1, denominator: 1 }, preservePitch: true, gain: s.plan.gain, fadeInSamples: 0, fadeOutSamples: 0, gainCurve: [] }); }
  }
  return { kind: "audio", trackKey: `${program.trackKey}/audio`, axisKey: program.timeline.axisKey, clips };
}
