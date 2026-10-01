import { DvError } from "../../core/errors.ts";
import type { Json } from "../../core/value.ts";
import type { CompanionInput, CompanionProjection, FieldGroup, ParameterOwner, StudioCompanion, StudioEntity, StudioField, StudioMaterial } from "../../studio/companion.ts";
import type { FieldSchema } from "../../studio/protocol.ts";
import { authorFor, sourceFor, field, temporalAuthorities, parameterOwner, ownParameterOwner, referenceOwner } from "../../studio/projection.ts";
import { renderTypes } from "../../render/ir.ts";
import type { AudioTrack } from "../../render/ir.ts";
import { validateVisualTrack, validateAudioTrack } from "../../render/validate.ts";
import { rankingEvents } from "../../components/ranking/program.ts";
import { rankingTypes, RANKING_MODULE as moduleId } from "../../components/ranking/types.ts";
import type { RankingKind, RankingProgram, RankingStyle } from "../../components/ranking/types.ts";
import { validateRankingProgram, validateRankingStyle } from "../../components/ranking/validate.ts";
import { defaults } from "../../components/ranking/author.ts";
import { RECIPE } from "../recipe/index.ts";

const kinds: readonly RankingKind[] = ["TierBoard", "Column", "TopThree"];
const styleTypes = { TierBoard: rankingTypes.tierStyle, Column: rankingTypes.columnStyle, TopThree: rankingTypes.topStyle };
const itemSurfaces = { TierBoard: "TierItem", Column: "ColumnItem", TopThree: "TopThreeItem" };
const sections: readonly [FieldGroup["domain"], string, readonly string[]][] = [
  ["Where", "Layout", ["padding", "row-height", "row-gap", "icon-size", "slot-gap", "center-x", "baseline-y", "label-width", "label-gap"]],
  ["Where", "Stage", ["stage-x", "stage-y", "stage-size"]],
  ["Where", "Stacking", ["board-stack", "stage-stack", "item-stack"]],
  ["How", "Board", ["rows", "rank-colors", "slot-colors", "board-background", "board-border-color", "board-border-width", "board-radius", "board-shadow-x", "board-shadow-y", "board-shadow-blur", "board-shadow-spread", "board-shadow-color", "icon-radius", "icon-radius-ratio", "icon-fit", "ring-width"]],
  ["How", "Text", ["font-size", "font-weight", "text-color", "line-height"]],
  ["How", "Labels", ["label-text-color", "label-size"]],
  ["When", "Motion", ["appear-frames", "move-frames", "motion-easing"]],
  ["How", "Sound", ["appear-gain", "move-gain"]],
  ["When", "Sound", ["sound-fade-frames"]],
];
const ratioKeys = ["label-size", "label-width", "stage-x", "stage-y", "icon-radius-ratio", "center-x", "baseline-y", "appear-gain", "move-gain"];
const colorSchema: FieldSchema = { type: "string", pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" };
const rowsSchema: FieldSchema = { type: "array", minItems: 1, items: { type: "object", required: ["id", "label", "color"], additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" }, color: colorSchema } } };
const colorsSchema: FieldSchema = { type: "array", minItems: 1, items: colorSchema };

function styleOwner(input: CompanionInput, style: RankingStyle): { owner?: ParameterOwner; recipe?: ParameterOwner } {
  const ownStyle = input.type === styleTypes[style.kind];
  const owner = ownStyle ? ownParameterOwner(input) : parameterOwner(input, "style");
  if (!owner) return {};
  const recipeAuthor = referenceOwner(input, owner.authorKey, "recipe");
  const reference = input.authoring.references.find(item => item.authorKey === owner.authorKey && item.attribute === "recipe");
  const record = reference ? input.authorGraph.records.get(reference.bindingKey) : undefined;
  if (!recipeAuthor || !record || record.value.type !== RECIPE) return { owner };
  return { owner, recipe: { key: recipeAuthor.authorKey, authorKey: recipeAuthor.authorKey, moduleId: RECIPE.slice(0, RECIPE.lastIndexOf("#")), surface: recipeAuthor.surface, output: "", value: record.value, bindings: [] } };
}

function styleGroups(input: CompanionInput, style: RankingStyle): Pick<CompanionProjection, "fieldGroups" | "parameterOwners"> {
  const owners = styleOwner(input, style);
  const ownerKey = owners.recipe?.authorKey ?? owners.owner?.authorKey ?? input.authorKey;
  const fields = new Map<string, StudioField>();
  for (const name of [...Object.keys(defaults[style.kind]), ...(style.kind === "TierBoard" ? ["label-width"] : [])]) {
    const value = style.properties[name];
    if (value === undefined) continue;
    const choices = name === "icon-fit" ? ["contain", "cover"] : name === "motion-easing" ? ["linear", "ease-in", "ease-out", "ease-in-out"] : undefined;
    const result = field(input, ownerKey, name, { label: name, widget: choices ? "select" : Array.isArray(value) ? "list" : typeof value === "number" ? "number" : name.includes("color") || name === "board-background" ? "color" : "text", schemaKey: `${moduleId}#${style.kind}Style.${name}`, authorValue: value,
      ...(choices ? { options: choices.map(value => ({ value, label: value })) } : {}),
      ...(ratioKeys.includes(name) ? { displayScale: 100, units: ["%"] } : name.endsWith("-frames") ? { units: ["f"] } : {}),
      ...(name === "rows" ? { schema: rowsSchema } : name.endsWith("colors") ? { schema: colorsSchema } : name.includes("color") || name === "board-background" ? { schema: colorSchema } : name.endsWith("-gain") ? { schema: { type: "number" as const, minimum: 0, maximum: 64 } } : {}),
    });
    fields.set(name, owners.recipe ? result : { ...result, readonly: true, endpointKey: undefined, binding: undefined });
  }
  const fieldGroups = sections.flatMap(([domain, sectionKey, names], index) => {
    const selected = names.flatMap(name => fields.has(name) ? [fields.get(name)!] : []);
    return selected.length ? [{ key: `${ownerKey}/${domain}/${sectionKey}/${index}`, ownerKey, domain, pageKey: domain, sectionKey, fields: selected }] : [];
  });
  return { fieldGroups, parameterOwners: [owners.owner, owners.recipe].filter((owner): owner is ParameterOwner => !!owner) };
}

function programFor(input: CompanionInput): RankingProgram {
  const value = input.type === rankingTypes.program ? input.value : input.supports.program;
  if (!value || value.type !== rankingTypes.program) throw new DvError("STUDIO_SUPPORT", "Ranking projection requires its real Program support output.");
  validateRankingProgram(value.data);
  return value.data;
}

export function projectRanking(input: CompanionInput): CompanionProjection {
  const program = programFor(input), { schedule } = program;
  const rendered = input.type === renderTypes.visual ? input.value : input.supports.visual;
  if (!rendered || rendered.type !== renderTypes.visual) throw new DvError("STUDIO_SUPPORT", "Ranking projection requires its real visual output.");
  validateVisualTrack(rendered.data);
  const visual = rendered.data;
  const boardAuthor = authorFor(input, schedule.trackKey);
  if (!boardAuthor || schedule.items.some(item => !authorFor(input, item.itemKey))) throw new DvError("STUDIO_PROVENANCE", "Ranking board or item has no registered author identity.");
  const boardAuthorKey = boardAuthor.authorKey;
  const boardLane = `${boardAuthorKey}/board`, childLane = `${boardAuthorKey}/items`;
  const parameters = styleGroups(input, program.style);
  const ownerKeys = parameters.parameterOwners.map(owner => owner.key);
  const frameOwner = parameterOwner(input, "frame");
  const frameFields = frameOwner ? authorFor(input, frameOwner.authorKey)?.attributes.flatMap(attribute => {
    if (["id", "within"].includes(attribute.name)) return [];
    const authorValue = attribute.attribute.value.kind === "literal" ? attribute.attribute.value.text : attribute.attribute.value.name;
    const length = ["left", "top", "right", "bottom", "x", "y", "width", "height", "offset-x", "offset-y"].includes(attribute.name);
    return [field(input, frameOwner.authorKey, attribute.name, { label: attribute.name, widget: length ? "number" : "text", schemaKey: `${frameOwner.moduleId}#${frameOwner.surface.slice(frameOwner.surface.lastIndexOf(":") + 1)}/${attribute.name}`, authorValue, ...(length ? { units: ["%", "px"] } : {}) })];
  }) ?? [] : [];
  const frameGroups: FieldGroup[] = frameOwner && frameFields.length ? [{ key: `${frameOwner.key}/Frame`, ownerKey: frameOwner.key, domain: "Where", pageKey: "Where", sectionKey: "Frame", fields: frameFields }] : [];
  if (frameOwner) ownerKeys.push(frameOwner.key);
  const boardPresent = visual.presents.find(present => present.presentKey === `${schedule.trackKey}/board`);
  if (!boardPresent || visual.trackKey !== schedule.trackKey || visual.axisKey !== schedule.axisKey) throw new DvError("STUDIO_PROVENANCE", "Ranking visual output does not belong to its Program support.");
  const entities: StudioEntity[] = [{ editorKey: `${boardAuthorKey}/board`, authorKey: boardAuthorKey, title: `${schedule.kind} Board`, paintRank: Number(program.style.properties["board-stack"]), intervals: [schedule.outer.frames], laneKey: boardLane, pictureParts: [boardPresent.presentKey, ...boardPresent.nodes.map(node => node.nodeKey)], parameterOwners: ownerKeys, sourceSlice: sourceFor(input, schedule.trackKey), facts: { kind: schedule.kind, frame: program.frame as unknown as Json }, temporal: temporalAuthorities(input, schedule.trackKey, "outer") }];
  const materials: StudioMaterial[] = [];
  const itemGroups: FieldGroup[] = [];
  for (const item of schedule.items) {
    const author = authorFor(input, item.itemKey)!, authorKey = author.authorKey;
    const itemFields: StudioField[] = [];
    const names = schedule.kind === "TierBoard" ? ["tier"] : schedule.kind === "Column" ? ["label", "rank"] : ["label"];
    for (const name of names) {
      const value = item[name as "tier" | "label" | "rank"];
      if (value !== undefined) itemFields.push(field(input, authorKey, name, { label: name, widget: typeof value === "number" ? "number" : "text", schemaKey: `${moduleId}#${itemSurfaces[schedule.kind]}.${name}`, authorValue: value }));
    }
    if (schedule.kind !== "TopThree") itemFields.push(field(input, authorKey, "preset", { label: "preset", widget: "boolean", schemaKey: `${moduleId}#${itemSurfaces[schedule.kind]}.preset`, authorValue: item.preset }));
    const iconAttribute = author.attributes.find(attribute => attribute.name === "icon");
    if (iconAttribute?.attribute.value.kind === "ref") itemFields.push(field(input, authorKey, "icon", { label: "icon", widget: "text", schemaKey: `${moduleId}#${itemSurfaces[schedule.kind]}.icon`, authorValue: iconAttribute.attribute.value.name }));
    itemGroups.push({ key: `${authorKey}/Item`, ownerKey: authorKey, domain: "How", pageKey: "How", sectionKey: "Item", fields: itemFields });
    itemGroups.push({ key: `${authorKey}/Stacking`, ownerKey: authorKey, domain: "Where", pageKey: "Where", sectionKey: "Stacking", fields: [field(input, authorKey, "stack", { label: "stack", widget: "number", schemaKey: `${moduleId}#${itemSurfaces[schedule.kind]}.stack`, authorValue: item.stack })] });
    if (item.entry) itemGroups.push({ key: `${authorKey}/Entrance`, ownerKey: authorKey, domain: "When", pageKey: "When", sectionKey: "Entrance", fields: [field(input, authorKey, "entry", { label: "entry", widget: "select", schemaKey: `${moduleId}#TierItem.entry`, authorValue: item.entry, options: ["direct", "drop"].map(value => ({ value, label: value })) })] });
    const parts = visual.presents.filter(present => present.presentKey === `${item.itemKey}/active` || present.presentKey === `${item.itemKey}/settled`);
    const materialKey = `${authorKey}/icon`;
    if (item.icon) materials.push({ key: materialKey, kind: "image", resource: item.icon });
    entities.push({ editorKey: `${authorKey}/item`, authorKey, title: item.label ?? item.tier ?? "Item", paintRank: item.stack,
      intervals: [item.active], visibleIntervals: parts.map(present => present.lifetime), laneKey: childLane, text: item.label, sourceSlice: sourceFor(input, item.itemKey), pictureParts: parts.flatMap(present => [present.presentKey, ...present.nodes.map(node => node.nodeKey)]), materials: item.icon ? [materialKey] : [], parameterOwners: [authorKey, ...ownerKeys], facts: { preset: item.preset, slot: item.slot, active: item.active, settled: item.settled }, temporal: temporalAuthorities(input, item.itemKey, item.activation ? "instants" : "windows") });
  }
  return { entities, lanes: [{ key: boardLane, title: "Board", height: 80, order: 0 }, { key: childLane, title: schedule.kind === "TopThree" ? "Activations" : "Reveals", height: 40, order: 1, parentLaneKey: boardLane }], bands: [], materials, fieldGroups: [...frameGroups, ...parameters.fieldGroups, ...itemGroups], parameterOwners: [...parameters.parameterOwners, ...(frameOwner ? [frameOwner] : [])] };
}

export function projectRankingAudio(input: CompanionInput): CompanionProjection {
  const program = programFor(input);
  const audio = input.value.data as unknown as AudioTrack;
  if (input.type !== renderTypes.audio || audio.kind !== "audio") throw new DvError("STUDIO_TYPE", "Ranking sound projection requires AudioTrack.");
  validateAudioTrack(input.value.data);
  if (program.schedule.items.some(item => !authorFor(input, item.itemKey))) throw new DvError("STUDIO_PROVENANCE", "Ranking sound trigger has no registered item identity.");
  const events = rankingEvents(program);
  const laneKey = `${input.authorKey}/sound`;
  const parameters = styleGroups(input, program.style);
  const soundGroups = parameters.fieldGroups.filter(group => group.sectionKey === "Sound");
  const materials: StudioMaterial[] = [];
  const triggerGroups: FieldGroup[] = [];
  const fps = program.timeline.clock.fps;
  const entities = audio.clips.map(clip => {
    const event = events.events.find(event => event.eventKey === clip.clipKey);
    if (!event) throw new DvError("STUDIO_PROVENANCE", "Ranking sound clip has no visual trigger event.");
    const authorKey = authorFor(input, event.itemKey)!.authorKey;
    const item = program.schedule.items.find(item => item.itemKey === event.itemKey)!;
    triggerGroups.push({ key: `${authorKey}/sound/${event.kind}/trigger`, ownerKey: authorKey, domain: "When", pageKey: "When", sectionKey: "Sound", fields: [{ fieldKey: `${event.eventKey}/trigger`, ownerKey: authorKey, label: `${event.kind} trigger`, widget: "number", schemaKey: `${moduleId}#Events.frame`, authorValue: event.frame, units: ["f"], readonly: true }] });
    const materialKey = `${input.authorKey}/${clip.clipKey}/material`;
    materials.push({ key: materialKey, kind: "audio", resource: clip.source, facts: { sourceSamples: clip.sourceSamples, targetSamples: clip.targetSamples, gain: clip.gain, fadeInSamples: clip.fadeInSamples } });
    return { editorKey: `${authorKey}/sound/${event.kind}`, authorKey, title: `${event.kind}: ${item.label ?? event.itemKey}`, paintRank: 0, intervals: [{ start: event.frame, end: Math.min(program.timeline.totalFrames, Math.ceil(clip.targetSamples.end * fps.numerator / (48000 * fps.denominator))) }], laneKey, sourceSlice: sourceFor(input, event.itemKey), pictureParts: [], parameterOwners: [authorKey, ...parameters.parameterOwners.map(owner => owner.key)], fieldGroupKeys: [...soundGroups.map(group => group.key), `${authorKey}/sound/${event.kind}/trigger`], materials: [materialKey], facts: { triggerEvent: event.eventKey, triggerFrame: event.frame, triggerKind: event.kind, targetSamples: clip.targetSamples }, temporal: temporalAuthorities(input, event.itemKey, item.activation ? "instants" : "windows").map(authority => ({ ...authority, key: `${authority.originKey}:visual-trigger`, consumerPort: "visual-trigger", gestures: [], ...(authority.binding ? { binding: { ...authority.binding, access: "read" as const } } : {}) })) };
  });
  return { entities, lanes: [{ key: laneKey, title: "Ranking sound", height: 48, order: 0 }], bands: [], materials, fieldGroups: [...soundGroups, ...triggerGroups], parameterOwners: parameters.parameterOwners };
}

export const rankingStudio: readonly StudioCompanion[] = [
  { protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/boards`, moduleId, matches: kinds.map(surface => ({ surface, output: "visual", type: renderTypes.visual })), family: "ranking", icon: "board", tone: "orange", supports: [{ output: "program", type: rankingTypes.program }, { output: "schedule", type: rankingTypes.schedule }], project: projectRanking },
  { protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/sound`, moduleId, matches: kinds.map(surface => ({ surface, output: "audio", type: renderTypes.audio })), family: "ranking-sound", icon: "audio", tone: "green", supports: [{ output: "program", type: rankingTypes.program }, { output: "events", type: rankingTypes.events }], project: projectRankingAudio },
  { protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/style`, moduleId, matches: kinds.map(kind => ({ surface: `${kind}Style`, output: "", type: styleTypes[kind] })), family: "ranking-style", icon: "board", tone: "neutral", project(input) { validateRankingStyle(input.value.data); const parameters = styleGroups(input, input.value.data); return { entities: [], lanes: [], bands: [], materials: [], ...parameters }; } },
];
