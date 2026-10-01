import type { CompanionInput, CompanionProjection, FieldGroup, StudioCompanion, StudioEntity, StudioMaterial } from "../../studio/companion.ts";
import type { ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import type { StickerStyle } from "../../components/comment-sticker/types.ts";
import { DvError } from "../../core/errors.ts";
import { stickerTypes } from "../../components/comment-sticker/types.ts";
import { stickerRules, validateStickerProgram, validateStickerStyle } from "../../components/comment-sticker/validate.ts";
import { decodeStickerTrack, decodeStickerStyle } from "../../components/comment-sticker/author.ts";
import { lowerStickers } from "../../components/comment-sticker/lower.ts";
import { renderTypes } from "../../render/ir.ts";
import { authorFor, emptyProjection, field, parameterOwner, referenceOwner, sourceFor, temporalAuthorities } from "../../studio/projection.ts";
const moduleId = "dsivio-video/comment-sticker@1";
export function authorTrack(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const itemIdentities = new Map<string, string>();
  decodeStickerTrack(node, { ...ctx, operation(spec) {
    const outputs = ctx.operation(spec);
    const child = node.kind === "element" ? node.children.find(child => child.kind === "element" && child.span.start === spec.span.start) : undefined;
    const element = child?.kind === "element" ? child : node;
    const identity = !Array.isArray(spec.inputs.key) && spec.inputs.key?.kind === "record" && typeof spec.inputs.key.value.data === "string" ? spec.inputs.key.value.data : undefined;
    for (const binding of Object.values(outputs)) {
      ctx.authoring({ binding, element, role: "output", ...(identity ? { identity } : {}) });
      if (spec.producer.endsWith("#item") && identity) itemIdentities.set(binding.key, identity);
    }
    const operation = Object.values(outputs).find(binding => binding.kind === "output");
    if (operation?.kind === "output") for (const [port, bindings] of Object.entries(spec.inputs)) {
      (Array.isArray(bindings) ? bindings : [bindings]).forEach((binding, index) => {
        const children = node.kind === "element" ? node.children.filter(child => child.kind === "element") : [];
        const inputElement = Array.isArray(bindings) ? children[index] ?? element : element;
        const items = spec.inputs.items;
        const consumerIdentity = port === "windows" && Array.isArray(items) ? itemIdentities.get(items[index]!.key) : undefined;
        ctx.authoring({ binding, element: inputElement, role: port === "windows" ? "window" : "input", ...(consumerIdentity ? { identity: consumerIdentity } : {}), attribute: port === "comment" && !element.attributes.some(a => a.name === "comment") ? "$body" : port, consumer: { operation: operation.operation, port, ...(Array.isArray(bindings) ? { index } : {}) } });
      });
    }
    return outputs;
  } });
}
export const authorStyle = decodeStickerStyle;
const layout: Record<string, true> = Object.fromEntries(["stack-order", "radius", "padding-x", "padding-y", "gap", "tail", "tail-width", "tail-height", "tail-offset-x", "avatar-size", "header-size", "header-line-height", "body-size", "body-line-height", "body-max-lines", "meta-size", "meta-line-height"].map(name => [name, true]));
export function stickerFields(input: CompanionInput, styleAuthorKey: string, style: StickerStyle): FieldGroup[] {
  const recipe = referenceOwner(input, styleAuthorKey, "recipe");
  const ownerKey = recipe?.authorKey ?? styleAuthorKey;
  const groups = new Map<string, FieldGroup>();
  for (const [name, rule] of Object.entries(stickerRules)) {
    const motion = /^(enter|exit|hold)(-|$)/.test(name);
    const domain = motion ? "When" : layout[name] ? "Where" : "How";
    const section = motion ? "Motion" : layout[name] ? "Layout" : "Appearance";
    const key = `${ownerKey}/${section}`;
    const previous = groups.get(key);
    const widget = rule.choices ? "select" : typeof rule.value === "boolean" ? "boolean" : rule.color ? "color" : typeof rule.value === "number" ? "number" : typeof rule.value === "object" ? "record" : "text";
    const next = field(input, ownerKey, name, { label: name, widget, schemaKey: `${stickerTypes.style}/${name}`, authorValue: style.properties[name]!, schema: { type: typeof rule.value === "number" ? "number" : typeof rule.value === "boolean" ? "boolean" : typeof rule.value === "object" ? "object" : "string", ...(rule.min !== undefined ? { minimum: rule.min } : {}), ...(rule.max !== undefined ? { maximum: rule.max } : {}), ...(rule.choices ? { enum: rule.choices } : {}) }, ...(rule.choices ? { options: rule.choices.map(value => ({ value, label: value })) } : {}) });
    if (!recipe) { delete next.endpointKey; next.readonly = true; if (next.binding) { next.binding.access = "read"; delete next.binding.endpointKey; } }
    groups.set(key, { key, ownerKey, domain, pageKey: section, sectionKey: section, fields: [...(previous?.fields ?? []), next] });
  }
  return [...groups.values()];
}
function project(input: CompanionInput): CompanionProjection {
  if (input.value.type === stickerTypes.style) { validateStickerStyle(input.value.data); return { ...emptyProjection(), fieldGroups: stickerFields(input, input.authorKey, input.value.data) }; }
  const value = input.value.type === stickerTypes.program ? input.value : input.supports.program;
  if (!value) throw new DvError("STUDIO_SUPPORT_MISSING", "Comment sticker Track requires its public program support output.");
  validateStickerProgram(value.data);
  const lowered = lowerStickers(value.data);
  const laneKey = `${input.authorKey}/stickers`;
  const materials: StudioMaterial[] = [];
  const fields: FieldGroup[] = [];
  const entities: StudioEntity[] = [];
  const owners = value.data.stickers.map((_, index) => parameterOwner(input, "styles", index)).filter(owner => owner !== undefined);
  const seen = new Set<string>();
  value.data.stickers.forEach((item, index) => {
    const author = authorFor(input, item.itemKey);
    const authorKey = author?.authorKey ?? input.authorKey;
    const editorKey = author ? authorKey : `${authorKey}/sticker/${index}`;
    const owner = parameterOwner(input, "styles", index);
    const styleOwner = owner?.authorKey ?? authorKey;
    if (!seen.has(styleOwner)) { fields.push(...stickerFields(input, styleOwner, item.style)); seen.add(styleOwner); }
    const parameterKeys = owner ? [owner.key] : [];
    for (const attribute of ["recipe", "font"]) {
      const reference = input.authoring.references.find(reference => reference.authorKey === styleOwner && reference.attribute === attribute);
      const value = reference && (input.values?.get(reference.bindingKey) ?? input.authorGraph.records.get(reference.bindingKey)?.value);
      const source = reference && authorFor(input, reference.bindingKey);
      if (value && source) {
        if (!owners.some(owner => owner.key === source.authorKey)) owners.push({ key: source.authorKey, authorKey: source.authorKey, moduleId: value.type.slice(0, value.type.lastIndexOf("#")), surface: source.surface, output: "", value, bindings: [] });
        parameterKeys.push(source.authorKey);
      }
    }
    const copy: Record<string, Json> = { comment: item.comment, author: item.author ?? "", header: item.header ?? "", meta: item.meta ?? "" };
    fields.push({ key: `${editorKey}/copy`, ownerKey: authorKey, domain: "How", pageKey: "Copy", sectionKey: "Copy", fields: ["comment", "author", "header", "meta"].map(name => {
      const referenced = author && referenceOwner(input, authorKey, name);
      const attribute = referenced ? "$body" : name === "comment" && !author?.attributes.some(attribute => attribute.name === "comment") ? "$body" : name;
      const control = field(input, referenced?.authorKey ?? authorKey, attribute, { fieldKey: `${editorKey}/copy/${name}`, label: name, widget: "text", schemaKey: `${stickerTypes.item}/${name}`, authorValue: copy[name]! });
      if (!author) { delete control.endpointKey; control.readonly = true; if (control.binding) { control.binding.access = "read"; delete control.binding.endpointKey; } }
      return control;
    }) });
    const frameOwner = parameterOwner(input, "frames", index);
    if (frameOwner) { parameterKeys.push(frameOwner.key); if (!owners.some(owner => owner.key === frameOwner.key)) owners.push(frameOwner); }
    const frameAuthor = frameOwner && authorFor(input, frameOwner.authorKey);
    const geometry = frameAuthor?.attributes.filter(attribute => ["left", "top", "right", "bottom", "x", "y", "width", "height", "aspect", "anchor", "offset-x", "offset-y", "fit", "frame-x", "frame-y", "content-x", "content-y", "constraint"].includes(attribute.name)) ?? [];
    fields.push({ key: `${editorKey}/frame`, ownerKey: frameOwner?.authorKey ?? authorKey, domain: "Where", pageKey: "Frame", sectionKey: "Frame", fields: geometry.map(attribute => {
      const value = attribute.attribute.value;
      return field(input, frameOwner!.authorKey, attribute.name, { label: attribute.name, widget: ["anchor", "aspect"].includes(attribute.name) ? "text" : "number", schemaKey: `dsivio-video/space@1#${frameAuthor!.surface.split(":").at(-1)}/${attribute.name}`, authorValue: value.kind === "literal" ? value.text : value.name, units: ["px", "%"] });
    }) });
    const parts = lowered.presents[index]!.nodes.map(node => node.nodeKey);
    const materialKey = `${editorKey}/avatar`;
    if (item.avatar) materials.push({ key: materialKey, kind: "image", resource: item.avatar, facts: { role: "decoration" } });
    entities.push({ editorKey, authorKey, title: item.author ?? "Comment sticker", text: item.comment, paintRank: Number(item.style.properties["stack-order"]), intervals: [item.window.frames], laneKey, pictureParts: parts.filter(part => !part.endsWith("/avatar") && !part.includes("/avatar/")), parameterOwners: parameterKeys, temporal: temporalAuthorities(input, item.itemKey, "windows"), sourceSlice: sourceFor(input, item.itemKey), facts: { kind: "author-content", frame: item.frame as unknown as Json, header: item.header ?? null, meta: item.meta ?? null } });
    if (item.avatar || item.style.properties["avatar-fallback"] === "initial" && item.author) entities.push({ editorKey: `${editorKey}/avatar`, authorKey, title: "Avatar decoration", paintRank: Number(item.style.properties["stack-order"]), intervals: [item.window.frames], laneKey, pictureParts: parts.filter(part => part.endsWith("/avatar") || part.includes("/avatar/")), materials: item.avatar ? [materialKey] : [], parameterOwners: parameterKeys, temporal: [], selectionGroup: editorKey, sourceSlice: sourceFor(input, item.itemKey), facts: { role: "decoration", fallback: item.style.properties["avatar-fallback"]! } });
  });
  return { ...emptyProjection(), entities, lanes: [{ key: laneKey, title: "Comment stickers", height: 52, order: 0 }], materials, fieldGroups: fields, parameterOwners: owners };
}
export const commentStickerCompanions: readonly StudioCompanion[] = [{ protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/track`, moduleId, family: "comment-sticker", icon: "text", tone: "orange", matches: [{ surface: "Track", output: "track", type: renderTypes.visual }], supports: [{ output: "program", type: stickerTypes.program }], project }, { protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/style`, moduleId, family: "comment-sticker", icon: "text", tone: "orange", matches: [{ surface: "Style", output: "", type: stickerTypes.style }], project }];
