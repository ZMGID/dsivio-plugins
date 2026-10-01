import type { Keyframe, Present, StyleDeclaration, VideoSamplingMap, VisualNode, VisualTrack } from "../../render/ir.ts";
import type { Rect } from "../../space/types.ts";
import { fitContent } from "../../space/math.ts";
import { frameInkCss } from "../performance/author.ts";
import { visualSampling } from "../media-track/source.ts";
import { motionKeyframes } from "../media-track/motion.ts";
import { deckStages, depthPose } from "./program.ts";
import { validateDeckProgram } from "./validate.ts";
import type { DeckPose, DeckProgram } from "./types.ts";

function geometry(rect: Rect): StyleDeclaration[] {
  return [{ property: "position", value: "absolute" }, { property: "left", value: `${rect.xPx}px` }, { property: "top", value: `${rect.yPx}px` }, { property: "width", value: `${rect.widthPx}px` }, { property: "height", value: `${rect.heightPx}px` }];
}
function declarations(pose: DeckPose): Keyframe["declarations"] {
  return [{ property: "transform", value: `translate(${pose.x}px, ${pose.y}px) rotate(${pose.rotation}deg) scale(${pose.scale})` }, { property: "opacity", value: String(pose.opacity) }, { property: "filter", value: `brightness(${pose.brightness}) contrast(${pose.contrast}) saturate(${pose.saturation})` }];
}
export function lowerDeck(program: DeckProgram): VisualTrack {
  validateDeckProgram(program);
  const stages = deckStages(program), presents: Present[] = [];
  const groupLifetime = { start: stages[0]!.frames.start, end: program.terminal.frame };
  const motionKeys = program.cards.map(card => motionKeyframes(card.motion, groupLifetime, card.appearance.frame.rect, program.canvas));
  for (const [stageIndex, stage] of stages.entries()) {
    const previous = stageIndex ? stages[stageIndex - 1]!.poses : stage.poses;
    const indices = [...new Set([...previous.keys(), ...stage.poses.keys()])];
    for (const index of indices) {
      const card = program.cards[index]!, before = previous.get(index), after = stage.poses.get(index);
      if (!after && (!stageIndex || !program.style.reflowFrames)) continue;
      // Invisible endpoints still have a depth pose: incoming/outgoing cards move, not only fade.
      const priorIndex = stageIndex ? stages[stageIndex - 1]!.activeIndex : stage.activeIndex;
      let priorDepth = index - priorIndex, nextDepth = index - stage.activeIndex;
      if (program.style.wrap) {
        for (const offset of [-program.cards.length, program.cards.length]) {
          if (Math.abs(priorDepth + offset) < Math.abs(priorDepth)) priorDepth += offset;
          if (Math.abs(nextDepth + offset) < Math.abs(nextDepth)) nextDepth += offset;
        }
      }
      const origin = before ?? { ...depthPose(card.depth, priorDepth), opacity: 0 };
      const destination = after ?? { ...depthPose(card.depth, nextDepth), opacity: 0 };
      const lifetime = { start: stage.frames.start, end: after ? stage.frames.end : stage.frames.start + program.style.reflowFrames };
      const rootKey = `${program.trackKey}/${stageIndex}/${card.cardKey}`, frameKey = `${rootKey}/frame`;
      const depthKeys: Keyframe[] = stageIndex && program.style.reflowFrames ? [{ offsetFrames: 0, easing: program.style.reflowEasing, declarations: declarations(origin) }, { offsetFrames: program.style.reflowFrames, easing: "linear", declarations: declarations(destination) }] : [];
      const { rect } = card.appearance.frame;
      const source = card.source, extent = source.kind === "image" ? source.extent : source.kind === "media" ? source.media.picture!.extent : source.surface.extent;
      const [top, right, bottom, left] = card.appearance.contentInsetPx;
      const fitted = fitContent({ xPx: left, yPx: top, widthPx: rect.widthPx - left - right, heightPx: rect.heightPx - top - bottom }, extent, card.appearance.fit);
      const border = card.appearance.outerStyle.find(item => item.property === "border"), borderWidth = border ? Number.parseFloat(border.value) : 0;
      const sourceStyle = geometry({ ...fitted, xPx: fitted.xPx - borderWidth, yPx: fitted.yPx - borderWidth });
      const frameStyle = [...geometry({ ...rect, xPx: 0, yPx: 0 }), ...card.appearance.outerStyle];
      if (card.appearance.clip === "frame") frameStyle.push({ property: "clip-path", value: "inset(0)" });
      if (card.appearance.clip === "rounded") frameStyle.push({ property: "clip-path", value: `inset(0 round ${card.appearance.radiusPx}px)` });
      if (card.appearance.framePaint?.kind === "fill") frameStyle.push({ property: card.appearance.framePaint.ink.kind === "solid" ? "background-color" : "background-image", value: frameInkCss(card.appearance.framePaint.ink) });
      // Keep the group motion clock across reflows; sampling and appearance are separate layers.
      const motionKey = `${rootKey}/motion`;
      const keys = motionKeys[index]!.filter(key => key.offsetFrames >= lifetime.start - groupLifetime.start && key.offsetFrames <= lifetime.end - groupLifetime.start).map(key => ({ ...key, offsetFrames: key.offsetFrames - lifetime.start + groupLifetime.start }));
      const nodes: VisualNode[] = [
        { kind: "box", nodeKey: rootKey, parentKey: null, order: 0, attributes: [], style: [...geometry(rect), ...declarations(destination)], keyframes: depthKeys },
        { kind: "box", nodeKey: motionKey, parentKey: rootKey, order: 1, attributes: [], style: geometry({ ...rect, xPx: 0, yPx: 0 }), keyframes: keys },
        { kind: "box", nodeKey: frameKey, parentKey: motionKey, order: 2, attributes: [], style: frameStyle, keyframes: [] },
      ];
      const sourceBase = { nodeKey: `${rootKey}/source`, parentKey: frameKey, order: 3, style: sourceStyle, keyframes: [], attributes: [] };
      let sampling: VideoSamplingMap | undefined;
      const moving = source.kind === "media" ? source.media : source.kind === "surface" && source.surface.timing.kind === "frames" ? source.surface.timing : undefined;
      if (moving) {
        const trim = card.appearance.trim ?? { start: 0, end: moving.totalFrames };
        const logical = { start: card.activation.frame, end: stages[index]!.frames.end };
        const active = index === stage.activeIndex;
        const continuePlaying = index < stage.activeIndex ? card.depth.playbackPast === "continue" : card.depth.playbackFuture === "continue";
        if (active || continuePlaying) sampling = visualSampling(moving.clock, moving.totalFrames, trim, active ? card.appearance.playback : "loop-start", lifetime, logical);
        else sampling = { sourceClock: moving.clock, sourceTotalFrames: moving.totalFrames, pieces: [{ target: { start: 0, end: lifetime.end - lifetime.start }, sourceStart: { numerator: index < stage.activeIndex ? trim.end - 1 : trim.start, denominator: 1 }, sourceStep: { numerator: 0, denominator: 1 } }] };
      }
      if (source.kind === "image") nodes.push({ ...sourceBase, kind: "image", resource: source.resource });
      else if (source.kind === "media") nodes.push({ ...sourceBase, kind: "video", resource: source.media.picture!.resource, sampling: sampling! });
      else nodes.push({ ...sourceBase, kind: "surface", surface: source.surface, ...(sampling ? { sampling } : {}) });
      if (card.label) nodes.push({ kind: "text-flow", nodeKey: `${rootKey}/label`, parentKey: frameKey, order: 4, attributes: [], keyframes: [], style: geometry({ xPx: -borderWidth, yPx: -borderWidth, widthPx: rect.widthPx, heightPx: rect.heightPx }), flow: card.label.flow });
      presents.push({ presentKey: rootKey, axisKey: program.timeline.axisKey, lifetime, layer: card.appearance.layer + destination.stacking, layerKey: `${program.trackKey}/${String(index).padStart(4, "0")}`, rootKey, nodes });
    }
  }
  return { kind: "visual", trackKey: program.trackKey, axisKey: program.timeline.axisKey, presents };
}
