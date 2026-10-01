import { DvError } from "../../core/errors.ts";
import type { ModuleDef, ElaborationContext } from "../../core/module.ts";
import type { Json, ResourceRef, Value } from "../../core/value.ts";
import type { FontStack } from "../../fonts/types.ts";
import { fontTypes } from "../../fonts/types.ts";
import type { Canvas, Extent, Frame } from "../../space/types.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Instant, SynchronizedMedia, Timeline } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { Surface } from "../../render/ir.ts";
import { renderTypes } from "../../render/ir.ts";
import { deckTypes } from "../../components/deck-track/types.ts";
import type { DeckLabel, DeckPlan } from "../../components/deck-track/types.ts";
import type { MediaSource } from "../../components/media-track/types.ts";
import { validateSource } from "../../components/media-track/source.ts";
import { decodeDeck as elaborateDeck, decodeLabel as elaborateLabel, INSTANT_ATTRIBUTES } from "../../components/deck-track/author.ts";
import { assembleDeck } from "../../components/deck-track/program.ts";
import { lowerDeck } from "../../components/deck-track/lower.ts";
import { validateDeckLabel, validateDeckPlan, validateDeckProgram, validateDeckSource } from "../../components/deck-track/validate.ts";
import { typographyStyle } from "../../components/typo/author.ts";
import { RECIPE, validateRecipe } from "../recipe/index.ts";
import { deckLabelStudio, deckTrackStudio } from "./studio.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
function decodeDeck(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  elaborateDeck(node, { ...ctx, operation(spec) {
    const outputs = ctx.operation(spec), plan = spec.inputs.plan;
    if (outputs.program && plan && !Array.isArray(plan) && plan.kind === "record" && node.kind === "element") {
      const cards = (plan.value.data as unknown as DeckPlan).cards;
      const children = node.children.filter(child => child.kind === "element");
      const sources = spec.inputs.sources, instants = spec.inputs.instants;
      const operation = outputs.program.kind === "output" ? outputs.program.operation : outputs.program.key;
      for (const [index, card] of cards.entries()) {
        const child = children[index]; if (!child || child.kind !== "element") continue;
        const source = Array.isArray(sources) ? sources[index] : undefined;
        const instant = Array.isArray(instants) ? instants[index] : undefined;
        if (source) ctx.authoring({ binding: source, element: child, role: "output", identity: card.cardKey, consumer: { operation, port: "sources", index } });
        if (instant) ctx.authoring({ binding: instant, element: child, role: "instant", identity: card.cardKey, consumer: { operation, port: "instants", index } });
      }
    }
    return outputs;
  } });
}
function decodeLabel(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  elaborateLabel(node, { ...ctx, operation(spec) {
    const outputs = ctx.operation(spec), key = spec.inputs.key;
    if (outputs.label && key && !Array.isArray(key) && key.kind === "record" && typeof key.value.data === "string") {
      ctx.authoring({ binding: outputs.label, element: node, role: "parameter", identity: key.value.data });
    }
    return outputs;
  } });
}

