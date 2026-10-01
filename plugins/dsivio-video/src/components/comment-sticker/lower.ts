import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { TextFlow, TextFormat, VisualNode, VisualTrack, StyleDeclaration } from "../../render/ir.ts";
import { BROWSER_PROGRAM_VERSION } from "../../render/ir.ts";
import type { StickerProgram, StickerStyle } from "./types.ts";
import { validateStickerProgram } from "./validate.ts";
import { number as n, text as t } from "./shared.ts";
import { frameInkCss, parseFrameInk } from "../performance/author.ts";
export const STICKER_MOTION_SETUP = `
const target=root.parentElement;
function ease(p,kind){
 p=Math.max(0,Math.min(1,p));if(p===0||p===1||kind==='linear')return p;
 if(kind==='out-back'){const q=p-1;return 1+2.70158*q*q*q+1.70158*q*q;}
 const x1=kind==='ease-out'?0:.42,x2=kind==='ease-in'?1:.58;
 let low=0,high=1,u=p;
 for(let i=0;i<20;i++){u=(low+high)/2;const v=1-u,x=3*v*v*u*x1+3*v*u*u*x2+u*u*u;if(x<p)low=u;else high=u;}
 return 3*(1-u)*u*u+u*u*u;
}
return frame=>{
 const p=data.properties;let opacity=1,y=0,scale=1,rotation=p.rotation;
 const enter=Math.min(data.frames,p['enter-frames']),exit=Math.min(data.frames,p['exit-frames']);
 if(p.enter!=='none'&&enter>0&&frame<enter){const q=ease(frame/enter,p['enter-easing']);opacity=Math.max(0,Math.min(1,q));if(p.enter==='pop'||p.enter==='slide-pop'){scale=p['enter-start-scale']+(1-p['enter-start-scale'])*q;rotation+=p['enter-rotation-delta']*(1-q);}if(p.enter==='slide-pop')y+=p['enter-offset-y']*(1-q);}
 const endStart=Math.max(enter,data.frames-exit);
 if(p.exit!=='none'&&exit>0&&frame>=endStart){const q=ease((frame-endStart)/Math.max(1,data.frames-endStart),p['exit-easing']);opacity*=1-Math.max(0,Math.min(1,q));if(p.exit==='fade-up')y+=p['exit-offset-y']*q;}
 if(p.hold==='float'&&frame>=enter&&frame<endStart){const wave=Math.sin((frame-enter)*Math.PI*2/p['hold-period-frames']);y+=wave*p['hold-amplitude-y'];rotation+=wave*p['hold-rotation-amplitude'];}
 target.style.opacity=String(opacity);target.style.transform='translateY('+y+'px) scale('+scale+') rotate('+rotation+'deg)';
};`;
function format(style: StickerStyle, role: string): TextFormat {
  const p = style.properties; const weight = Math.min(900, Math.max(100, Math.floor((n(p, `${role}-weight`) + 50) / 100) * 100));
  let preferred = style.fonts.faces[0]!;
  for (const face of style.fonts.faces) if (face.family === style.fonts.faces[0]!.family && (Math.abs(face.weight - weight) < Math.abs(preferred.weight - weight) || Math.abs(face.weight - weight) === Math.abs(preferred.weight - weight) && face.weight > preferred.weight)) preferred = face;
  return { fonts: { stackKey: `${style.fonts.stackKey}/${role}`, faces: [preferred, ...style.fonts.faces.filter(face => face !== preferred)] }, sizePx: n(p, `${role}-size`), lineHeight: n(p, `${role}-line-height`), trackingPx: 0, wordSpacingPx: 0, axes: [], features: [], direction: "auto", writingMode: "horizontal-tb", kerning: "auto", synthesis: "none", baselineShiftPx: 0, verticalAlign: "baseline", tabSize: 4, indentPx: 0, paragraphBeforePx: 0, paragraphAfterPx: 0, transform: "none", caps: "normal", cjkSpacing: "normal", punctuationTrim: "none", paints: [{ kind: "fill", ink: { kind: "solid", color: t(p, `${role}-color`) } }], decorations: [] };
}
export function lowerStickers(program: StickerProgram): VisualTrack {
  validateStickerProgram(program);
  const presents = program.stickers.map(item => {
    const p = item.style.properties, rect = item.frame.rect, key = item.itemKey; const nodes: VisualNode[] = [];
    const tailHeight = p.tail ? n(p, "tail-height") : 0, cardHeight = rect.heightPx - tailHeight;
    const px = n(p, "padding-x"), py = n(p, "padding-y"), border = n(p, "border-width"), gap = n(p, "gap");
    const initial = item.author?.replace(/^@+/, "").trim(); const hasAvatar = !!item.avatar || p["avatar-fallback"] === "initial" && !!initial;
    const avatarSize = n(p, "avatar-size"), textX = px + border + (hasAvatar ? avatarSize + gap : 0), width = rect.widthPx - textX - px - border;
    const headerHeight = n(p, "header-size") * n(p, "header-line-height"), metaHeight = item.meta ? n(p, "meta-size") * n(p, "meta-line-height") + gap : 0;
    const bodyY = py + border + headerHeight + gap, bodyHeight = cardHeight - bodyY - py - border - metaHeight;
    if (width < n(p, "body-size")) throw new DvError("STICKER_TOO_NARROW", "Sticker frame is too narrow for padding, avatar and text.");
    if (bodyHeight < n(p, "body-size") * n(p, "body-line-height") || hasAvatar && cardHeight < avatarSize + 2 * (py + border)) throw new DvError("STICKER_TOO_SHORT", "Sticker frame is too short for avatar, header, body, meta and tail.");
    function add(node: Omit<VisualNode, "order">): void { nodes.push({ ...node, order: nodes.length } as VisualNode); }
    function box(nodeKey: string, parentKey: string | null, style: StyleDeclaration[]): void { add({ kind: "box", nodeKey, parentKey, style, keyframes: [], attributes: [] }); }
    box(key, null, [{ property: "position", value: "absolute" }, { property: "left", value: `${rect.xPx}px` }, { property: "top", value: `${rect.yPx}px` }, { property: "width", value: `${rect.widthPx}px` }, { property: "height", value: `${rect.heightPx}px` }, { property: "transform-origin", value: "center center" }]);
    box(`${key}/card`, key, [{ property: "width", value: "100%" }, { property: "height", value: `${cardHeight}px` }, { property: "box-sizing", value: "border-box" }, { property: "background-color", value: t(p, "background") }, { property: "border", value: `${border}px solid ${t(p, "border-color")}` }, { property: "border-radius", value: `${n(p, "radius")}px` }, { property: "box-shadow", value: `${n(p, "shadow-x")}px ${n(p, "shadow-y")}px ${n(p, "shadow-blur")}px ${n(p, "shadow-spread")}px ${t(p, "shadow-color")}` }]);
    if (p.tail) box(`${key}/tail`, key, [{ property: "position", value: "absolute" }, { property: "left", value: `${n(p, "tail-offset-x")}px` }, { property: "top", value: `${cardHeight - border}px` }, { property: "width", value: `${n(p, "tail-width")}px` }, { property: "height", value: `${tailHeight}px` }, { property: "background-color", value: t(p, "background") }, { property: "clip-path", value: "polygon(0% 0%,100% 0%,25% 100%)" }]);
    function textNode(role: string, content: string, x: number, y: number, w: number, h: number): void {
      const flow: TextFlow = { format: format(item.style, role), paragraphs: [{ paragraphKey: `${key}/${role}/p`, runs: [{ kind: "run", runKey: `${key}/${role}/run`, text: content }] }], layout: { mode: "area", inlineSize: "fixed", blockSize: "fixed", align: "start", blockAlign: "start", paddingPx: [0, 0, 0, 0], wrap: "word", overflow: "ellipsis", columns: 1, columnGapPx: 0, maxLines: role === "body" ? n(p, "body-max-lines") : 1, metricEdge: "line-box", pointAnchor: { inline: "start", block: "start" }, clip: true }, sequences: [] };
      add({ kind: "text-flow", flow, nodeKey: `${key}/${role}`, parentKey: key, keyframes: [], attributes: [], style: [{ property: "position", value: "absolute" }, { property: "left", value: `${x}px` }, { property: "top", value: `${y}px` }, { property: "width", value: `${w}px` }, { property: "height", value: `${h}px` }] } as Omit<VisualNode, "order">);
    }
    if (hasAvatar) {
      const avatarKey = `${key}/avatar`; const avatarBackground = frameInkCss(parseFrameInk(p["avatar-background"]!));
      const style: StyleDeclaration[] = [{ property: "position", value: "absolute" }, { property: "left", value: `${px + border}px` }, { property: "top", value: `${py + border}px` }, { property: "width", value: `${avatarSize}px` }, { property: "height", value: `${avatarSize}px` }, { property: "box-sizing", value: "border-box" }, { property: "border-radius", value: "50%" }, { property: "overflow", value: "hidden" }, { property: "border", value: `${n(p, "avatar-border-width")}px solid ${t(p, "avatar-border-color")}` }, { property: avatarBackground.startsWith("#") ? "background-color" : "background-image", value: avatarBackground }, { property: "object-fit", value: "cover" }];
      if (item.avatar) add({ kind: "image", resource: item.avatar, nodeKey: avatarKey, parentKey: key, style, keyframes: [], attributes: [] } as Omit<VisualNode, "order">);
      else { box(avatarKey, key, style); const avatarFormat = format(item.style, "header"); avatarFormat.sizePx = avatarSize * 0.5; avatarFormat.paints = [{ kind: "fill", ink: { kind: "solid", color: t(p, "avatar-text-color") } }]; add({ kind: "text", text: Array.from(initial!)[0]!.toUpperCase(), format: avatarFormat, nodeKey: `${avatarKey}/initial`, parentKey: avatarKey, style: [{ property: "width", value: "100%" }, { property: "height", value: "100%" }, { property: "display", value: "flex" }, { property: "align-items", value: "center" }, { property: "justify-content", value: "center" }], keyframes: [], attributes: [] } as Omit<VisualNode, "order">); }
    }
    textNode("header", item.header ?? (item.author ? `Replying to ${item.author}` : "Replying to a comment"), textX, py + border, width, headerHeight);
    textNode("body", item.comment, textX, bodyY, width, bodyHeight);
    if (item.meta) textNode("meta", item.meta, textX, cardHeight - py - border - metaHeight + gap, width, metaHeight - gap);
    const frames = item.window.frames.end - item.window.frames.start;
    add({ kind: "program", nodeKey: `${key}/motion`, parentKey: key, style: [], keyframes: [], attributes: [], program: { format: BROWSER_PROGRAM_VERSION, html: "", css: "", setup: STICKER_MOTION_SETUP, data: { properties: p, frames } as Json, resources: [] } } as Omit<VisualNode, "order">);
    return { presentKey: key, axisKey: program.timeline.axisKey, lifetime: item.window.frames, layer: n(p, "stack-order"), layerKey: key, rootKey: key, nodes };
  });
  return { kind: "visual", trackKey: program.trackKey, axisKey: program.timeline.axisKey, presents };
}
