import type { CompanionInput, CompanionProjection, StudioCompanion, StudioMaterial } from "../../studio/companion.ts";
import type { ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Frame } from "../../space/types.ts";
import type { Json } from "../../core/value.ts";
import { DvError } from "../../core/errors.ts";
import { validateFrame } from "../../space/validate.ts";
import { decodeComposeImage } from "../../components/image-compose/author.ts";
import { validateComposePlan } from "../../components/image-compose/validate.ts";
import { composePlanType } from "../../components/image-compose/types.ts";
import { authorFor, emptyProjection, field, parameterOwner, sourceFor } from "../../studio/projection.ts";

const moduleId = "dsivio-video/image-compose@1";
export function authorImage(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  decodeComposeImage(node, { ...ctx, operation(spec) {
    const outputs = ctx.operation(spec);
    const output = outputs.image!;
    if (output.kind !== "output" || node.kind !== "element") return outputs;
    const children = node.children.filter(child => child.kind === "element");
    for (const port of ["sources", "frames"]) {
      const values = spec.inputs[port];
      if (Array.isArray(values)) values.forEach((binding, index) => ctx.authoring({ binding, element: children[index]!, role: "input", attribute: port === "sources" ? "source" : "frame", consumer: { operation: output.operation, port, index } }));
    }
    return outputs;
  } });
}
function material(key: string, value: CompanionInput["value"]): StudioMaterial {
  return value.type === "dsivio-video/media@1#Image" ? { key, kind: "image", resource: value.data as unknown as NonNullable<StudioMaterial["resource"]> } : { key, kind: "surface", value };
}
function project(input: CompanionInput): CompanionProjection {
  const planValue = input.inputs.plan?.[0];
  if (!planValue) return input.fallback();
  validateComposePlan(planValue.data);
  const plan = planValue.data;
  const sources = input.inputs.sources ?? [];
  const frames = input.inputs.frames ?? [];
  if (sources.length !== plan.layers.length || frames.length !== sources.length) throw new DvError("STUDIO_COMPOSE_INPUTS", "Composition layers require their actual ordered sources and frames.");
  const laneKey = `${input.authorKey}/layers`;
  const materials = sources.map((source, index) => material(`${input.authorKey}/source/${index}`, source));
  materials.push(material(`${input.authorKey}/result`, input.value));
  const layerOwners = frames.map((_, index) => parameterOwner(input, "frames", index));
  const owners = layerOwners.filter(owner => owner !== undefined);
  const entities = sources.map((source, index) => {
    const edge = input.executionEdges.find(edge => edge.port === "sources" && edge.index === index);
    const relation = edge && input.authoring.relations.find(r => r.consumer?.operation === edge.operation && r.consumer.port === "sources" && r.consumer.index === index);
    const authorKey = relation?.authorKey ?? input.authorKey;
    return { editorKey: `${authorKey}/layer/${index}`, authorKey, title: `Layer ${index + 1}`, paintRank: index, intervals: [], laneKey, pictureParts: [], materials: [materials[index]!.key], parameterOwners: layerOwners[index] ? [layerOwners[index]!.key] : [], temporal: [], sourceSlice: sourceFor(input, authorKey), facts: { source: source.data, frame: frames[index]!.data, composite: plan.layers[index] as unknown as Json, time: "static" } };
  });
  return { ...emptyProjection(), lanes: [{ key: laneKey, title: "Image layers", height: 52, order: 0 }], materials, entities, parameterOwners: owners,
    fieldGroups: [{ key: `${input.authorKey}/composite`, ownerKey: input.authorKey, domain: "How", pageKey: "Composite", sectionKey: "Paint", fields: [field(input, input.authorKey, "background", { label: "Background", widget: "color", schemaKey: `${composePlanType}/background`, authorValue: plan.background, schema: { type: "string", pattern: "^#[0-9a-fA-F]{8}$" } })] },
      ...entities.flatMap((entity, index) => {
        const layer = plan.layers[index]!;
        const frameOwner = parameterOwner(input, "frames", index);
        const frameValue = frames[index]!;
        validateFrame(frameValue.data);
        const frame: Frame = frameValue.data;
        return [{ key: `${entity.editorKey}/paint`, ownerKey: entity.authorKey, domain: "How" as const, pageKey: "Composite", sectionKey: "Layer", fields: [
          field(input, entity.authorKey, "fit", { label: "Fit", widget: "select", schemaKey: `${composePlanType}/fit`, authorValue: layer.fit, options: ["contain", "cover", "stretch"].map(value => ({ value, label: value })) }),
          field(input, entity.authorKey, "interpolation", { label: "Interpolation", widget: "select", schemaKey: `${composePlanType}/interpolation`, authorValue: layer.interpolation, options: ["nearest", "linear", "cubic", "area", "lanczos"].map(value => ({ value, label: value })) }),
          field(input, entity.authorKey, "opacity", { label: "Opacity", widget: "number", schemaKey: `${composePlanType}/opacity`, authorValue: layer.opacity, displayScale: 100, schema: { type: "number", minimum: 0, maximum: 1 } })] },
          { key: `${entity.editorKey}/geometry`, ownerKey: frameOwner?.authorKey ?? entity.authorKey, domain: "Where" as const, pageKey: "Geometry", sectionKey: "Frame", fields: (frameOwner ? authorFor(input, frameOwner.authorKey)?.attributes.filter(attribute => ["left", "top", "right", "bottom", "x", "y", "width", "height", "aspect", "anchor", "offset-x", "offset-y", "fit", "frame-x", "frame-y", "content-x", "content-y", "constraint"].includes(attribute.name)) ?? [] : []).map(attribute => {
            const value = attribute.attribute.value;
            return field(input, frameOwner!.authorKey, attribute.name, { label: attribute.name, widget: ["aspect", "anchor", "fit", "constraint"].includes(attribute.name) ? "text" : "number", schemaKey: `dsivio-video/space@1#Frame/${attribute.name}`, authorValue: value.kind === "literal" ? value.text : value.name, units: ["px", "%"] });
          }) }];
      })] };
}
export const imageComposeCompanions: readonly StudioCompanion[] = [{ protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/image`, moduleId, family: "image-compose", icon: "image", tone: "green", matches: [{ surface: "Image", output: "image", type: "dsivio-video/media@1#Image" }], project }];