const deck: ModuleDef = {
  id: "dsivio-video/deck-track@1", summary: "DepthStack card decks with deterministic reflow and source-clock-preserving playback.",
  studio: [deckTrackStudio, deckLabelStudio],
  types: {
    Label: { summary: "Exact-font text placed on and moving with a card.", validate: validateDeckLabel },
    Source: { summary: "Explicit image extent, normalized picture or compositable surface.", validate: validateDeckSource },
    Plan: { summary: "Ordered card identities and static appearance properties.", validate: validateDeckPlan },
    Program: { summary: "Resolved depth deck, sources and activations on one Timeline.", validate: validateDeckProgram },
  },
  surfaces: {
    Label: { mode: "structured", doc: { summary: "Nonempty pure text body, or content reference with empty body; exact font stack, primary face weight/slant, no synthesis.", attributes: ["id", "font", "content", "size", "color", "align", "block", "padding"].map(name => ({ name, required: name === "id" || name === "font", accepts: name === "font" ? fontTypes.stack : name === "content" ? "dsivio-video/text@1#Text" : "text", summary: "size=34,color=#FFFFFF,align=center,block=end,padding=20." })), outputs: [{ name: "", type: deckTypes.label, summary: "Shared DeckLabel." }] }, elaborate: decodeLabel },
    DepthStack: { mode: "structured", doc: { summary: "At least one Card, strictly ordered activation; until terminates all cards. Appearance inherits Media fit/playback/frame/motion keys with stack-order=30 plus depth controls. Tone *-step keys are genuinely adjustable (research/05 §6.7 defect corrected).", attributes: ["id", "timeline", "canvas", "frame", "appearance", "until", "until-boundary"].map(name => ({ name, required: name !== "until-boundary", accepts: name === "timeline" ? timelineTypes.timeline : name === "canvas" ? spaceTypes.canvas : name === "frame" ? spaceTypes.frame : name === "appearance" ? RECIPE : "literal or semantic reference", summary: "until-boundary defaults end for ranges only." })), children: [{ tag: "Card", repeat: true, summary: "Same sources rearranged in a depth stack." }], outputs: [{ name: "program", type: deckTypes.program, summary: "Inspectable deck program." }, { name: "track", type: renderTypes.visual, summary: "Silent terminal visual track." }] }, elaborate: decodeDeck },
    Card: { mode: "structured", doc: { summary: "Empty stack child; image requires extent, other sources prohibit it; appearance inherits and label is optional.", attributes: ["id", "source", "extent", "appearance", "label", ...INSTANT_ATTRIBUTES].map(name => ({ name, required: name === "id" || name === "source", accepts: name === "appearance" ? RECIPE : name === "label" ? deckTypes.label : "typed reference or literal", summary: "Complete I activation attributes, no default activation." })), outputs: [] }, elaborate(node, ctx) { ctx.fail("DECK_CHILD", "Card is valid only inside DepthStack.", node.span); } },
  },
  producers: {
    source: { inputs: { image: { type: "dsivio-video/media@1#Image", optional: true }, extent: { type: spaceTypes.extent, optional: true }, media: { type: timelineTypes.media, optional: true }, surface: { type: renderTypes.surface, optional: true } }, outputs: { source: deckTypes.source }, run(inputs) {
      if ([inputs.image, inputs.media, inputs.surface].filter(Boolean).length !== 1 || !!inputs.image !== !!inputs.extent) throw new DvError("DECK_SOURCE", "Exactly one source required; only images require extent.");
      const source: MediaSource = inputs.image ? { kind: "image", resource: (inputs.image as Value).data as unknown as ResourceRef, extent: (inputs.extent as Value).data as Extent } : inputs.media ? { kind: "media", media: (inputs.media as Value).data as unknown as SynchronizedMedia } : { kind: "surface", surface: (inputs.surface as Value).data as unknown as Surface };
      validateSource(source); return { outputs: { source: { type: deckTypes.source, data: source as unknown as Json } } };
    } },
    label: { inputs: { font: { type: fontTypes.stack }, content: { type: "dsivio-video/text@1#Text" }, appearance: { type: RECIPE }, key: { type: timelineTypes.consumerKey } }, outputs: { label: deckTypes.label }, run(inputs) {
      const recipe = (inputs.appearance as Value).data; validateRecipe(recipe);
      const key = (inputs.key as Value).data, text = (inputs.content as Value).data;
      if (typeof key !== "string" || typeof text !== "string" || !text.trim()) throw new DvError("DECK_LABEL", "Label requires a nonempty identity and text.");
      const style = typographyStyle(key, recipe, (inputs.font as Value).data as unknown as FontStack, { paints: [], axes: [], features: [], decorations: [] });
      const label: DeckLabel = { labelKey: key, flow: { format: style.format, layout: style.layout, paragraphs: [{ paragraphKey: key, runs: [{ kind: "run", runKey: `${key}/text`, text }] }], sequences: [] } };
      validateDeckLabel(label); return { outputs: { label: { type: deckTypes.label, data: label as unknown as Json } } };
    } },
    program: { inputs: { timeline: { type: timelineTypes.timeline }, canvas: { type: spaceTypes.canvas }, frame: { type: spaceTypes.frame }, plan: { type: deckTypes.plan }, terminal: { type: timelineTypes.instant }, sources: { type: deckTypes.source, list: true }, instants: { type: timelineTypes.instant, list: true }, labels: { type: deckTypes.label, list: true } }, outputs: { program: deckTypes.program }, run(inputs) {
      const plan = (inputs.plan as Value).data; validateDeckPlan(plan);
      const program = assembleDeck((inputs.timeline as Value).data as unknown as Timeline, (inputs.canvas as Value).data as Canvas, (inputs.frame as Value).data as Frame, plan, (inputs.sources as Value[]).map(v => v.data as unknown as MediaSource), (inputs.instants as Value[]).map(v => v.data as Instant), (inputs.terminal as Value).data as Instant, (inputs.labels as Value[]).map(v => v.data as unknown as DeckLabel));
      return { outputs: { program: { type: deckTypes.program, data: program as unknown as Json } } };
    } },
    lower: { inputs: { program: { type: deckTypes.program } }, outputs: { track: renderTypes.visual }, run(inputs) {
      const program = (inputs.program as Value).data; validateDeckProgram(program);
      return { outputs: { track: { type: renderTypes.visual, data: lowerDeck(program) as unknown as Json } } };
    } },
  },
};
export default deck;
