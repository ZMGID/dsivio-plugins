import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { TypographyAuthorPlan, TypographyProgram, TypographyStyle } from "../../components/types.ts";
import { trackTypes } from "../../components/types.ts";
import type { VisualTrack } from "../../render/ir.ts";
import { renderTypes } from "../../render/ir.ts";
import type { CompanionInput, FieldGroup, ParameterOwner, StudioCompanion } from "../../studio/companion.ts";
import { parameterOwner, field } from "../../studio/projection.ts";
import { baseEntity, recipeFields } from "../sound/studio.ts";
import type { AuthorItem } from "../sound/studio.ts";

export function typoAuthorItems(value: Json): AuthorItem[] {
  return (value as unknown as TypographyAuthorPlan).items.map(item => ({ identity: item.itemKey, windowIndex: item.windowIndex, styleIndex: item.styleIndex }));
}
function typographyFields(input: CompanionInput, owner: ParameterOwner): FieldGroup[] {
  const style = owner.value.data as unknown as TypographyStyle; const f = style.format; const l = style.layout;
  const fill = f.paints.find(paint => paint.kind === "fill" && paint.ink.kind === "solid");
  const values: Record<string, Json> = {
    "stack-order": style.layer, size: f.sizePx, weight: f.fonts.faces[0]!.weight, "font-style": f.fonts.faces[0]!.style,
    "line-height": f.lineHeight, tracking: f.trackingPx, "word-spacing": f.wordSpacingPx, kerning: f.kerning, synthesis: f.synthesis,
    language: f.language ?? "", direction: f.direction, "writing-mode": f.writingMode, "baseline-shift": f.baselineShiftPx, "vertical-align": f.verticalAlign,
    "tab-size": f.tabSize, indent: f.indentPx, "paragraph-before": f.paragraphBeforePx, "paragraph-after": f.paragraphAfterPx,
    transform: f.transform, caps: f.caps, "cjk-spacing": f.cjkSpacing, "punctuation-trim": f.punctuationTrim,
    fill: fill?.ink.kind === "solid" ? fill.ink.color : "#000000",
    "inline-size": l.inlineSize, "block-size": l.blockSize, padding: l.paddingPx.join(" "), align: l.align, "block-align": l.blockAlign, wrap: l.wrap,
    overflow: l.overflow, "max-lines": l.maxLines ?? "", "minimum-scale": l.minimumScale ?? "", clip: l.clip, columns: l.columns, "column-gap": l.columnGapPx,
    "metric-edge": l.metricEdge, "point-anchor-inline": l.pointAnchor.inline, "point-anchor-block": l.pointAnchor.block,
    "path-side": style.path.side, "path-orientation": style.path.orientation, "path-start-margin": style.path.startMarginPx, "path-end-margin": style.path.endMarginPx,
    "path-align": style.path.align, "path-reverse": style.path.reverse, "path-overflow": style.path.overflow,
  };
  const options: Record<string, string[]> = { kerning: ["auto", "normal", "none"], synthesis: ["none"], direction: ["auto", "ltr", "rtl"], "writing-mode": ["horizontal-tb", "vertical-rl", "vertical-lr"], "vertical-align": ["baseline", "super", "sub"], transform: ["none", "uppercase", "lowercase", "capitalize"], caps: ["normal", "small-caps", "all-small-caps"], "cjk-spacing": ["normal", "none"], "punctuation-trim": ["none", "start", "end", "adjacent", "all"], "inline-size": ["hug", "fixed"], "block-size": ["hug", "fixed"], align: ["start", "center", "end", "justify"], "block-align": ["start", "center", "end"], wrap: ["none", "word", "grapheme"], overflow: ["visible", "clip", "ellipsis", "shrink"], "metric-edge": ["line-box", "cap-height", "ink"], "point-anchor-inline": ["start", "center", "end"], "point-anchor-block": ["start", "center", "end"], "path-side": ["left", "right"], "path-orientation": ["follow", "upright"], "path-align": ["start", "center", "end"], "path-overflow": ["visible", "clip"] };
  const areaKeys = ["inline-size", "block-size", "padding", "align", "block-align", "wrap", "overflow", "max-lines", "minimum-scale", "clip", "columns", "column-gap", "metric-edge"];
  const groups = recipeFields(input, owner, "recipe", Object.entries(values).map(([key, value]) => ({ key, value, domain: key === "stack-order" || areaKeys.includes(key) || key.startsWith("point-") || key.startsWith("path-") ? "Where" : "How", section: key === "stack-order" ? "Stacking" : areaKeys.includes(key) ? "Area" : key.startsWith("point-") ? "Point" : key.startsWith("path-") ? "Path" : key === "fill" ? "Paint" : "Typography", ...(options[key] ? { options: options[key] } : {}) })));
  groups.push({ key: `${owner.authorKey}/Font`, ownerKey: owner.authorKey, domain: "How", pageKey: "Typography", sectionKey: "Font", fields: [field(input, owner.authorKey, "font", { label: "font", widget: "text", schemaKey: "typo/font", authorValue: f.fonts.faces.map(face => `${face.family} ${face.weight} ${face.style}`).join(", ") })] });
  const author = input.authoring.elements.get(owner.authorKey);
  if (author) for (const child of input.authoring.elements.values()) {
    if (child.authorKey === author.authorKey || child.sourceUnit !== author.sourceUnit || child.elementSpan.start < author.elementSpan.start || child.elementSpan.end > author.elementSpan.end) continue;
    const tag = child.surface.split(":").at(-1)!;
    if (!["Fill", "Stroke", "Shadow", "Glow", "Box", "Decoration", "Feature", "Stop", "Linear", "Radial"].includes(tag)) continue;
    const fields = child.attributes.filter(attribute => attribute.name !== "id").map(attribute => {
      const value = attribute.attribute.value;
      const text = value.kind === "literal" ? value.text : "";
      const boolean = ["enabled", "skip-ink"].includes(attribute.name);
      const numeric = ["width", "x", "y", "blur", "spread", "radius", "border-width", "thickness", "offset", "angle", "opacity"].includes(attribute.name);
      return field(input, child.authorKey, attribute.name, { label: attribute.name, widget: attribute.name.includes("color") ? "color" : boolean ? "boolean" : numeric ? "number" : "text", schemaKey: `typo/${tag}/${attribute.name}`, authorValue: boolean ? text === "true" : numeric ? Number(text) : text });
    });
    groups.push({ key: `${child.authorKey}/Paint`, ownerKey: child.authorKey, domain: "How", pageKey: "Paint", sectionKey: tag, fields });
  }
  return groups;
}
export const typoStyleStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/typo@1/style", moduleId: "dsivio-video/typo@1", matches: [{ surface: "Style", output: "", type: trackTypes.typographyStyle }], family: "typography-style", icon: "text", tone: "purple",
  project(input) { return { entities: [], lanes: [], bands: [], materials: [], parameterOwners: [], fieldGroups: typographyFields(input, { key: input.authorKey, authorKey: input.authorKey, moduleId: input.moduleId, surface: "Style", output: "", value: input.value, bindings: [] }) }; },
};
export const typoStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/typo@1/track", moduleId: "dsivio-video/typo@1", matches: [{ surface: "Track", output: "track", type: renderTypes.visual }], family: "typography", icon: "text", tone: "purple", supports: [{ output: "program", type: trackTypes.typographyProgram }],
  project(input) {
    const value = input.supports.program; if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "Typography requires its program output");
    const program = value.data as unknown as TypographyProgram; const visual = input.value.data as unknown as VisualTrack;
    const laneKey = `${input.authorKey}/typography`; const fieldGroups: FieldGroup[] = []; const parameterOwners: ParameterOwner[] = [];
    const ownerGroups = new Map<string, FieldGroup[]>();
    const entities = program.items.map((item, index) => {
      const owner = parameterOwner(input, "styles", index);
      if (owner && !ownerGroups.has(owner.key)) { parameterOwners.push(owner); const groups = typographyFields(input, owner); ownerGroups.set(owner.key, groups); fieldGroups.push(...groups); }
      const text = item.content.paragraphs.map(paragraph => paragraph.runs.map(run => run.kind === "break" ? "\n" : run.text).join("")).join("\n");
      const parts = visual.presents.filter(present => present.presentKey === item.itemKey);
      const owners = owner ? (ownerGroups.get(owner.key) ?? []).map(group => group.ownerKey) : [];
      return { ...baseEntity(input, item.itemKey, text, [item.window.frames], laneKey, index), text, pictureParts: parts.flatMap(present => present.nodes.map(node => node.nodeKey)), parameterOwners: owner ? [...new Set([owner.key, ...owners])] : [], facts: { placement: item.placement.kind, text } };
    });
    return { entities, lanes: [{ key: laneKey, title: "Typography", height: 48, order: 0 }], bands: [], materials: [], fieldGroups, parameterOwners };
  },
};
