import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { TextFlow, TextRun, VisualNode, VisualTrack } from "../../render/ir.ts";
import { BROWSER_PROGRAM_VERSION } from "../../render/ir.ts";
import { validateVisualTrack } from "../../render/validate.ts";
import { padding } from "./style.ts";
import { scheduleFine } from "./program.ts";
import type { FineProgram } from "./types.ts";
import { fineRuntimeSource } from "./runtime.ts";
export function lowerFine(program: FineProgram): VisualTrack {
 const schedule = scheduleFine(program);
 const presents = schedule.items.map(item => {
  const cue = program.content.cues.find(cue => cue.cueKey === item.cueKey)!, use = program.uses.find(use => use.useKey === item.useKey)!;
  if (use.style.kind !== "fine") throw new DvError("CAPTION_STYLE", "Visible caption schedule requires a Fine Style");
  const style = use.style, p = style.recipe, limit = Number(p["max-words-per-line"] ?? Infinity), units = cue.units.filter(unit => unit.text);
  if (p["max-lines"] !== undefined && Math.ceil(units.length / limit) > Number(p["max-lines"])) throw new DvError("CAPTION_LINES", "Caption Cue exceeds the structural max-lines limit");
  const key = `${program.trackKey}/${cue.cueKey}/${use.useKey}`, rootKey = `${key}/program`, baseKey = `${key}/base`, activeKey = `${key}/active`;
  const runs: TextRun[] = [];
  units.forEach((unit, index) => { if (index && index % limit === 0) runs.push({ kind: "break" }); else if (index && unit.separator) runs.push({ kind: "run", runKey: `${unit.unitKey}/separator`, text: unit.separator }); runs.push({ kind: "run", runKey: unit.unitKey, text: unit.text }); });
  const flow: TextFlow = { paragraphs: [{ paragraphKey: cue.cueKey, runs }], format: style.base, layout: { mode: "area", inlineSize: p["inline-size"] as "hug" | "fixed", blockSize: p.height === undefined ? "hug" : "fixed", align: p.align === "left" ? "start" : p.align === "right" ? "end" : "center", blockAlign: p["block-align"] as "start" | "center" | "end", paddingPx: padding(p.padding!), wrap: p.wrap as "word" | "grapheme", overflow: "visible", columns: 1, columnGapPx: 0, metricEdge: "line-box", pointAnchor: { inline: "start", block: "start" }, clip: false }, sequences: [] };
  const anchorX = p["anchor-x"] === "center" ? 50 : p["anchor-x"] === "right" ? 100 : 0, anchorY = p["anchor-y"] === "center" ? 50 : p["anchor-y"] === "bottom" ? 100 : 0;
  const n = (name: string) => Number(p[name]);
  const shadow = n("cue-shadow-opacity") ? `box-shadow:${n("cue-shadow-x")}px ${n("cue-shadow-y")}px ${n("cue-shadow-blur")}px ${n("cue-shadow-spread")}px color-mix(in srgb,${p["cue-shadow-color"]} ${n("cue-shadow-opacity") * 100}%,transparent);` : "";
  const regions = program.regions?.tracks.find(track => track.role === cue.role)?.frames;
  const root: VisualNode = { kind: "program", nodeKey: rootKey, parentKey: null, order: 0, keyframes: [], attributes: [], style: [{ property: "position", value: "absolute" }, { property: "left", value: `${n("x") * 100}%` }, { property: "top", value: `${n("y") * 100}%` }, { property: "width", value: `${n("width") * 100}%` }, ...(p.height === undefined ? [] : [{ property: "height" as const, value: `${n("height") * 100}%` }])], program: { format: BROWSER_PROGRAM_VERSION, html: `<div data-caption-placement><div data-caption-card>{{${baseKey}}}{{${activeKey}}}</div></div>`, css: `[data-caption-placement]{position:relative;width:${p["inline-size"] === "fixed" ? "100%" : "fit-content"};max-width:100%;${p.height === undefined ? "" : "height:100%;"}transform:translate(-${anchorX}%,-${anchorY}%)} [data-caption-card]{position:relative;isolation:isolate;background:${p.background};border:${p["border-width"]}px solid ${p["border-color"]};border-radius:${p.radius}px;${shadow}${p.height === undefined ? "" : "height:100%;"}} [data-caption-base]{position:relative;z-index:1;width:100%;${p.height === undefined ? "" : "height:100%;"}} [data-caption-active]{position:absolute;z-index:2;inset:0;width:100%;height:100%;pointer-events:none} [data-caption-base]>div,[data-caption-active]>div{max-width:100%}`, setup: fineRuntimeSource(), data: { recipe: p, units, start: item.lifetime.start, end: item.lifetime.end, ...(regions === undefined ? {} : { regions }) } as unknown as Json, resources: [] } };
  const base: VisualNode = { kind: "text-flow", nodeKey: baseKey, parentKey: rootKey, order: 1, style: [], keyframes: [], attributes: [{ name: "data-caption-base", value: "" }], flow };
  const active: VisualNode = { ...base, nodeKey: activeKey, order: 2, attributes: [{ name: "data-caption-active", value: "" }], flow: { ...flow, format: style.active } };
  return { presentKey: key, axisKey: program.timeline.axisKey, lifetime: item.lifetime, visible: item.visible, layer: n("stack-order"), layerKey: key, rootKey, nodes: [root, base, active] };
 });
 const track: VisualTrack = { kind: "visual", trackKey: program.trackKey, axisKey: program.timeline.axisKey, presents }; validateVisualTrack(track); return track;
}
