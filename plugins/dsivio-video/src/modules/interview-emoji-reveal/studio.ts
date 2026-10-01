import type { CompanionInput, CompanionProjection, FieldGroup, StudioCompanion, StudioEntity, StudioMaterial } from "../../studio/companion.ts";
import type { ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import { projectInstant } from "../../timeline/temporal.ts";
import { DvError } from "../../core/errors.ts";
import { emojiTypes } from "../../components/interview-emoji-reveal/types.ts";
import type { EmojiStyle } from "../../components/interview-emoji-reveal/types.ts";
import { emojiRules, validateEmojiProgram, validateEmojiStyle, validateEmojiPlan } from "../../components/interview-emoji-reveal/validate.ts";
import { decodeEmojiTrack, decodeEmojiStyle } from "../../components/interview-emoji-reveal/author.ts";
import { lowerEmojiReveal } from "../../components/interview-emoji-reveal/lower.ts";
import { renderTypes } from "../../render/ir.ts";
import { authorFor, emptyProjection, field, parameterOwner, referenceOwner, sourceFor, temporalAuthorities, temporalAuthority } from "../../studio/projection.ts";
const moduleId = "dsivio-video/interview-emoji-reveal@1";
export const authorStyle = decodeEmojiStyle;
export function authorTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  decodeEmojiTrack(node, { ...ctx, operation(spec) {
    const outputs = ctx.operation(spec);
    const output = outputs.program;
    if (output?.kind !== "output" || node.kind !== "element") return outputs;
    const plan = spec.inputs.plan;
    if (!plan || Array.isArray(plan) || plan.kind !== "record") return outputs;
    validateEmojiPlan(plan.value.data);
    const children = node.children.filter(child => child.kind === "element");
    plan.value.data.items.forEach((item, index) => {
      ctx.authoring({ binding: plan, element: children[index]!, role: item.at ? "instant" : "plan", identity: item.itemKey, attribute: item.at ? "at" : "preset", consumer: { operation: output.operation, port: "plan", index } });
      const icons = spec.inputs.icons;
      if (Array.isArray(icons)) ctx.authoring({ binding: icons[index]!, element: children[index]!, role: "input", attribute: "icon", consumer: { operation: output.operation, port: "icons", index } });
    });
    const outer = spec.inputs.outer;
    if (outer && !Array.isArray(outer)) ctx.authoring({ binding: outer, element: node, role: "window", identity: plan.value.data.trackKey, consumer: { operation: output.operation, port: "outer" } });
    return outputs;
  } });
}
const geometry: Record<string, true> = { "center-x": true, "top-y": true, "slot-size": true, "slot-gap": true, "padding-x": true, "padding-y": true, "icon-size": true, "stack-order": true, radius: true };
function styleFields(input: CompanionInput, styleAuthorKey: string, style: EmojiStyle): FieldGroup[] {
  const ownerKey = referenceOwner(input, styleAuthorKey, "recipe")?.authorKey;
  const groups = new Map<string, FieldGroup>();
  for (const [name, rule] of Object.entries(emojiRules)) {
    const domain = name === "reveal-frames" ? "When" : geometry[name] ? "Where" : "How";
    const section = name === "reveal-frames" ? "Motion" : name === "stack-order" ? "Stacking" : ["center-x", "top-y"].includes(name) ? "Frame" : geometry[name] ? "Layout" : "Appearance";
    const key = `${styleAuthorKey}/${section}`;
    const control = field(input, ownerKey ?? styleAuthorKey, name, { label: name, widget: rule.color ? "color" : "number", schemaKey: `${emojiTypes.style}/${name}`, authorValue: style.properties[name]!, schema: { type: typeof rule.value === "number" ? "number" : "string", ...(rule.min !== undefined ? { minimum: rule.min } : {}), ...(rule.max !== undefined ? { maximum: rule.max } : {}) }, ...(["center-x", "top-y"].includes(name) ? { displayScale: 100 } : {}) });
    if (!ownerKey) { delete control.endpointKey; control.readonly = true; if (control.binding) { control.binding.access = "read"; delete control.binding.endpointKey; } }
    const existing = groups.get(key);
    groups.set(key, { key, ownerKey: ownerKey ?? styleAuthorKey, domain, pageKey: section, sectionKey: section, fields: [...(existing?.fields ?? []), control] });
  }
  return [...groups.values()];
}
function project(input: CompanionInput): CompanionProjection {
  if (input.value.type === emojiTypes.style) { validateEmojiStyle(input.value.data); return { ...emptyProjection(), fieldGroups: styleFields(input, input.authorKey, input.value.data) }; }
  const value = input.value.type === emojiTypes.program ? input.value : input.supports.program;
  if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "Interview emoji Track requires its public program support output.");
  validateEmojiProgram(value.data);
  const program = value.data;
  const track = lowerEmojiReveal(program);
  const laneKey = `${input.authorKey}/component`, triggerLaneKey = `${input.authorKey}/events`;
  const style = parameterOwner(input, "style");
  const ownerKey = style?.authorKey ?? input.authorKey;
  const fields = styleFields(input, ownerKey, program.style);
  const owners = style ? [style] : [];
  const reference = input.authoring.references.find(reference => reference.authorKey === ownerKey && reference.attribute === "recipe");
  const recipe = reference && (input.values?.get(reference.bindingKey) ?? input.authorGraph.records.get(reference.bindingKey)?.value);
  const recipeAuthor = reference && authorFor(input, reference.bindingKey);
  if (recipe && recipeAuthor) owners.push({ key: recipeAuthor.authorKey, authorKey: recipeAuthor.authorKey, moduleId: recipe.type.slice(0, recipe.type.lastIndexOf("#")), surface: recipeAuthor.surface, output: "", value: recipe, bindings: [] });
  const planValue = parameterOwner(input, "plan")?.value ?? input.inputs.plan?.[0];
  if (planValue) validateEmojiPlan(planValue.data);
  const materials: StudioMaterial[] = [{ key: `${input.authorKey}/placeholder`, kind: "image", resource: program.placeholder, facts: { role: "decoration" } }];
  const entities: StudioEntity[] = [{ editorKey: input.authorKey, authorKey: input.authorKey, title: "Interview answer strip", paintRank: Number(program.style.properties["stack-order"]), intervals: [program.outer.frames], laneKey, pictureParts: [program.trackKey, `${program.trackKey}/board`], parameterOwners: style ? [style.key] : [], temporal: temporalAuthorities(input, program.trackKey, "outer"), sourceSlice: sourceFor(input), facts: { canvas: program.canvas as unknown as Json } }];
  program.items.forEach((item, index) => {
    const authorKey = authorFor(input, item.itemKey)?.authorKey ?? input.authorKey;
    const editorKey = `${authorKey}/item/${index}`;
    const start = item.activationFrame ?? program.outer.frames.start;
    const end = program.outer.frames.end;
    const materialKey = `${editorKey}/icon`;
    materials.push({ key: materialKey, kind: "image", resource: item.icon });
    const nodes = track.presents[0]!.nodes;
    const answer = nodes.find(node => node.nodeKey === `${item.itemKey}/answer`)!;
    const placeholder = nodes.find(node => node.nodeKey === `${item.itemKey}/placeholder`)!;
    entities.push({ editorKey, authorKey, title: `Answer ${index + 1}`, paintRank: index, intervals: [{ start, end }], visibleIntervals: [{ start, end }], laneKey, pictureParts: [item.itemKey, answer.nodeKey, `${item.itemKey}/reveal`], materials: [materialKey], parameterOwners: style ? [style.key] : [], temporal: [], sourceSlice: sourceFor(input, item.itemKey), facts: { preset: item.activationFrame === undefined, activationFrame: item.activationFrame ?? null } });
    entities.push({ editorKey: `${editorKey}/placeholder`, authorKey, title: "Placeholder decoration", paintRank: index, intervals: item.activationFrame === undefined || item.activationFrame === program.outer.frames.start ? [] : [{ start: program.outer.frames.start, end: start }], visibleIntervals: item.activationFrame === undefined || item.activationFrame === program.outer.frames.start ? [] : [{ start: program.outer.frames.start, end: start }], laneKey, pictureParts: [placeholder.nodeKey], materials: [`${input.authorKey}/placeholder`], parameterOwners: style ? [style.key] : [], temporal: [], selectionGroup: editorKey, sourceSlice: sourceFor(input, item.itemKey), facts: { role: "decoration", lifetime: program.outer.frames } });
    if (item.activationFrame !== undefined) {
      const plan = planValue?.data;
      const declaration = plan && typeof plan === "object" && !Array.isArray(plan) && Array.isArray(plan.items) ? plan.items[index] : undefined;
      let authority;
      if (declaration) {
        validateEmojiPlan(plan);
        const at = plan.items[index]?.at;
        if (at) authority = temporalAuthority(input, projectInstant(program.timeline, at, item.itemKey), "plan");
      }
      entities.push({ editorKey: `${editorKey}/trigger`, authorKey, title: `Reveal ${index + 1}`, paintRank: index, intervals: [{ start, end: start + 1 }], laneKey: triggerLaneKey, pictureParts: [], parameterOwners: [], temporal: authority ? [authority] : [], selectionGroup: editorKey, sourceSlice: sourceFor(input, item.itemKey), facts: { triggerFrame: start, kind: "instant" } });
    }
    const author = input.authoring.elements.get(authorKey);
    const at = author?.attributes.find(a => a.name === "at")?.attribute.value;
    fields.push({ key: `${editorKey}/content`, ownerKey: authorKey, domain: "How", pageKey: "Content", sectionKey: "Item", fields: [field(input, authorKey, "preset", { label: "Preset", widget: "boolean", schemaKey: `${emojiTypes.plan}/preset`, authorValue: item.activationFrame === undefined })] });
    if (at) fields.push({ key: `${editorKey}/event`, ownerKey: authorKey, domain: "When", pageKey: "Events", sectionKey: "Reveal", fields: [field(input, authorKey, "at", { label: "At", widget: "text", schemaKey: `${emojiTypes.plan}/at`, authorValue: at.kind === "literal" ? at.text : at.name })] });
  });
  if (style && recipeAuthor) for (const entity of entities) if (entity.parameterOwners.includes(style.key)) entity.parameterOwners = [...entity.parameterOwners, recipeAuthor.authorKey];
  return { ...emptyProjection(), entities, lanes: [{ key: laneKey, title: "Interview answers", height: 52, order: 0 }, { key: triggerLaneKey, title: "Reveals", height: 40, order: 1, parentLaneKey: laneKey }], materials, fieldGroups: fields, parameterOwners: owners };
}
export const interviewEmojiCompanions: readonly StudioCompanion[] = [{ protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/track`, moduleId, family: "interview-emoji-reveal", icon: "image", tone: "orange", matches: [{ surface: "Track", output: "track", type: renderTypes.visual }], supports: [{ output: "program", type: emojiTypes.program }], project }, { protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/style`, moduleId, family: "interview-emoji-reveal", icon: "image", tone: "orange", matches: [{ surface: "Style", output: "", type: emojiTypes.style }], project }];
