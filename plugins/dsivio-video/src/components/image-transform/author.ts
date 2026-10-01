import { DvError } from "../../core/errors.ts";
import type { ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import { structured, literal, reference, empty } from "../sound/author.ts";
import { validateImageProgram } from "./validate.ts";
import { imageProgramType } from "./types.ts";
export interface OperationAttribute { name: string; field: string; accepts: string; required?: boolean; default?: string | number; numeric?: boolean }
export const operationAttributes: Record<string, OperationAttribute[]> = {
  Crop: [
    { name: "unit", field: "unit", accepts: "fraction|pixel", default: "fraction" },
    ...["x", "y", "width", "height"].map(name => ({ name, field: name, required: true, numeric: true, accepts: name === "x" || name === "y" ? "fraction 0..1 or nonnegative pixel integer" : "fraction >0..1 or pixel integer 1..65535" })),
  ],
  Resize: [
    ...["width", "height"].map(name => ({ name, field: name, required: true, numeric: true, accepts: "integer 1..16384" })),
    { name: "fit", field: "fit", accepts: "contain|cover|stretch", default: "contain" },
    { name: "interpolation", field: "interpolation", accepts: "nearest|linear|cubic|area|lanczos", default: "lanczos" },
    { name: "background", field: "background", accepts: "#RRGGBB or #RRGGBBAA" },
  ],
  Rotate: [{ name: "degrees", field: "degrees", numeric: true, required: true, accepts: "90|180|270" }],
  Flip: [{ name: "axis", field: "axis", accepts: "horizontal|vertical|both", default: "horizontal" }],
  Denoise: [
    { name: "method", field: "method", accepts: "nlm-ycrcb", default: "nlm-ycrcb" },
    { name: "luma", field: "luma", numeric: true, accepts: "0..50", default: 2 },
    { name: "chroma", field: "chroma", numeric: true, accepts: "0..50", default: 10 },
    { name: "template-window", field: "templateWindow", numeric: true, accepts: "odd integer 1..31", default: 7 },
    { name: "search-window", field: "searchWindow", numeric: true, accepts: "odd integer 1..63, greater than template", default: 21 },
    { name: "saturation-recovery", field: "saturationRecovery", numeric: true, accepts: "0..4", default: 1.02 },
  ],
  Color: [
    { name: "exposure-stops", field: "exposureStops", numeric: true, accepts: "-8..8", default: 0 },
    ...["contrast", "saturation"].map(name => ({ name, field: name, numeric: true, accepts: "0..4", default: 1 })),
    ...["temperature", "tint"].map(name => ({ name, field: name, numeric: true, accepts: "-1..1", default: 0 })),
    { name: "gamma", field: "gamma", numeric: true, accepts: "0.1..10", default: 1 },
  ],
  Sharpen: [
    { name: "amount", field: "amount", numeric: true, accepts: "0..5", default: 0.5 },
    { name: "radius", field: "radius", numeric: true, accepts: "0.1..20", default: 1 },
    { name: "threshold", field: "threshold", numeric: true, accepts: "0..255", default: 0 },
  ],
  Blur: [{ name: "sigma", field: "sigma", numeric: true, required: true, accepts: "0.1..100" }],
  Alpha: [
    { name: "mode", field: "mode", accepts: "preserve|flatten", default: "preserve" },
    { name: "background", field: "background", accepts: "#RRGGBB or #RRGGBBAA; required for flatten, forbidden for preserve" },
  ],
  Encode: [
    { name: "format", field: "format", accepts: "png|jpeg|webp", default: "png" },
    { name: "quality", field: "quality", numeric: true, accepts: "integer 1..100; forbidden for PNG; JPEG/WebP executor default 95" },
    { name: "background", field: "background", accepts: "#RRGGBB or #RRGGBBAA; JPEG only, required when input has alpha" },
  ],
};
export function decodeImageProgram(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id"]);
  const id = literal(attrs, "id", element, ctx);
  const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
  const orderedSteps: Json[] = [];
  for (const child of element.children) {
    if (child.kind === "text" && !child.text.trim()) continue;
    if (child.kind !== "element" || !child.tag.startsWith(prefix)) ctx.fail("RASTER_CHILD", "Program accepts only operation elements from its namespace.", child.span);
    const tag = child.tag.slice(prefix.length);
    if (!Object.hasOwn(operationAttributes, tag)) ctx.fail("RASTER_CHILD", `Unknown operation '${child.tag}'.`, child.span);
    const specs = operationAttributes[tag]!;
    const decoded = structured(child, ctx, specs.map(spec => spec.name)); empty(child, ctx);
    const step: Record<string, Json> = { kind: tag.toLowerCase() };
    for (const spec of specs) {
      if (decoded.attrs[spec.name] || spec.required) { const raw = literal(decoded.attrs, spec.name, child, ctx); step[spec.field] = spec.numeric ? Number(raw) : raw; }
      else if (spec.default !== undefined) step[spec.field] = spec.default;
    }
    orderedSteps.push(step);
  }
  const program = { orderedSteps };
  try { validateImageProgram(program); }
  catch (error) { if (error instanceof DvError) ctx.fail(error.code, error.message, element.span); throw error; }
  ctx.record(id, { type: imageProgramType, data: program as unknown as Json }, element.span);
}
export function decodeImageTransform(node: ElementNode | RawElement, ctx: ElaborationContext): void {
  const { element, attrs } = structured(node, ctx, ["id", "source", "program"]); empty(element, ctx);
  const id = literal(attrs, "id", element, ctx);
  const source = reference(attrs, "source", ["dsivio-video/media@1#Image"], element, ctx);
  const program = reference(attrs, "program", [imageProgramType], element, ctx);
  ctx.operation({ producer: "dsivio-video/image-transform@1#transform", inputs: { source, program }, publish: { image: `${id}.image` }, label: id, span: element.span });
}
