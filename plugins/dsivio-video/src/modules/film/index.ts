import type { Binding, ElaborationContext, ModuleDef } from "../../core/module.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json, Value } from "../../core/value.ts";
import type { Canvas } from "../../space/types.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Timeline } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import type { AudioTrack, VisualTrack } from "../../render/ir.ts";
import { renderTypes } from "../../render/ir.ts";
import { composeComposition, filmBackground, validateComposition } from "../../render/composition.ts";
import { RECIPE, validateRecipe } from "../recipe/index.ts";
import { text as identity } from "../../render/validate.ts";
import { filmStudio } from "./studio.ts";

function structured(node: ElementNode | RawElement, ctx: ElaborationContext, allowed: readonly string[]): { element: ElementNode; attrs: Record<string, Attribute> } {
  if (node.kind !== "element") ctx.fail("FILM_CHILD", "Film requires structured markup.", node.span);
  const attrs: Record<string, Attribute> = Object.create(null);
  for (const attr of node.attributes) {
    if (!allowed.includes(attr.name) || Object.hasOwn(attrs, attr.name)) ctx.fail("FILM_ATTRIBUTE", `Unexpected or duplicate attribute '${attr.name}'.`, attr.span);
    attrs[attr.name] = attr;
  }
  return { element: node, attrs };
}
function literal(attrs: Record<string, Attribute>, name: string, element: ElementNode, ctx: ElaborationContext): string {
  const attr = attrs[name];
  if (!attr || attr.value.kind !== "literal" || !attr.value.text.trim()) ctx.fail("FILM_ATTRIBUTE", `'${name}' requires a nonempty literal.`, attr?.span ?? element.span);
  return attr.value.text.trim();
}
function reference(attrs: Record<string, Attribute>, name: string, types: readonly string[], element: ElementNode, ctx: ElaborationContext): Binding {
  const attr = attrs[name];
  if (!attr || attr.value.kind !== "ref") ctx.fail("FILM_REFERENCE", `'${name}' requires a typed reference.`, attr?.span ?? element.span);
  const binding = ctx.lookup(attr.value.name, attr.span);
  if (!types.includes(binding.type)) ctx.fail("FILM_REFERENCE", `'${name}' requires ${types.join(" or ")}.`, attr.span);
  return binding;
}
function empty(element: ElementNode, ctx: ElaborationContext): void {
  if (element.children.some(child => child.kind !== "text" || child.text.trim())) ctx.fail("FILM_CHILD", "Track must be empty.", element.span);
}
const film: ModuleDef = {
  id: "dsivio-video/film@1", summary: "Explicit terminal track assembly, canonical ordering, background and cross-track layer conflict checks; no rendering or implicit audio.",
  studio: [filmStudio],
  types: { Composition: { summary: "One exact program domain and canvas with explicit visual/audio tracks and background.", validate: validateComposition } },
  surfaces: {
    Film: { mode: "structured", doc: { summary: "Assembles explicit tracks from one Timeline. Appearance is exactly background; layers come from Presents, not Film child order.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Composition identity." }, { name: "canvas", required: true, accepts: spaceTypes.canvas, summary: "Canvas geometry." }, { name: "timeline", required: true, accepts: timelineTypes.timeline, summary: "Exact program domain." }, { name: "appearance", required: true, accepts: RECIPE, summary: "Static Recipe with only background: #RRGGBB or #RRGGBBAA." }], children: [{ tag: "Track", repeat: true, summary: "Explicit audio or visual terminal source; at least one." }], outputs: [{ name: "composition", type: renderTypes.composition, summary: "Terminal Composition; not video bytes." }] }, elaborate(node, ctx) {
      const { element, attrs } = structured(node, ctx, ["id", "canvas", "timeline", "appearance"]);
      const id = literal(attrs, "id", element, ctx);
      const canvas = reference(attrs, "canvas", [spaceTypes.canvas], element, ctx);
      const timeline = reference(attrs, "timeline", [timelineTypes.timeline], element, ctx);
      const appearance = reference(attrs, "appearance", [RECIPE], element, ctx);
      if (appearance.kind !== "record") return ctx.fail("FILM_APPEARANCE", "Film appearance must be a static author Recipe.", element.span);
      validateRecipe(appearance.value.data); filmBackground(appearance.value.data.properties);
      const visualTracks = []; const audioTracks = []; const sources = new Set<string>();
      const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
      for (const child of element.children) {
        if (child.kind === "text" && !child.text.trim()) continue;
        if (child.kind !== "element" || child.tag !== `${prefix}Track`) return ctx.fail("FILM_CHILD", "Film accepts only Track children from its own namespace.", child.span);
        const { attrs: childAttrs } = structured(child, ctx, ["source"]); empty(child, ctx);
        const source = reference(childAttrs, "source", [renderTypes.visual, renderTypes.audio], child, ctx);
        ctx.authoring({ binding: source, element: child, role: "input", attribute: "source" });
        if (sources.has(source.key)) ctx.fail("FILM_DUPLICATE_SOURCE", "A Film cannot include the same source twice.", child.span);
        sources.add(source.key);
        if (source.type === renderTypes.visual) visualTracks.push(source); else audioTracks.push(source);
      }
      if (!sources.size) ctx.fail("FILM_TRACKS", "Film requires at least one explicit Track.", element.span);
      const key = ctx.record(null, { type: timelineTypes.consumerKey, data: entityIdentity(ctx.file, id) }, element.span);
      const result = ctx.operation({ producer: "dsivio-video/film@1#compose", inputs: { canvas, timeline, appearance, key, visualTracks, audioTracks }, publish: { composition: `${id}.composition` }, label: id, span: element.span });
      ctx.authoring({ binding: result.composition!, element, role: "output", identity: entityIdentity(ctx.file, id) });
    } },
    Track: { mode: "structured", doc: { summary: "Film-only explicit terminal track source; no implicit sibling audio.", attributes: [{ name: "source", required: true, accepts: `${renderTypes.visual} or ${renderTypes.audio}`, summary: "Unique terminal track source." }], outputs: [] }, elaborate(node, ctx) { ctx.fail("FILM_CHILD", "Track is only valid inside film:Film.", node.span); } },
  },
  producers: { compose: { inputs: { canvas: { type: spaceTypes.canvas }, timeline: { type: timelineTypes.timeline }, appearance: { type: RECIPE }, key: { type: timelineTypes.consumerKey }, visualTracks: { type: renderTypes.visual, list: true }, audioTracks: { type: renderTypes.audio, list: true } }, outputs: { composition: renderTypes.composition }, run(inputs) {
    const appearance = (inputs.appearance as Value).data; validateRecipe(appearance);
    const key = (inputs.key as Value).data; identity(key);
    const composition = composeComposition(key, (inputs.canvas as Value).data as Canvas, (inputs.timeline as Value).data as unknown as Timeline, appearance.properties, (inputs.visualTracks as Value[]).map(value => value.data as VisualTrack), (inputs.audioTracks as Value[]).map(value => value.data as unknown as AudioTrack));
    return { outputs: { composition: { type: renderTypes.composition, data: composition as unknown as Json } } };
  } } },
};
export default film;
