import type { CompanionInput, CompanionProjection, StudioCompanion, StudioMaterial } from "../../studio/companion.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { ElaborationContext } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import type { FieldSchema } from "../../studio/projection.ts";
import { DvError } from "../../core/errors.ts";
import { imageProgramType } from "../../components/image-transform/types.ts";
import { validateImageProgram } from "../../components/image-transform/validate.ts";
import { decodeImageProgram, decodeImageTransform, operationAttributes } from "../../components/image-transform/author.ts";
import { authorFor, emptyProjection, field, parameterOwner, sourceFor } from "../../studio/projection.ts";

const moduleId = "dsivio-video/image-transform@1";
export function authorProgram(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  decodeImageProgram(node, { ...ctx, record(name, value, span) {
    const binding = ctx.record(name, value, span);
    ctx.authoring({ binding, element: node, role: "parameter", attribute: "$children" });
    if (node.kind === "element") node.children.filter(child => child.kind === "element").forEach((child, index) => ctx.authoring({ binding, element: child, role: "plan", identity: `${binding.key}/orderedSteps/${index}` }));
    return binding;
  } });
}
export function authorTransform(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  decodeImageTransform(node, { ...ctx, operation(spec) {
    const outputs = ctx.operation(spec);
    const output = outputs.image!;
    if (output.kind === "output") for (const [port, binding] of Object.entries(spec.inputs)) if (!Array.isArray(binding)) ctx.authoring({ binding, element: node, role: "input", attribute: port, consumer: { operation: output.operation, port } });
    return outputs;
  } });
}
function material(key: string, value: CompanionInput["value"]): StudioMaterial {
  return value.type === "dsivio-video/media@1#Image" ? { key, kind: "image", resource: value.data as unknown as NonNullable<StudioMaterial["resource"]> } : { key, kind: "surface", value };
}
const variants = Object.fromEntries(Object.entries(operationAttributes).map(([tag, attributes]) => [tag.toLowerCase(), { tag, attributes: Object.fromEntries(attributes.map(attribute => [attribute.field, attribute.name])) }]));
const stepProperties: Record<string, FieldSchema> = { kind: { type: "string", enum: Object.keys(variants) } };
for (const attributes of Object.values(operationAttributes)) for (const attribute of attributes) stepProperties[attribute.field] = { type: attribute.numeric ? "number" : "string" };
function project(input: CompanionInput): CompanionProjection {
  const result = emptyProjection();
  const owner = input.value.type === imageProgramType ? undefined : parameterOwner(input, "program");
  const program = input.value.type === imageProgramType ? input.value : input.inputs.program?.[0] ?? owner?.value;
  if (!program) throw new DvError("STUDIO_SUPPORT_MISSING", "Image transform requires its actual Program input.");
  validateImageProgram(program.data);
  const ownerKey = owner?.authorKey ?? input.authorKey;
  const laneKey = `${input.authorKey}/image`;
  const source = input.inputs.source?.[0] ?? parameterOwner(input, "source")?.value;
  const materials = source ? [material(`${input.authorKey}/source`, source)] : [];
  if (input.value.type !== imageProgramType) materials.push(material(`${input.authorKey}/result`, input.value));
  return { ...result, lanes: [{ key: laneKey, title: "Image transform", height: 52, order: 0 }], materials, parameterOwners: owner ? [owner] : [],
    entities: [{ editorKey: input.authorKey, authorKey: input.authorKey, title: "Image transform", paintRank: 0, intervals: [], laneKey, pictureParts: [], parameterOwners: owner ? [owner.key] : [], temporal: [], sourceSlice: sourceFor(input), materials: materials.map(m => m.key), facts: { orderedSteps: program.data.orderedSteps as unknown as Json, time: "static", ...(source ? { source: source.data } : {}) } }],
    fieldGroups: [{ key: `${ownerKey}/operations`, ownerKey, domain: "How", pageKey: "Transform", sectionKey: "Operations", fields: [field(input, ownerKey, "$children", { label: "Ordered operations", widget: "list", schemaKey: `${imageProgramType}/orderedSteps`, authorValue: program.data.orderedSteps as unknown as Json, path: ["orderedSteps"], schema: { type: "array", minItems: 1, items: { type: "object", properties: stepProperties, required: ["kind"], additionalProperties: false } }, children: { discriminator: "kind", variants } })] },
      ...program.data.orderedSteps.map((step, index) => {
        const tag = step.kind[0]!.toUpperCase() + step.kind.slice(1);
        const programKey = input.value.type === imageProgramType ? input.outputKey : input.authoring.relations.find(relation => relation.authorKey === ownerKey && relation.role === "parameter" && relation.attribute === "$children")?.bindingKey ?? "";
        const child = authorFor(input, `${programKey}/orderedSteps/${index}`);
        const stepValues = step as unknown as Record<string, Json>;
        return { key: `${ownerKey}/step/${index}`, ownerKey: child?.authorKey ?? ownerKey, domain: (["crop", "resize", "rotate", "flip"].includes(step.kind) ? "Where" : "How") as "Where" | "How", pageKey: "Transform", sectionKey: tag, fields: operationAttributes[tag]!.map(attribute => {
          const value = stepValues[attribute.field] ?? null;
          const choices = attribute.accepts.includes("|") && !attribute.accepts.includes(" ") ? attribute.accepts.split("|") : undefined;
          const control = field(input, child?.authorKey ?? ownerKey, attribute.name, { label: attribute.name, widget: choices ? "select" : attribute.numeric ? "number" : attribute.name === "background" ? "color" : "text", schemaKey: `${imageProgramType}/${step.kind}/${attribute.field}`, authorValue: value, schema: { type: attribute.numeric ? "number" : "string", ...(choices ? { enum: choices.map(choice => attribute.numeric ? Number(choice) : choice) } : {}) }, ...(choices ? { options: choices.map(choice => ({ value: attribute.numeric ? Number(choice) : choice, label: choice })) } : {}) });
          if (!child) { delete control.endpointKey; control.readonly = true; if (control.binding) { control.binding.access = "read"; delete control.binding.endpointKey; } }
          return control;
        }) };
      })] };
}
export const imageTransformCompanions: readonly StudioCompanion[] = [{ protocol: "dsivio-video.studio-companion/1", key: `${moduleId}/image`, moduleId, family: "image-transform", icon: "image", tone: "green", matches: [{ surface: "Transform", output: "image", type: "dsivio-video/media@1#Image" }, { surface: "Program", output: "", type: imageProgramType }], project }];
