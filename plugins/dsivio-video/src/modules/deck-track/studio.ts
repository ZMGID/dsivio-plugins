import type { Json } from "../../core/value.ts";
import type { CompanionInput, CompanionProjection, FieldGroup, StudioCompanion, StudioEntity, StudioMaterial, StudioField } from "../../studio/companion.ts";
import type { DeckProgram, DeckCard, DeckLabel } from "../../components/deck-track/types.ts";
import { deckTypes } from "../../components/deck-track/types.ts";
import { validateDeckProgram, validateDeckLabel } from "../../components/deck-track/validate.ts";
import { DECK_KEYS, deckStages } from "../../components/deck-track/program.ts";
import { renderTypes } from "../../render/ir.ts";
import type { VisualTrack } from "../../render/ir.ts";
import { authorFor, emptyProjection, field, referenceOwner, sourceFor, temporalAuthorities } from "../../studio/projection.ts";

const options: Readonly<Record<string, readonly string[]>> = {
  "previous-rotation-mode": ["linear", "alternate"], "next-rotation-mode": ["linear", "alternate"],
  "reflow-easing": ["linear", "ease-in", "ease-out", "ease-in-out"], "playback-future": ["hold-head", "continue"], "playback-past": ["hold-tail", "continue", "hide"],
  fit: ["contain", "cover", "fit-width", "fit-height", "native", "scale-down", "stretch"], "fit-constraint": ["bounded", "free"], clip: ["none", "frame", "rounded"], "border-style": ["solid", "dashed", "dotted"],
};
function resolvedProperties(card: DeckCard): Record<string, Json> {
  const p: Record<string, Json> = {
    "visible-previous": card.depth.visiblePrevious, "visible-next": card.depth.visibleNext, wrap: card.depth.wrap,
    "reflow-frames": card.depth.reflowFrames, "reflow-easing": card.depth.reflowEasing, "playback-future": card.depth.playbackFuture, "playback-past": card.depth.playbackPast,
    "previous-rotation-mode": card.depth.previous.rotationMode, "next-rotation-mode": card.depth.next.rotationMode,
    "stack-order": card.appearance.layer, fit: card.appearance.fit.mode ?? "contain", "frame-x": card.appearance.fit.frameAnchor?.x ?? .5, "frame-y": card.appearance.fit.frameAnchor?.y ?? .5,
    "content-x": card.appearance.fit.contentAnchor?.x ?? .5, "content-y": card.appearance.fit.contentAnchor?.y ?? .5, "fit-offset-x": card.appearance.fit.offsetXPx ?? 0,
    "fit-offset-y": card.appearance.fit.offsetYPx ?? 0, "fit-constraint": card.appearance.fit.limit ?? "bounded", clip: card.appearance.clip, radius: card.appearance.radiusPx,
    opacity: Number(card.appearance.outerStyle.find(item => item.property === "opacity")?.value ?? 1), blur: 0, brightness: 1, contrast: 1, saturation: 1,
    padding: "0", "border-width": 0, "border-style": "solid", "border-color": "#00000000", shadows: null, "frame-paint": null,
  };
  for (const key of ["x", "y", "rotation", "scale", "opacity", "stacking", "brightness", "contrast", "saturation"] as const) {
    p[`current-${key}`] = card.depth.current[key]; p[`previous-${key}-step`] = card.depth.previous[key]; p[`next-${key}-step`] = card.depth.next[key];
  }
  return p;
}
function appearanceGroups(input: CompanionInput, authorKey: string, card: DeckCard): { groups: FieldGroup[]; ownerKey: string } {
  const owner = referenceOwner(input, authorKey, "appearance") ?? referenceOwner(input, input.authorKey, "appearance");
  const ownerKey = owner?.authorKey ?? authorKey, resolved = resolvedProperties(card);
  const property = (name: string): Json => owner?.recipe?.properties.find(p => p.name === name)?.value ?? resolved[name] ?? null;
  const sections: { domain: FieldGroup["domain"]; page: string; names: readonly string[] }[] = [
    { domain: "Where", page: "Depth", names: DECK_KEYS.filter(name => !name.startsWith("reflow") && !name.startsWith("playback")) },
    { domain: "Where", page: "Frame", names: ["stack-order", "fit", "frame-x", "frame-y", "content-x", "content-y", "fit-offset-x", "fit-offset-y", "fit-constraint", "clip", "radius", "padding"] },
    { domain: "How", page: "Appearance", names: ["opacity", "blur", "brightness", "contrast", "saturation", "border-width", "border-style", "border-color", "shadows", "frame-paint", "playback-future", "playback-past"] },
    { domain: "When", page: "Motion", names: ["reflow-frames", "reflow-easing", "sustain"] },
  ];
  const groups: FieldGroup[] = sections.map(section => ({
    key: `${ownerKey}/${section.domain}/${section.page}`, ownerKey, domain: section.domain, pageKey: section.page, sectionKey: section.page,
    fields: section.names.map(name => {
      const values = options[name], authorValue = property(name);
      const widget: StudioField["widget"] = values ? "select" : name === "wrap" ? "boolean" : name === "border-color" ? "color" : ["padding", "shadows", "frame-paint", "sustain"].includes(name) ? "text" : "number";
      return field(input, ownerKey, name, { label: name, widget, authorValue, schemaKey: `dsivio-video/deck-track@1#appearance/${name}`,
        schema: { type: widget === "boolean" ? "boolean" : widget === "number" ? "number" : "string" },
        ...(values ? { options: values.map(value => ({ value, label: value })) } : {}),
        ...(name.includes("opacity") ? { displayScale: 100 } : {}),
      });
    }),
  }));
  for (const edge of ["enter", "exit"] as const) {
    const members = [edge, ...["frames", "easing", "direction", "amount", "origin"].map(name => `${edge}-${name}`)];
    const authored = Object.fromEntries(members.flatMap(name => {
      const value = owner?.recipe?.properties.find(p => p.name === name)?.value;
      return value === undefined ? [] : [[name, value]];
    }));
    groups.push({ key: `${ownerKey}/When/${edge}`, ownerKey, domain: "When", pageKey: "Motion", sectionKey: edge, fields: [field(input, ownerKey, edge, {
      label: edge, widget: "record", authorValue: authored, schemaKey: `dsivio-video/deck-track@1#${edge}`, groupMembers: members,
      schema: { type: "object", properties: { [edge]: { type: "string", enum: ["none", "fade", "slide", "scale", "pop", "bounce", "blur-reveal", "wipe", "flip", "spin"] }, [`${edge}-frames`]: { type: "number", minimum: 0 }, [`${edge}-easing`]: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"] }, [`${edge}-direction`]: { type: "string", enum: ["left", "right", "up", "down"] }, [`${edge}-amount`]: { type: "number" }, [`${edge}-origin`]: { type: "string", enum: ["outside-canvas"] } }, additionalProperties: false },
    })] });
  }
  const moving = card.source.kind === "media" || card.source.kind === "surface" && card.source.surface.timing.kind === "frames";
  if (moving) {
    const authorValue: Record<string, Json> = { playback: card.appearance.playback, ...(card.appearance.trim ? { "trim-start": card.appearance.trim.start, "trim-end": card.appearance.trim.end } : {}) };
    groups.push({ key: `${ownerKey}/How/Playback`, ownerKey, domain: "How", pageKey: "Appearance", sectionKey: "Playback", fields: [field(input, ownerKey, "playback", {
      label: "Playback / Trim", widget: "record", authorValue, schemaKey: "dsivio-video/deck-track@1#playback", groupMembers: ["playback", "trim-start", "trim-end"],
      schema: { type: "object", required: ["playback"], additionalProperties: false, properties: { playback: { type: "string", enum: ["once-start", "once-end", "hold-start", "hold-end", "loop-start", "loop-end", "stretch"] }, "trim-start": { type: "number", minimum: 0 }, "trim-end": { type: "number", minimum: 1 } } },
    })] });
  }
  return { groups, ownerKey };
}
function material(card: DeckCard): StudioMaterial {
  const key = `${card.cardKey}/source`;
  if (card.source.kind === "image") return { key, kind: "image", resource: card.source.resource, facts: { extent: card.source.extent } };
  if (card.source.kind === "media") return { key, kind: "video", resource: card.source.media.picture!.resource, facts: { totalFrames: card.source.media.totalFrames, trim: card.appearance.trim ?? { start: 0, end: card.source.media.totalFrames } } };
  return { key, kind: "surface", value: { type: renderTypes.surface, data: card.source.surface as unknown as Json } };
}
function frameGroup(input: CompanionInput): FieldGroup | undefined {
  const owner = referenceOwner(input, input.authorKey, "frame");
  if (!owner) return undefined;
  const surface = owner.surface.slice(owner.surface.lastIndexOf(":") + 1);
  const names = surface === "Frame" ? ["left", "top", "right", "bottom"] : ["x", "y", "width", "height", "aspect", "anchor", "offset-x", "offset-y"];
  const fields = owner.attributes.filter(attribute => names.includes(attribute.name)).map(attribute => {
    const authorValue = attribute.attribute.value.kind === "literal" ? attribute.attribute.value.text : null;
    const anchors = attribute.name === "anchor" ? ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"] : undefined;
    return field(input, owner.authorKey, attribute.name, { label: attribute.name, widget: anchors ? "select" : "number", schemaKey: `dsivio-video/space@1#${surface}/${attribute.name}`, authorValue, schema: { type: "string" },
      ...(anchors ? { options: anchors.map(value => ({ value, label: value })) } : {}),
      ...(["left", "top", "right", "bottom", "x", "y", "width", "height"].includes(attribute.name) ? { units: ["px", "%"] } : {}),
    });
  });
  return { key: `${owner.authorKey}/Where/Geometry`, ownerKey: owner.authorKey, domain: "Where", pageKey: "Frame", sectionKey: "Geometry", fields };
}
export const deckTrackStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/deck-track@1#track-studio", moduleId: "dsivio-video/deck-track@1",
  matches: [{ surface: "DepthStack", output: "track", type: renderTypes.visual }], supports: [{ output: "program", type: deckTypes.program }], family: "deck", icon: "image", tone: "blue",
  project(input): CompanionProjection {
    const support = input.supports.program; if (!support) return input.fallback(); validateDeckProgram(support.data);
    const program = support.data as unknown as DeckProgram, track = input.value.data as unknown as VisualTrack;
    const laneKey = `${input.authorKey}/deck`, fieldGroups: FieldGroup[] = [], materials: StudioMaterial[] = [];
    const stages = deckStages(program), presents = new Map(track.presents.map(p => [p.presentKey, p]));
    const geometry = frameGroup(input);
    if (geometry) fieldGroups.push(geometry);
    const entities: StudioEntity[] = program.cards.map((card, index) => {
      const author = authorFor(input, card.cardKey), authorKey = author?.authorKey ?? input.authorKey;
      const sourceSlice = sourceFor(input, card.cardKey), appearance = appearanceGroups(input, authorKey, card);
      fieldGroups.push(...appearance.groups); materials.push(material(card));
      const cardParts = stages.flatMap((stage, stageIndex) => {
        const present = presents.get(`${program.trackKey}/${stageIndex}/${card.cardKey}`);
        return present ? [present] : [];
      });
      const label = card.label ? authorFor(input, card.label.labelKey) : undefined;
      const sourceOwner = referenceOwner(input, authorKey, "source");
      return { editorKey: authorKey === input.authorKey ? `${authorKey}/card/${index}` : authorKey, authorKey,
        title: card.label?.flow.paragraphs.flatMap(p => p.runs.filter(run => run.kind === "run").map(run => run.text)).join("") || `Card ${index + 1}`,
        paintRank: card.appearance.layer, intervals: [{ start: card.activation.frame, end: program.cards[index + 1]?.activation.frame ?? program.terminal.frame }],
        visibleIntervals: cardParts.map(p => p.lifetime), laneKey, materials: [`${card.cardKey}/source`], pictureParts: cardParts.flatMap(p => [p.presentKey, ...p.nodes.map(node => node.nodeKey)]),
        parameterOwners: [appearance.ownerKey, ...(geometry ? [geometry.ownerKey] : []), ...(label ? [label.authorKey] : []), ...(sourceOwner ? [sourceOwner.authorKey] : [])], facts: { sourceKind: card.source.kind, activation: card.activation.frame, terminal: program.terminal.frame },
        temporal: temporalAuthorities(input, card.cardKey, "instants"), ...(sourceSlice ? { sourceSlice } : {}),
      };
    });
    const uniqueGroups = [...new Map(fieldGroups.map(group => [group.key, group])).values()];
    return { ...emptyProjection(), entities, materials, fieldGroups: uniqueGroups, lanes: [{ key: laneKey, title: "Deck", height: 52, order: 0 }] };
  },
};
export const deckLabelStudio: StudioCompanion = {
  protocol: "dsivio-video.studio-companion/1", key: "dsivio-video/deck-track@1#label-studio", moduleId: "dsivio-video/deck-track@1",
  matches: [{ surface: "Label", output: "", type: deckTypes.label }], family: "deck-label", icon: "text", tone: "blue",
  project(input) {
    validateDeckLabel(input.value.data); const label = input.value.data as unknown as DeckLabel;
    const text = label.flow.paragraphs.flatMap(p => p.runs.filter(run => run.kind === "run").map(run => run.text)).join("\n");
    const ownerKey = input.authorKey;
    const copyOwner = referenceOwner(input, ownerKey, "content")?.authorKey ?? ownerKey;
    const styling: StudioField[] = [
      field(input, ownerKey, "size", { label: "Size", widget: "number", schemaKey: "dsivio-video/deck-track@1#label-size", authorValue: label.flow.format.sizePx, schema: { type: "number", minimum: 0 } }),
      field(input, ownerKey, "color", { label: "Color", widget: "color", schemaKey: "dsivio-video/deck-track@1#label-color", authorValue: "#FFFFFF" }),
      field(input, ownerKey, "align", { label: "Align", widget: "select", schemaKey: "dsivio-video/deck-track@1#label-align", authorValue: label.flow.layout.align === "start" ? "left" : label.flow.layout.align === "end" ? "right" : "center", options: ["left", "center", "right"].map(value => ({ value, label: value })) }),
      field(input, ownerKey, "block", { label: "Block", widget: "select", schemaKey: "dsivio-video/deck-track@1#label-block", authorValue: label.flow.layout.blockAlign, options: ["start", "center", "end"].map(value => ({ value, label: value })) }),
      field(input, ownerKey, "padding", { label: "Padding", widget: "number", schemaKey: "dsivio-video/deck-track@1#label-padding", authorValue: label.flow.layout.paddingPx[0]!, schema: { type: "number", minimum: 0 } }),
    ];
    return { ...emptyProjection(), fieldGroups: [
      { key: `${copyOwner}/How/Label`, ownerKey: copyOwner, domain: "How", pageKey: "Label", sectionKey: "Copy", fields: [field(input, copyOwner, "$body", { label: "Text", widget: "text", schemaKey: "dsivio-video/deck-track@1#label-copy", authorValue: text })] },
      { key: `${ownerKey}/How/Label Appearance`, ownerKey, domain: "How", pageKey: "Label", sectionKey: "Appearance", fields: styling },
    ] };
  },
};
