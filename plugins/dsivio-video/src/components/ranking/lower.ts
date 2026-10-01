import { DvError } from "../../core/errors.ts";
import type { VisualNode, VisualTrack, Present, StyleDeclaration, StyleProperty, Keyframe, Easing, AudioTrack, TextFlow } from "../../render/ir.ts";
import type { Bounds } from "../../timeline/types.ts";
import type { Rect } from "../../space/types.ts";
import { frameToSample48k } from "../../timeline/math.ts";
import { validateSynchronizedMedia } from "../../timeline/validate.ts";
import { validateVisualTrack, validateAudioTrack } from "../../render/validate.ts";
import { object } from "../../space/validate.ts";
import { validateRankingProgram, validateSoundStyle } from "./validate.ts";
import { rankingEvents } from "./program.ts";
import type { RankingProgram, RankingItem, RankingSounds, SoundStyle } from "./types.ts";
function css(values: Partial<Record<StyleProperty, string>>): StyleDeclaration[] { return Object.entries(values).map(([property, value]) => ({ property: property as StyleProperty, value })); }
function boxStyle(rect: Rect): StyleDeclaration[] { return css({ position: "absolute", left: `${rect.xPx}px`, top: `${rect.yPx}px`, width: `${rect.widthPx}px`, height: `${rect.heightPx}px`, "box-sizing": "border-box" }); }
function flow(text: string, nodeKey: string, program: RankingProgram, size?: number): TextFlow {
  return { format: { ...program.style.format, ...(size === undefined ? {} : { sizePx: size }) }, paragraphs: [{ paragraphKey: `${nodeKey}/p`, runs: [{ kind: "run", runKey: `${nodeKey}/r`, text }] }], sequences: [], layout: { mode: "area", inlineSize: "fixed", blockSize: "fixed", align: "center", blockAlign: "center", paddingPx: [0, 0, 0, 0], wrap: "word", overflow: "visible", columns: 1, columnGapPx: 0, metricEdge: "line-box", pointAnchor: { inline: "center", block: "center" }, clip: false } };
}
export function lowerRanking(program: RankingProgram): VisualTrack {
  validateRankingProgram(program);
  const { schedule, style, frame } = program, p = style.properties, r = frame.rect;
  const n = (name: string) => Number(p[name]), t = (name: string) => String(p[name]);
  const presents: Present[] = [];
  const node = (key: string, rect: Rect, style: StyleDeclaration[] = []): VisualNode => ({ nodeKey: key, parentKey: null, order: 0, kind: "box", style: [...boxStyle(rect), ...style], keyframes: [], attributes: [] });
  const publish = (key: string, lifetime: Bounds, layer: number, nodes: VisualNode[]) => { presents.push({ presentKey: key, axisKey: schedule.axisKey, lifetime, layer, layerKey: key, rootKey: nodes[0]!.nodeKey, nodes }); };
  const boardKey = `${schedule.trackKey}/board`;
  const board = node(boardKey, r, css({ "background-color": t("board-background"), border: `${n("board-border-width")}px solid ${t("board-border-color")}`, "border-radius": `${n("board-radius") || 0}px`, "box-shadow": schedule.kind === "TierBoard" ? "none" : `${n("board-shadow-x")}px ${n("board-shadow-y")}px ${n("board-shadow-blur")}px ${n("board-shadow-spread")}px ${t("board-shadow-color")}` }));
  const boardNodes = [board];
  const child = (rect: Rect, key: string, declarations: StyleDeclaration[]): VisualNode => { const c = node(key, { ...rect, xPx: rect.xPx - r.xPx, yPx: rect.yPx - r.yPx }, declarations); c.parentKey = boardKey; c.order = boardNodes.length; boardNodes.push(c); return c; };
  if (schedule.kind === "TierBoard") {
    const rows = (p.rows as unknown[]).map(object), border = n("board-border-width"), height = (r.heightPx - 2 * border) / rows.length;
    const labelWidth = p["label-width"] === undefined ? height : n("label-width") * r.widthPx;
    rows.forEach((row, index) => {
      const rowRect = { xPx: r.xPx + border, yPx: r.yPx + border + index * height, widthPx: r.widthPx - 2 * border, heightPx: height };
      child(rowRect, `${boardKey}/row/${index}`, css({ border: `${border}px solid ${t("board-border-color")}` }));
      const label = child({ ...rowRect, widthPx: labelWidth }, `${boardKey}/label/${index}`, css({ "background-color": String(row.color) }));
      Object.assign(label, { kind: "text-flow", flow: flow(String(row.label), label.nodeKey, program, height * n("label-size")) });
    });
  } else if (schedule.kind === "Column") {
    const colors = p["rank-colors"] as string[];
    for (const item of schedule.items) {
      const rowRect = { xPx: r.xPx + n("padding"), yPx: r.yPx + n("padding") + item.slot * (n("row-height") + n("row-gap")), widthPx: Math.max(1, r.widthPx - 2 * n("padding")), heightPx: n("row-height") };
      child(rowRect, `${boardKey}/row/${item.slot}`, css({ "background-color": "#ffffff11", "border-radius": `${n("icon-radius")}px` }));
      const rank = child({ ...rowRect, widthPx: n("row-height") }, `${boardKey}/rank/${item.slot}`, []);
      const rankFlow = flow(String(item.rank), rank.nodeKey, program); rankFlow.format = { ...rankFlow.format, paints: [{ kind: "fill", ink: { kind: "solid", color: colors[item.slot % colors.length]! } }] };
      Object.assign(rank, { kind: "text-flow", flow: rankFlow });
    }
  } else {
    board.style = boxStyle(r);
    const colors = p["slot-colors"] as string[], size = n("icon-size"), gap = n("slot-gap"), center = r.xPx + r.widthPx * n("center-x");
    for (let index = 0; index < 3; index++) child({ xPx: center - (3 * size + 2 * gap) / 2 + index * (size + gap), yPx: r.yPx + r.heightPx * n("baseline-y") - size / 2, widthPx: size, heightPx: size }, `${boardKey}/slot/${index}`, css({ border: `${n("ring-width")}px solid ${colors[index % colors.length]!}`, "border-radius": "50%" }));
  }
  publish(boardKey, schedule.outer.frames, n("board-stack"), boardNodes);
  const content = (item: RankingItem, key: string): VisualNode[] => {
    const root = node(key, item.target, css({ "transform-origin": "50% 50%" }));
    const image = node(`${key}/content`, { xPx: 0, yPx: 0, widthPx: item.target.widthPx, heightPx: item.target.heightPx });
    image.parentKey = key; image.order = 1;
    if (item.icon) { image.style.push(...css({ "border-radius": `${schedule.kind === "TierBoard" ? item.target.widthPx * n("icon-radius-ratio") : n("icon-radius")}px`, overflow: "hidden", "object-fit": t("icon-fit") })); Object.assign(image, { kind: "image", resource: item.icon }); }
    else Object.assign(image, { kind: "text-flow", flow: flow(item.label!, image.nodeKey, program) });
    const nodes = [root, image];
    if (schedule.kind === "TopThree") {
      const ring = node(`${key}/ring`, { xPx: 0, yPx: 0, widthPx: item.target.widthPx, heightPx: item.target.heightPx }, css({ border: `${n("ring-width")}px solid ${(p["slot-colors"] as string[])[item.slot % (p["slot-colors"] as string[]).length]!}`, "border-radius": "50%" })); ring.parentKey = key; ring.order = 2;
      // The active circle breathes once, then remains at its original scale.
      const length = item.active.end - item.active.start;
      if (length > 2) ring.keyframes = [{ offsetFrames: 0, easing: "ease-in-out", declarations: [{ property: "transform", value: "scale(1)" }] }, { offsetFrames: Math.floor(length / 2), easing: "ease-in-out", declarations: [{ property: "transform", value: "scale(1.08)" }] }, { offsetFrames: length - 1, easing: "ease-in-out", declarations: [{ property: "transform", value: "scale(1)" }] }];
      nodes.push(ring);
      const label = node(`${key}/label`, { xPx: -item.target.widthPx / 2, yPx: item.target.heightPx + n("label-gap"), widthPx: item.target.widthPx * 2, heightPx: program.style.format.sizePx * program.style.format.lineHeight * 2 }); label.parentKey = key; label.order = 3; Object.assign(label, { kind: "text-flow", flow: flow(item.label!, label.nodeKey, program) }); nodes.push(label);
    }
    return nodes;
  };
  for (const item of schedule.items) {
    if (item.preset) { publish(`${item.itemKey}/settled`, schedule.outer.frames, item.stack, content(item, `${item.itemKey}/settled`)); continue; }
    const nodes = content(item, `${item.itemKey}/active`), root = nodes[0]!;
    const easing = (schedule.kind === "TierBoard" ? "ease-in-out" : t("motion-easing")) as Easing;
    const poses = new Map<number, Keyframe>();
    const pose = (offsetFrames: number, transform: string, opacity = 1) => { poses.set(offsetFrames, { offsetFrames, easing, declarations: [{ property: "transform", value: transform }, { property: "opacity", value: String(opacity) }] }); };
    const length = item.active.end - item.active.start;
    const direct = schedule.kind === "TopThree" || item.entry === "direct";
    if (item.appearFrames) {
      if (direct) { pose(0, "translate(0px,24px) scale(0.65)", 0); const end = Math.min(length, item.appearFrames); if (end > 1 && item.entry === "direct") pose(Math.max(1, Math.floor(end / 2)), "translate(0px,0px) scale(1.12)"); if (end > 0) pose(end, "translate(0px,0px) scale(1)"); }
      else {
        const canvas = program.canvas!; const stageSize = n("stage-size");
        const stageX = canvas.extent.widthPx * n("stage-x"), stageY = canvas.extent.heightPx * n("stage-y");
        const dx = stageX - item.target.xPx - item.target.widthPx / 2, dy = stageY - item.target.yPx - item.target.heightPx / 2;
        const stageScale = stageSize / item.target.heightPx;
        const stageTransform = `translate(${dx}px,${dy}px) scale(${stageScale})`;
        pose(0, `translate(${dx}px,${canvas.extent.heightPx - item.target.yPx}px) scale(${stageScale * .7})`, 0);
        const moveOffset = item.moveFrame! - item.active.start;
        const appearEnd = Math.min(moveOffset, item.appearFrames);
        if (schedule.kind === "TierBoard" && appearEnd > 1) pose(Math.max(1, Math.floor(appearEnd / 2)), `translate(${dx}px,${dy}px) scale(${stageScale * 1.1})`);
        if (appearEnd > 0) pose(appearEnd, stageTransform);
        if (moveOffset > 0) pose(moveOffset, stageTransform);
        pose(length, "translate(0px,0px) scale(1,1)");
      }
    }
    root.keyframes = [...poses.values()].sort((a, b) => a.offsetFrames - b.offsetFrames);
    const lifetime = schedule.kind === "TopThree" ? { start: item.active.start, end: schedule.outer.frames.end } : item.active;
    publish(`${item.itemKey}/active`, lifetime, direct ? item.stack : n("stage-stack"), nodes);
    if (schedule.kind !== "TopThree" && item.settled) publish(`${item.itemKey}/settled`, item.settled, item.stack, content(item, `${item.itemKey}/settled`));
  }
  const track: VisualTrack = { kind: "visual", trackKey: schedule.trackKey, axisKey: schedule.axisKey, presents }; validateVisualTrack(track); return track;
}
export function lowerRankingAudio(program: RankingProgram, soundStyle: SoundStyle, sounds: RankingSounds): AudioTrack {
  validateRankingProgram(program); validateSoundStyle(soundStyle);
  for (const source of Object.values(sounds)) { validateSynchronizedMedia(source); if (!source.sound) throw new DvError("RANKING_SOUND", "Sound input must contain normalized audio"); }
  const events = rankingEvents(program);
  if (sounds.move && !events.events.some(e => e.kind === "move")) throw new DvError("RANKING_SOUND", "move-sound requires a matching movement event");
  const total = frameToSample48k(program.timeline.totalFrames, program.timeline.clock);
  const clips: AudioTrack["clips"] = [];
  for (const event of events.events) {
    const source = sounds[event.kind]; if (!source) continue;
    const sound = source.sound!, start = frameToSample48k(event.frame, program.timeline.clock), count = Math.min(sound.totalSamples, total - start);
    if (count <= 0) throw new DvError("RANKING_SOUND", "Sound event has no playable Timeline duration");
    clips.push({ clipKey: event.eventKey, source: sound.resource, sourceTotalSamples: sound.totalSamples, sourceSamples: { start: 0, end: count }, targetSamples: { start, end: start + count }, speed: { numerator: 1, denominator: 1 }, preservePitch: true, gain: event.kind === "appear" ? soundStyle.appearGain : soundStyle.moveGain, fadeInSamples: Math.min(count, frameToSample48k(soundStyle.fadeFrames, program.timeline.clock)), fadeOutSamples: 0, gainCurve: [] });
  }
  const track: AudioTrack = { kind: "audio", axisKey: program.timeline.axisKey, trackKey: `${program.schedule.trackKey}/audio`, clips }; validateAudioTrack(track); return track;
}
