import { DvError } from "../../core/errors.ts";
import type { Timeline } from "../../timeline/types.ts";
import type { Canvas } from "../../space/types.ts";
import { projectInstant, scheduleStages } from "../../timeline/temporal.ts";
import { parseAppearance } from "./appearance.ts";
import { validateSource } from "./source.ts";
import { validateMediaPlan, validateMediaProgram } from "./validate.ts";
import { parseFrameInk } from "../performance/author.ts";
import { finite } from "../sound/validate.ts";
import type { MediaPlan, MediaInputs, MediaProgram, MediaGroup, MediaSource } from "./types.ts";
export function assembleMediaProgram(timeline: Timeline, canvas: Canvas, plan: MediaPlan, inputs: MediaInputs): MediaProgram {
  validateMediaPlan(plan);
  const groups: MediaGroup[] = [];
  for (const g of plan.groups) {
    const frame = inputs.frames[g.frameIndex]; if (!frame || frame.canvasKey !== canvas.canvasKey) throw new DvError("MEDIA_FRAME", "Missing frame or wrong Canvas.");
    const appearance = parseAppearance(g.id, frame, g.properties);
    const triggers = g.units.map(u => ({ id: u.id, frame: u.instant ? projectInstant(timeline, u.instant, `${g.id}/${u.id}`).frame : 0 }));
    let lifetime;
    if (g.until) { const end = projectInstant(timeline, g.until, `${g.id}/until`).frame; lifetime = { start: triggers[0]!.frame, end }; }
    else { const window = inputs.windows[g.windowIndex!]; if (!window || window.axisKey !== timeline.axisKey || window.consumerKey !== g.id) throw new DvError("MEDIA_WINDOW", "Window is missing or belongs to another Timeline/consumer."); lifetime = window.frames; triggers[0]!.frame = lifetime.start; }
    const stages = scheduleStages(lifetime, triggers, lifetime.end);
    const handoffs = g.handoffs.map((h, i) => { const boundary = triggers[i + 1]!.frame, before = Math.floor(h.duration * h.ratio); return { plan: h, boundary, frames: { start: boundary - before, end: boundary + h.duration - before } }; });
    for (const [i, h] of handoffs.entries()) if (h.frames.start < lifetime.start || h.frames.end > lifetime.end || i > 0 && handoffs[i - 1]!.frames.end > h.frames.start) throw new DvError("MEDIA_HANDOFF", "Handoff exceeds Sequence lifetime or overlaps another Handoff.");
    if (g.motion.enter.frames + g.motion.exit.frames > lifetime.end - lifetime.start) throw new DvError("MEDIA_MOTION", "Group motions exceed its lifetime.");
    const units = g.units.map((u, i) => {
      const logical = stages[i]!.frames, incoming = handoffs[i - 1], outgoing = handoffs[i];
      const visual = { start: incoming ? Math.min(logical.start, incoming.frames.start) : logical.start, end: outgoing ? Math.max(logical.end, outgoing.frames.end) : logical.end };
      const layers = u.layers.map(l => {
        if (l.kind === "paint") { if (Object.keys(l.properties).some(k => k !== "paint" && k !== "opacity") || l.properties.paint === undefined) throw new DvError("MEDIA_PAINT", "Paint requires paint and only optional opacity."); parseFrameInk(l.properties.paint); finite(l.properties.opacity ?? 1, 0, 1); return { plan: l }; }
        let source: MediaSource;
        if (l.kind === "image") { const resource = inputs.images[l.sourceIndex], extent = inputs.extents[l.extentIndex!]; if (!resource || !extent) throw new DvError("MEDIA_SOURCE", "Missing image/extent."); source = { kind: "image", resource, extent }; }
        else if (l.kind === "media") { const media = inputs.media[l.sourceIndex]; if (!media) throw new DvError("MEDIA_SOURCE", "Missing media."); source = { kind: "media", media }; }
        else { const surface = inputs.surfaces[l.sourceIndex]; if (!surface) throw new DvError("MEDIA_SOURCE", "Missing Surface."); source = { kind: "surface", surface }; }
        validateSource(source, timeline);
        const direct = u.layers.length === 1 && l.id === "content";
        const resolved = parseAppearance(`${g.id}/${u.id}/${l.id}`, frame, l.properties, !direct);
        const timing = source.kind === "media" ? source.media : source.kind === "surface" && source.surface.timing.kind === "frames" ? source.surface.timing : undefined;
        if (!timing && (l.properties.playback !== undefined || l.properties["trim-start"] !== undefined || l.properties["trim-end"] !== undefined)) throw new DvError("MEDIA_STILL_PLAYBACK", "Still images cannot specify playback or source-frame trim.");
        if (timing && resolved.trim && resolved.trim.end > timing.totalFrames) throw new DvError("MEDIA_TRIM", "Trim exceeds source frames.");
        if (u.sourceAudio === l.id && (source.kind !== "media" || !source.media.sound || source.media.sound.resource.mime !== "audio/wav")) throw new DvError("MEDIA_AUDIO", "Selected source-audio must contain normalized WAV sound.");
        return { plan: l, source, appearance: resolved };
      });
      return { plan: u, logical, visual, layers };
    });
    const sounds = g.sounds.map(s => { const source = inputs.media[s.sourceIndex]; if (!source?.sound || source.sound.resource.mime !== "audio/wav") throw new DvError("MEDIA_SOUND", "Sound requires explicitly normalized WAV."); const frame = s.at === "enter" ? lifetime.start : s.at === "exit" ? lifetime.end - g.motion.exit.frames : handoffs.find(h => h.plan.id === s.handoff)!.boundary; if (frame >= timeline.totalFrames) throw new DvError("MEDIA_SOUND", "Sound trigger has no audible duration."); return { plan: s, source, frame }; });
    const group: MediaGroup = { plan: g, frame, appearance, lifetime, units, handoffs, sounds };
    if (g.clipIndex !== undefined) { const clip = inputs.clips[g.clipIndex]; if (!clip || clip.canvasKey !== canvas.canvasKey) throw new DvError("MEDIA_CLIP", "Path belongs to another Canvas or is missing."); group.clip = clip; }
    groups.push(group);
  }
  const program: MediaProgram = { trackKey: plan.trackKey, timeline, canvas, groups, hasAudio: plan.hasAudio }; validateMediaProgram(program); return program;
}
