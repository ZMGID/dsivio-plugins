import type { VisualTrack, VisualNode, StyleDeclaration } from "../../render/ir.ts";
import { BROWSER_PROGRAM_VERSION } from "../../render/ir.ts";
import type { EmojiProgram } from "./types.ts";
import { validateEmojiProgram, emojiStripRect } from "./validate.ts";
import { number as n, text as t } from "../comment-sticker/shared.ts";
export const EMOJI_REVEAL_SETUP = `
const container=root.parentElement;
const placeholder=container.querySelector('[data-emoji="placeholder"]');
const icon=container.querySelector('[data-emoji="answer"]');
const points=data.points;
return frame=>{
 const active=data.activation===null||frame>=data.activation;
 placeholder.style.visibility=active?'hidden':'inherit';icon.style.visibility=active?'inherit':'hidden';
 let scale=1;
 if(active&&data.activation!==null){scale=points[points.length-1].scale;for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];if(frame<b.frame){const p=Math.max(0,Math.min(1,(frame-a.frame)/Math.max(1,b.frame-a.frame)));scale=a.scale+(b.scale-a.scale)*p;break;}}}
 icon.style.transform='scale('+scale+')';
};`;
export function lowerEmojiReveal(program: EmojiProgram): VisualTrack {
  validateEmojiProgram(program); const p = program.style.properties, key = program.trackKey; const nodes: VisualNode[] = [];
  const slot = n(p, "slot-size"), gap = n(p, "slot-gap"), px = n(p, "padding-x"), py = n(p, "padding-y"), size = n(p, "icon-size");
  const rect = emojiStripRect(program.canvas, p, program.items.length);
  nodes.push({ kind: "box", nodeKey: key, parentKey: null, order: 0, attributes: [], keyframes: [], style: [{ property: "position", value: "absolute" }, { property: "left", value: `${rect.xPx}px` }, { property: "top", value: `${rect.yPx}px` }, { property: "width", value: `${rect.widthPx}px` }, { property: "height", value: `${rect.heightPx}px` }] });
  nodes.push({ kind: "box", nodeKey: `${key}/board`, parentKey: key, order: 1, attributes: [], keyframes: [], style: [{ property: "position", value: "absolute" }, { property: "left", value: "0px" }, { property: "top", value: "0px" }, { property: "width", value: "100%" }, { property: "height", value: "100%" }, { property: "box-sizing", value: "border-box" }, { property: "background-color", value: t(p, "background") }, { property: "border", value: `${n(p, "border-width")}px solid ${t(p, "border-color")}` }, { property: "border-radius", value: `${n(p, "radius")}px` }, { property: "box-shadow", value: `${n(p, "shadow-x")}px ${n(p, "shadow-y")}px ${n(p, "shadow-blur")}px ${n(p, "shadow-spread")}px ${t(p, "shadow-color")}` }] });
  program.items.forEach((item, index) => {
    const activation = item.activationFrame === undefined ? null : item.activationFrame - program.outer.frames.start;
    const duration = program.outer.frames.end - program.outer.frames.start;
    nodes.push({ kind: "box", nodeKey: item.itemKey, parentKey: key, order: nodes.length, style: [{ property: "position", value: "absolute" }, { property: "left", value: `${px + index * (slot + gap)}px` }, { property: "top", value: `${py}px` }, { property: "width", value: `${slot}px` }, { property: "height", value: `${slot}px` }], keyframes: [], attributes: [] });
    const iconStyle: StyleDeclaration[] = [{ property: "position", value: "absolute" }, { property: "left", value: `${(slot - size) / 2}px` }, { property: "top", value: `${(slot - size) / 2}px` }, { property: "width", value: `${size}px` }, { property: "height", value: `${size}px` }, { property: "object-fit", value: "contain" }];
    nodes.push({ kind: "image", resource: program.placeholder, nodeKey: `${item.itemKey}/placeholder`, parentKey: item.itemKey, order: nodes.length, style: iconStyle, keyframes: [], attributes: [{ name: "data-emoji", value: "placeholder" }] });
    nodes.push({ kind: "image", resource: item.icon, nodeKey: `${item.itemKey}/answer`, parentKey: item.itemKey, order: nodes.length, style: iconStyle, keyframes: [], attributes: [{ name: "data-emoji", value: "answer" }] });
    const points: { frame: number; scale: number }[] = [];
    if (activation !== null) {
      for (const [fraction, scale] of [[0, 0.72], [0.34, 1.14], [0.68, 0.95], [1, 1]] as const) {
        const frame = Math.min(duration, activation + Math.round(n(p, "reveal-frames") * fraction));
        if (points.at(-1)?.frame === frame) { if (frame !== activation) points[points.length - 1] = { frame, scale }; }
        else points.push({ frame, scale });
      }
    }
    nodes.push({ kind: "program", nodeKey: `${item.itemKey}/reveal`, parentKey: item.itemKey, order: nodes.length, style: [], keyframes: [], attributes: [], program: { format: BROWSER_PROGRAM_VERSION, html: "", css: "", setup: EMOJI_REVEAL_SETUP, data: { activation, points }, resources: [] } });
  });
  return { kind: "visual", trackKey: key, axisKey: program.timeline.axisKey, presents: [{ presentKey: key, axisKey: program.timeline.axisKey, lifetime: program.outer.frames, layer: n(p, "stack-order"), layerKey: key, rootKey: key, nodes }] };
}
