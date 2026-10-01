import type { Binding, ElaborationContext } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { spaceTypes } from "../../space/types.ts";
import { fontTypes } from "../../fonts/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { RECIPE, validateRecipe } from "../../modules/recipe/index.ts";
import { empty, literal, reference, structured } from "../sound/author.ts";
import { deckTypes } from "./types.ts";
import type { DeckPlan } from "./types.ts";
import { decodeInstantAttributes, publishInstant, INSTANT_ATTRIBUTES } from "../../modules/time/index.ts";
export { INSTANT_ATTRIBUTES } from "../../modules/time/index.ts";

function recipe(attrs: Record<string, Attribute>, name: string, element: ElementNode, ctx: ElaborationContext): Record<string, Json> {
  const binding = reference(attrs, name, [RECIPE], element, ctx);
  if (binding.kind !== "record") return ctx.fail("DECK_RECIPE", "Appearance must be an inline author Recipe.", element.span);
  validateRecipe(binding.value.data); return binding.value.data.properties;
}
export function decodeDeck(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "timeline", "canvas", "frame", "appearance", "until", "until-boundary"]);
  const id = literal(attrs, "id", element, ctx), trackKey = entityIdentity(ctx.file, id);
  const timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx);
  const canvas = reference(attrs, "canvas", [spaceTypes.canvas], element, ctx), frame = reference(attrs, "frame", [spaceTypes.frame], element, ctx);
  const plan: DeckPlan = { trackKey, appearance: recipe(attrs, "appearance", element, ctx), cards: [] };
  if (!attrs.until) return ctx.fail("DECK_TIME", "DepthStack requires until.", element.span);
  const terminalAttributes: Attribute[] = [{ ...attrs.until, name: "at" }];
  if (attrs["until-boundary"]) terminalAttributes.push({ ...attrs["until-boundary"], name: "boundary" });
  else if (attrs.until.value.kind === "ref") {
    const source = ctx.lookup(attrs.until.value.name, attrs.until.span);
    if (source.type === timelineTypes.selection || source.type === timelineTypes.segment) terminalAttributes.push({ name: "boundary", value: { kind: "literal", text: "end", span: attrs.until.span }, span: attrs.until.span });
  }
  const terminal = publishInstant(timeline, decodeInstantAttributes({ ...element, attributes: terminalAttributes }, ctx), trackKey, ctx, element.span);
  const sources: Binding[] = [], instants: Binding[] = [], labels: Binding[] = [], ids = new Set<string>();
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue;
    if (child.kind !== "element" || child.tag !== `${prefix}Card`) return ctx.fail("DECK_CHILD", "DepthStack accepts only empty Card children.", child.span);
    const { attrs: a } = structured(child, ctx, ["id", "source", "extent", "appearance", "label", ...INSTANT_ATTRIBUTES]); empty(child, ctx);
    const cardId = literal(a, "id", child, ctx);
    if (ids.has(cardId)) return ctx.fail("DECK_DUPLICATE", `Duplicate Card '${cardId}'.`, child.span);
    ids.add(cardId); const cardKey = entityIdentity(ctx.file, `${id}/${cardId}`);
    const source = reference(a, "source", ["dsivio-video/media@1#Image", timelineTypes.media, renderTypes.surface], child, ctx);
    const image = source.type === "dsivio-video/media@1#Image";
    if (!!a.extent !== image) return ctx.fail("DECK_EXTENT", "Images require extent; media and surfaces prohibit it.", child.span);
    const inputs: Record<string, Binding> = { [image ? "image" : source.type === timelineTypes.media ? "media" : "surface"]: source };
    if (image) inputs.extent = reference(a, "extent", [spaceTypes.extent], child, ctx);
    sources.push(ctx.operation({ producer: "dsivio-video/deck-track@1#source", inputs, publish: {}, label: cardId, span: child.span }).source!);
    instants.push(publishInstant(timeline, decodeInstantAttributes(child, ctx), cardKey, ctx, child.span));
    const card: DeckPlan["cards"][number] = { cardKey };
    if (a.appearance) card.appearance = recipe(a, "appearance", child, ctx);
    if (a.label) { card.labelIndex = labels.length; labels.push(reference(a, "label", [deckTypes.label], child, ctx)); }
    plan.cards.push(card);
  }
  if (!plan.cards.length) return ctx.fail("DECK_CHILD", "DepthStack needs at least one Card.", element.span);
  const parameter = ctx.record(null, { type: deckTypes.plan, data: plan as unknown as Json }, element.span);
  const outputs = ctx.operation({ producer: "dsivio-video/deck-track@1#program", inputs: { timeline, canvas, frame, plan: parameter, terminal, sources, instants, labels }, publish: { program: `${id}.program` }, label: id, span: element.span });
  ctx.operation({ producer: "dsivio-video/deck-track@1#lower", inputs: { program: outputs.program! }, publish: { track: `${id}.track` }, label: id, span: element.span });
}
export function decodeLabel(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "font", "content", "size", "color", "align", "block", "padding"]);
  const id = literal(attrs, "id", element, ctx), font = reference(attrs, "font", [fontTypes.stack], element, ctx);
  let text = "";
  for (const child of element.children) { if (child.kind !== "text") return ctx.fail("DECK_LABEL", "Label accepts pure text only.", child.span); text += child.text; }
  if (attrs.content && text.trim()) return ctx.fail("DECK_LABEL", "content and Label body are mutually exclusive.", element.span);
  if (!attrs.content && !text.trim()) return ctx.fail("DECK_LABEL", "Label needs nonempty text.", element.span);
  const content = attrs.content ? reference(attrs, "content", ["dsivio-video/text@1#Text"], element, ctx) : ctx.record(null, { type: "dsivio-video/text@1#Text", data: text.trim() }, element.span);
  const properties: Record<string, Json> = { "stack-order": 0, size: 34, fill: "#FFFFFF", align: "center", "block-align": "end", padding: 20 };
  for (const [attribute, property] of [["size", "size"], ["color", "fill"], ["align", "align"], ["block", "block-align"], ["padding", "padding"]]) {
    if (attrs[attribute!]) properties[property!] = ["size", "padding"].includes(attribute!) ? Number(literal(attrs, attribute!, element, ctx)) : literal(attrs, attribute!, element, ctx);
  }
  const recipeBinding = ctx.record(null, { type: RECIPE, data: { rule: "deck.label", properties } }, element.span);
  const key = ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, element.span);
  ctx.operation({ producer: "dsivio-video/deck-track@1#label", inputs: { font, content, appearance: recipeBinding, key }, publish: { label: id }, label: id, span: element.span });
}
