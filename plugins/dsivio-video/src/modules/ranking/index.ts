import type { Binding, ModuleDef, ProducerDef, ProducerInputs, SurfaceDef } from "../../core/module.ts";
import type { Json, ResourceRef } from "../../core/value.ts";
import { DvError } from "../../core/errors.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { isTimeLiteral } from "../../timeline/temporal.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { Timeline, Window, Instant, MomentRef, InstantExpression, SynchronizedMedia } from "../../timeline/types.ts";
import { spaceTypes } from "../../space/types.ts";
import type { Canvas, Frame } from "../../space/types.ts";
import { fontTypes } from "../../fonts/types.ts";
import type { FontFace, FontStack } from "../../fonts/types.ts";
import { renderTypes } from "../../render/ir.ts";
import { attributes, literal, reference, empty, parseNumber } from "../../space/parse.ts";
import { object, exact, key } from "../../space/validate.ts";
import { RECIPE, validateRecipe } from "../recipe/index.ts";
import type { Recipe } from "../recipe/index.ts";
import { imageType } from "../media/index.ts";
import { decodeWindowAttributes, publishWindow, INSTANT_ATTRIBUTES, decodeInstantAttributes, publishInstant } from "../time/index.ts";
import { rankingStyle } from "../../components/ranking/author.ts";
import { assembleRanking, rankingEvents } from "../../components/ranking/program.ts";
import { lowerRanking, lowerRankingAudio } from "../../components/ranking/lower.ts";
import { validateRankingStyle, validateRankingPlan, validateRankingProgram, validateRankingSchedule, validateRankingEvents, validateSoundStyle } from "../../components/ranking/validate.ts";
import { RANKING_MODULE as id, rankingTypes } from "../../components/ranking/types.ts";
import type { RankingKind, RankingStyle, RankingProgram, RankingAuthorPlan, SoundStyle } from "../../components/ranking/types.ts";
import { rankingStudio } from "./studio.ts";
const textType = "dsivio-video/text@1#Text", optionsType = `${id}#StyleOptions`;
const kinds: RankingKind[] = ["TierBoard", "Column", "TopThree"];
const styleTypes: Record<RankingKind, string> = { TierBoard: rankingTypes.tierStyle, Column: rankingTypes.columnStyle, TopThree: rankingTypes.topStyle };
const itemTags: Record<RankingKind, string> = { TierBoard: "TierItem", Column: "ColumnItem", TopThree: "TopThreeItem" };
const surfaces: Record<string, SurfaceDef> = {}, producers: Record<string, ProducerDef> = {};
function value<T>(inputs: ProducerInputs, name: string): T { const v = inputs[name]; if (!v || Array.isArray(v) || !("data" in v)) throw new DvError("RANKING_INPUT", `Missing materialized ${name}`); return v.data as unknown as T; }
function list<T>(inputs: ProducerInputs, name: string): T[] { const v = inputs[name]; if (!Array.isArray(v)) throw new DvError("RANKING_INPUT", `${name} must be a materialized list`); return v.map(item => { if (!("data" in item)) throw new DvError("RANKING_INPUT", `${name} is pending`); return item.data as unknown as T; }); }
for (const kind of kinds) {
  const styleType = styleTypes[kind];
  surfaces[`${kind}Style`] = {
    mode: "structured", doc: { summary: `Exact-font ${kind} recipe and companion sound settings.`, attributes: ["id", "recipe", "font"].map(name => ({ name, required: true, accepts: name === "recipe" ? RECIPE : name === "font" ? "Face|Stack" : "text", summary: name })), outputs: [{ name: "", type: styleType, summary: `${kind} style` }, { name: "sound", type: rankingTypes.sound, summary: "Sound settings" }] },
    elaborate(element, ctx) {
      const a = attributes(element, ["id", "recipe", "font"], ctx); empty(element, ctx);
      const name = literal(a.id, "id", ctx, element), recipe = reference(a.recipe, [RECIPE], ctx, element);
      if (recipe.kind !== "record") return ctx.fail("RANKING_RECIPE", "Recipe must be readable at author time", element.span); validateRecipe(recipe.value.data);
      const font = reference(a.font, [fontTypes.face, fontTypes.stack], ctx, element);
      const options = ctx.record(null, { type: optionsType, data: { kind, styleKey: entityIdentity(ctx.file, name) } }, element.span);
      const outputs = ctx.operation({ producer: `${id}#style-${kind}-${font.type === fontTypes.face ? "face" : "stack"}`, inputs: { recipe, font, options }, publish: { style: name, sound: `${name}.sound` }, label: name, span: element.span });
      ctx.authoring({ binding: outputs.style!, element, role: "parameter", identity: entityIdentity(ctx.file, name) });
      ctx.authoring({ binding: outputs.sound!, element, role: "parameter", identity: entityIdentity(ctx.file, name) });
    },
  };
  for (const [fontName, fontType] of [["face", fontTypes.face], ["stack", fontTypes.stack]]) producers[`style-${kind}-${fontName}`] = {
    inputs: { recipe: { type: RECIPE }, font: { type: fontType! }, options: { type: optionsType } }, outputs: { style: styleType, sound: rankingTypes.sound },
    run(inputs) { const o = value<{ styleKey: string }>(inputs, "options"), style = rankingStyle(kind, o.styleKey, value<Recipe>(inputs, "recipe"), value<FontFace | FontStack>(inputs, "font")); return { outputs: { style: { type: styleType, data: style as unknown as Json }, sound: { type: rankingTypes.sound, data: style.sound } } }; },
  };
  surfaces[kind] = {
    mode: "structured", doc: {
      summary: `${kind} cumulative reveal board.`, attributes: ["id", "timeline", "frame", "during", "style", ...(kind === "TopThree" ? ["terminal"] : ["canvas"]), "appear-sound", ...(kind === "TopThree" ? [] : ["move-sound"])].map(name => ({ name, required: !name.endsWith("-sound"), accepts: name === "during" ? "program|Selection|Segment" : name === "terminal" ? "absolute time|Moment" : "text or typed reference", summary: name })), children: [{ tag: itemTags[kind], repeat: true, summary: "Ordered declaration; placement follows temporal/rank order." }], outputs: [{ name: "schedule", type: rankingTypes.schedule, summary: "Reveal and settled spans" }, { name: "program", type: rankingTypes.program, summary: "Inspectable ranking program" }, { name: "visual", type: renderTypes.visual, summary: "Terminal visual track" }, { name: "events", type: rankingTypes.events, summary: "Present only when sounds are bound" }, { name: "audio", type: renderTypes.audio, summary: "Present only when sounds are bound" }],
    },
    elaborate(element, ctx) {
      const a = attributes(element, ["id", "timeline", "frame", "during", "style", ...(kind === "TopThree" ? ["terminal"] : ["canvas"]), "appear-sound", ...(kind === "TopThree" ? [] : ["move-sound"])], ctx);
      if (element.kind !== "element") return ctx.fail("MARKUP_CHILD", "Ranking containers require structured elements", element.span);
      const name = literal(a.id, "id", ctx, element), trackKey = entityIdentity(ctx.file, name), timeline = reference(a.timeline, [timelineTypes.timeline], ctx, element);
      if (!a.during) return ctx.fail("RANKING_WINDOW", "Ranking containers require during", element.span);
      const outer = publishWindow(timeline, decodeWindowAttributes(element, ctx), trackKey, ctx, element.span);
      ctx.authoring({ binding: outer, element, role: "window", identity: trackKey });
      const style = reference(a.style, [styleType], ctx, element);
      const lists: Record<string, Binding[]> = { windows: [], instants: [], icons: [], texts: [] };
      const append = (name: string, binding: Binding) => { lists[name]!.push(binding); return lists[name]!.length - 1; };
      const plan: RankingAuthorPlan = { kind, trackKey, items: [] };
      const authoredChildren: { element: typeof element; item: RankingAuthorPlan["items"][number] }[] = [];
      const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
      for (const child of element.children) {
        if (child.kind === "text" && !child.text.trim()) continue;
        if (child.kind !== "element" || child.tag !== `${prefix}${itemTags[kind]}`) return ctx.fail("MARKUP_CHILD", `${kind} only accepts ${itemTags[kind]} from its own namespace`, child.span);
        const ca = attributes(child, ["id", "icon", "stack", ...(kind === "TierBoard" ? ["tier", "preset", "during", "entry"] : kind === "Column" ? ["label", "rank", "preset", "during"] : ["label", ...INSTANT_ATTRIBUTES])], ctx); empty(child, ctx);
        const itemName = literal(ca.id, "id", ctx, child, `item-${plan.items.length + 1}`), itemKey = entityIdentity(ctx.file, `${name}/${itemName}`);
        const presetValue = literal(ca.preset, "preset", ctx, child, "false"); if (presetValue !== "true" && presetValue !== "false") return ctx.fail("RANKING_PRESET", "preset must be true or false", child.span);
        const item: RankingAuthorPlan["items"][number] = { itemKey, preset: presetValue === "true", ...(ca.stack ? { stack: parseNumber(literal(ca.stack, "stack", ctx, child)) } : {}), ...(ca.icon ? { iconIndex: append("icons", reference(ca.icon, [imageType], ctx, child)) } : {}) };
        if (kind === "TopThree") item.instantIndex = append("instants", publishInstant(timeline, decodeInstantAttributes(child, ctx), itemKey, ctx, child.span));
        else {
          if (item.preset ? !!ca.during || !!ca.entry : !ca.during) return ctx.fail("RANKING_PRESET", "preset excludes during/entry; non-preset requires during", child.span);
          if (ca.during) item.windowIndex = append("windows", publishWindow(timeline, decodeWindowAttributes(child, ctx), itemKey, ctx, child.span));
        }
        if (kind === "TierBoard") { item.tier = literal(ca.tier, "tier", ctx, child); if (!ca.icon) return ctx.fail("RANKING_ICON", "TierItem requires icon", child.span); if (!item.preset) { const entry = literal(ca.entry, "entry", ctx, child); if (entry !== "direct" && entry !== "drop") return ctx.fail("RANKING_ENTRY", "entry must be direct or drop", child.span); item.entry = entry; } }
        else {
          if (ca.label?.value.kind === "ref") item.textIndex = append("texts", reference(ca.label, [textType], ctx, child)); else item.label = literal(ca.label, "label", ctx, child);
          if (kind === "Column") item.rank = parseNumber(literal(ca.rank, "rank", ctx, child));
        }
        plan.items.push(item);
        authoredChildren.push({ element: child, item });
      }
      validateRankingPlan(plan);
      const inputs: Record<string, Binding | Binding[]> = { timeline, style, frame: reference(a.frame, [spaceTypes.frame], ctx, element), outer, plan: ctx.record(null, { type: rankingTypes.plan, data: plan as unknown as Json }, element.span), ...lists };
      if (kind !== "TopThree") inputs.canvas = reference(a.canvas, [spaceTypes.canvas], ctx, element);
      else {
        let expression: InstantExpression;
        if (a.terminal?.value.kind === "ref") { const terminal = reference(a.terminal, [timelineTypes.moment], ctx, element); if (terminal.kind !== "record") return ctx.fail("RANKING_TERMINAL", "Moment must be an author-time record", element.span); expression = { kind: "at", source: terminal.value.data as unknown as MomentRef }; }
        else { const source = literal(a.terminal, "terminal", ctx, element); if (!isTimeLiteral(source)) return ctx.fail("RANKING_TERMINAL", "Terminal requires an absolute time or Moment", element.span); expression = { kind: "at", source }; }
        inputs.terminal = publishInstant(timeline, expression, `${trackKey}/terminal`, ctx, element.span);
      }
      const result = ctx.operation({ producer: `${id}#program-${kind}`, inputs, publish: { program: `${name}.program`, schedule: `${name}.schedule` }, label: name, span: element.span });
      ctx.authoring({ binding: result.program!, element, role: "output", identity: trackKey });
      for (const { element: child, item } of authoredChildren) {
        ctx.authoring({ binding: inputs.plan as Binding, element: child, role: "plan", identity: item.itemKey });
        for (const [port, index] of [["windows", item.windowIndex], ["instants", item.instantIndex], ["icons", item.iconIndex], ["texts", item.textIndex]] as const) {
          if (index === undefined) continue;
          ctx.authoring({ binding: lists[port]![index]!, element: child, role: port === "windows" ? "window" : port === "instants" ? "instant" : "input", identity: item.itemKey, consumer: { operation: result.program!.kind === "output" ? result.program!.operation : result.program!.key, port, index }, ...(port === "icons" ? { attribute: "icon" } : port === "texts" ? { attribute: "label" } : {}) });
        }
      }
      ctx.operation({ producer: `${id}#lower`, inputs: { program: result.program! }, publish: { visual: `${name}.visual` }, label: name, span: element.span });
      if (a["appear-sound"] || a["move-sound"]) {
        if (a.style?.value.kind !== "ref") return ctx.fail("RANKING_STYLE", "Style must expose a companion .sound output", element.span);
        const soundStyle = ctx.lookup(`${a.style.value.name}.sound`, a.style.span); if (soundStyle.type !== rankingTypes.sound) return ctx.fail("RANKING_STYLE", "Style must expose its .sound output", element.span);
        ctx.operation({ producer: `${id}#audio`, inputs: { program: result.program!, soundStyle, ...(a["appear-sound"] ? { appear: reference(a["appear-sound"], [timelineTypes.media], ctx, element) } : {}), ...(a["move-sound"] ? { move: reference(a["move-sound"], [timelineTypes.media], ctx, element) } : {}) }, publish: { audio: `${name}.audio`, events: `${name}.events` }, label: name, span: element.span });
      }
    },
  };
  producers[`program-${kind}`] = {
    inputs: { timeline: { type: timelineTypes.timeline }, style: { type: styleType }, frame: { type: spaceTypes.frame }, outer: { type: timelineTypes.window }, plan: { type: rankingTypes.plan }, windows: { type: timelineTypes.window, list: true }, instants: { type: timelineTypes.instant, list: true }, icons: { type: imageType, list: true }, texts: { type: textType, list: true }, ...(kind === "TopThree" ? { terminal: { type: timelineTypes.instant } } : { canvas: { type: spaceTypes.canvas } }) }, outputs: { program: rankingTypes.program, schedule: rankingTypes.schedule },
    run(inputs) { const program = assembleRanking(value<Timeline>(inputs, "timeline"), value<RankingAuthorPlan>(inputs, "plan"), value<RankingStyle>(inputs, "style"), value<Frame>(inputs, "frame"), value<Window>(inputs, "outer"), list<Window>(inputs, "windows"), list<Instant>(inputs, "instants"), list<ResourceRef>(inputs, "icons"), list<string>(inputs, "texts"), kind === "TopThree" ? undefined : value<Canvas>(inputs, "canvas"), kind === "TopThree" ? value<Instant>(inputs, "terminal") : undefined); return { outputs: { program: { type: rankingTypes.program, data: program as unknown as Json }, schedule: { type: rankingTypes.schedule, data: program.schedule as unknown as Json } } }; },
  };
}
producers.lower = { inputs: { program: { type: rankingTypes.program } }, outputs: { visual: renderTypes.visual }, run(inputs) { return { outputs: { visual: { type: renderTypes.visual, data: lowerRanking(value<RankingProgram>(inputs, "program")) as unknown as Json } } }; } };
producers.audio = { inputs: { program: { type: rankingTypes.program }, soundStyle: { type: rankingTypes.sound }, appear: { type: timelineTypes.media, optional: true }, move: { type: timelineTypes.media, optional: true } }, outputs: { audio: renderTypes.audio, events: rankingTypes.events }, run(inputs) { const program = value<RankingProgram>(inputs, "program"); return { outputs: { audio: { type: renderTypes.audio, data: lowerRankingAudio(program, value<SoundStyle>(inputs, "soundStyle"), { ...(inputs.appear ? { appear: value<SynchronizedMedia>(inputs, "appear") } : {}), ...(inputs.move ? { move: value<SynchronizedMedia>(inputs, "move") } : {}) }) as unknown as Json }, events: { type: rankingTypes.events, data: rankingEvents(program) } } }; } };
const ranking: ModuleDef = {
  id, summary: "TierBoard, Column and TopThree cumulative reveals with local sound events.",
  types: {
    TierBoardStyle: { summary: "Tier geometry and exact fonts", validate(data) { validateRankingStyle(data); if (data.kind !== "TierBoard") throw new DvError("TYPE_INVALID", "Expected TierBoardStyle"); } },
    ColumnStyle: { summary: "Column layout and exact fonts", validate(data) { validateRankingStyle(data); if (data.kind !== "Column") throw new DvError("TYPE_INVALID", "Expected ColumnStyle"); } },
    TopThreeStyle: { summary: "Three-slot layout and exact fonts", validate(data) { validateRankingStyle(data); if (data.kind !== "TopThree") throw new DvError("TYPE_INVALID", "Expected TopThreeStyle"); } },
    SoundStyle: { summary: "Normalized event gains and fade-in", validate: validateSoundStyle }, AuthorPlan: { summary: "Typed ranking author indexes", validate: validateRankingPlan }, Schedule: { summary: "Reveal stages and settled spans", validate: validateRankingSchedule }, Program: { summary: "Resolved ranking layout", validate: validateRankingProgram }, Events: { summary: "Ordered sound triggers", validate: validateRankingEvents }, StyleOptions: { summary: "Private style identity", validate(data) { const o = object(data); exact(o, ["kind", "styleKey"]); key(o.styleKey); if (!kinds.includes(o.kind as RankingKind)) throw new DvError("TYPE_INVALID", "Invalid ranking style kind"); } },
  }, surfaces, producers, studio: rankingStudio,
};
export default ranking;
