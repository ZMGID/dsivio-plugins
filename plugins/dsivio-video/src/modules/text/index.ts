import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, ModuleDef, SurfaceDef } from "../../core/module.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import { RECIPE } from "../recipe/index.ts";
import { BINDINGS, render, TEMPLATE, TEXT, validateBindings, validateText } from "./render.ts";
import type { RenderBindings } from "./render.ts";
import { compileTemplate, validateTemplate } from "./template.ts";

export { BINDINGS, render, TEMPLATE, TEXT } from "./render.ts";
export { compileTemplate } from "./template.ts";
export type { RenderBindings } from "./render.ts";
export type { TextTemplate } from "./template.ts";

export function normalizeText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[\t ]+$/g, ""));
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines.at(-1)!.trim() === "") lines.pop();
  const indents = lines.filter((line) => line.trim() !== "").map((line) => /^[\t ]*/.exec(line)![0].length);
  const indent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indent)).join("\n");
}

function structured(element: ElementNode | RawElement, ctx: ElaborationContext, allowed: readonly string[]): { element: ElementNode; attrs: Record<string, Attribute> } {
  if (element.kind !== "element") ctx.fail("TEXT_CHILD", "Text surfaces require structured markup.", element.span);
  const attrs: Record<string, Attribute> = Object.create(null);
  for (const attr of element.attributes) {
    if (!allowed.includes(attr.name) || Object.hasOwn(attrs, attr.name)) ctx.fail("TEXT_ATTRIBUTE", `Unexpected or duplicate attribute '${attr.name}'.`, attr.span);
    attrs[attr.name] = attr;
  }
  return { element, attrs };
}

function literal(attrs: Record<string, Attribute>, name: string, element: ElementNode, ctx: ElaborationContext): string {
  const attr = attrs[name];
  if (!attr || attr.value.kind !== "literal" || attr.value.text.trim() === "") ctx.fail("TEXT_ATTRIBUTE", `'${name}' requires a nonempty literal.`, attr?.span ?? element.span);
  return attr.value.text;
}

function reference(attrs: Record<string, Attribute>, name: string, type: string, element: ElementNode, ctx: ElaborationContext): Binding {
  const attr = attrs[name];
  if (!attr || attr.value.kind !== "ref") ctx.fail("TEXT_REFERENCE", `'${name}' requires a typed reference.`, attr?.span ?? element.span);
  const binding = ctx.lookup(attr.value.name, attr.value.span);
  if (binding.type !== type) ctx.fail("TEXT_REFERENCE", `'${name}' requires ${type}.`, attr.span);
  return binding;
}

const value: SurfaceDef = {
  mode: "structured",
  doc: {
    summary: "Publishes literal Text: CRLF becomes LF, blank edge lines and trailing horizontal whitespace are removed, and nonempty lines are dedented by their minimum indentation. Internal newlines are preserved.",
    attributes: [{ name: "id", required: true, accepts: "text", summary: "Public Text name; surrounding whitespace is trimmed." }],
    outputs: [{ name: "", type: TEXT, summary: "Normalized literal Text." }],
    example: '<text:Value id="direction">Backlit perfume on a misty morning windowsill.</text:Value>',
  },
  elaborate(node, ctx: ElaborationContext) {
    const { element, attrs } = structured(node, ctx, ["id"]);
    const id = literal(attrs, "id", element, ctx).trim();
    let body = "";
    for (const child of element.children) {
      if (child.kind !== "text") ctx.fail("TEXT_CHILD", "Value accepts only text children.", child.span);
      body += child.text;
    }
    ctx.record(id, { type: TEXT, data: normalizeText(body) }, element.span);
  },
};

const renderSurface: SurfaceDef = {
  mode: "structured",
  doc: {
    summary: "Renders one template into Text with defaults < consumed Recipe scalars < Param, then ordered Set/Append. Set never replaces recipe/Param/earlier dynamic bindings, but may replace a template default. Append forms a list, which scalar slots reject. Missing slots and unmatched/ambiguous choices fail. Inputs must be known for plan preview; otherwise the prompt waits. Template sheets use fixed/axis/variant/slot blocks and paragraph separators; variant choice 'default' without conditions is the fallback, other variant choices need when-param-* or when-select-* conditions.",
    attributes: [
      { name: "id", required: true, accepts: "text", summary: "Public output Text name; surrounding whitespace is trimmed." },
      { name: "template", required: true, accepts: TEMPLATE, summary: "Compiled TextTemplate reference." },
      { name: "recipe", required: false, accepts: RECIPE, summary: "Static author Recipe reference; template must also be static. Only consumed scalar properties are used." },
    ],
    children: [
      { tag: "Param", summary: "Unique static scalar binding; type defaults to text.", repeat: true },
      { tag: "Set", summary: "Ordered Text binding; fails when the binding already exists, except a template default.", repeat: true },
      { tag: "Append", summary: "Ordered Text append; starts a list or converts an existing scalar to a list.", repeat: true },
    ],
    outputs: [{ name: "", type: TEXT, summary: "Rendered Text." }],
    example: '<text:Render id="prompt" template={kit.hero}><text:Set name="direction" text={direction}/><text:Param name="camera" value="slow push-in"/></text:Render>',
  },
  elaborate(node, ctx: ElaborationContext) {
    const { element, attrs } = structured(node, ctx, ["id", "template", "recipe"]);
    const id = literal(attrs, "id", element, ctx).trim();
    const template = reference(attrs, "template", TEMPLATE, element, ctx);
    const recipe = attrs.recipe ? reference(attrs, "recipe", RECIPE, element, ctx) : undefined;
    if (recipe && (recipe.kind !== "record" || template.kind !== "record")) ctx.fail("TEXT_RECIPE_STATIC", "Recipe and template must both be static author values when recipe is supplied.", element.span);
    const data: RenderBindings = { params: Object.create(null), edits: [] };
    const texts: Binding[] = [];
    const colon = element.tag.lastIndexOf(":");
    const prefix = colon === -1 ? "" : element.tag.slice(0, colon + 1);
    for (const child of element.children) {
      if (child.kind === "text" && child.text.trim() === "") continue;
      if (child.kind !== "element" || ![`${prefix}Param`, `${prefix}Set`, `${prefix}Append`].includes(child.tag)) ctx.fail("TEXT_CHILD", "Render accepts only Param, Set and Append children from the same text namespace.", child.span);
      const mode = child.tag.slice(prefix.length);
      const { attrs: childAttrs } = structured(child, ctx, mode === "Param" ? ["name", "value", "type"] : ["name", "text"]);
      if (child.children.some((item) => item.kind !== "text" || item.text.trim() !== "")) ctx.fail("TEXT_CHILD", `${mode} must have no body.`, child.span);
      const name = literal(childAttrs, "name", child, ctx);
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) ctx.fail("TEXT_ATTRIBUTE", "Binding names must start with a lowercase letter and contain only letters, digits, underscores or hyphens.", child.span);
      if (mode === "Param") {
        if (Object.hasOwn(data.params, name)) ctx.fail("TEXT_DUPLICATE_PARAM", `Duplicate Param '${name}'.`, child.span);
        const attr = childAttrs.value;
        if (!attr || attr.value.kind !== "literal") ctx.fail("TEXT_PARAM", "Param value must be a literal.", attr?.span ?? child.span);
        const source = attr.value.text;
        const type = childAttrs.type ? literal(childAttrs, "type", child, ctx) : "text";
        if (type === "text") data.params[name] = source;
        else if (type === "number") {
          const number = Number(source);
          if (source.trim() === "" || !Number.isFinite(number)) ctx.fail("TEXT_PARAM", "Number Param must be finite.", attr.span);
          data.params[name] = number;
        } else if (type === "boolean") {
          if (source !== "true" && source !== "false") ctx.fail("TEXT_PARAM", "Boolean Param must be true or false.", attr.span);
          data.params[name] = source === "true";
        } else ctx.fail("TEXT_PARAM", "Param type must be text, number or boolean.", child.span);
      } else {
        data.edits.push({ name, mode: mode === "Set" ? "set" : "append" });
        texts.push(reference(childAttrs, "text", TEXT, child, ctx));
      }
    }
    const bindings = ctx.record(null, { type: BINDINGS, data }, element.span);
    ctx.operation({ producer: "dsivio-video/text@1#render", inputs: { template, ...(recipe ? { recipe } : {}), bindings, texts }, publish: { text: id }, label: id, span: element.span });
  },
};

const childSurfaces: Record<string, SurfaceDef> = {};
for (const tag of ["Param", "Set", "Append"]) {
  childSurfaces[tag] = {
    mode: "structured",
    doc: {
      summary: tag === "Param" ? "Render-only static scalar parameter; duplicates fail. Params override consumed recipe scalars and defaults." : `Render-only ordered Text ${tag === "Set" ? "binding (cannot replace an existing binding)" : "append (produces a list)"}.`,
      attributes: tag === "Param" ? [
        { name: "name", required: true, accepts: "text", summary: "Consumed template binding name." },
        { name: "value", required: true, accepts: "text", summary: "Literal value converted according to type." },
        { name: "type", required: false, accepts: "one of text|number|boolean", default: "text", summary: "number must be finite; boolean accepts only true or false." },
      ] : [
        { name: "name", required: true, accepts: "text", summary: "Consumed template binding name." },
        { name: "text", required: true, accepts: TEXT, summary: "Static Text or another operation's Text output; tracked as its own graph input." },
      ],
      outputs: [],
      example: tag === "Param" ? '<text:Param name="camera" value="slow push-in"/>' : `<text:${tag} name="direction" text={direction}/>`,
    },
    elaborate(element, ctx) { ctx.fail("TEXT_CHILD", `${tag} is only valid inside text:Render.`, element.span); },
  };
}

const text: ModuleDef = {
  id: "dsivio-video/text@1",
  summary: "Literal Text and deterministic template rendering with explicit graph inputs.",
  types: {
    Text: { summary: "A string.", validate: validateText },
    TextTemplate: { summary: "Compiled paragraph template with fixed, axis, variant and scalar slot blocks.", validate: validateTemplate },
    RenderBindings: { summary: "Private static Params and source-ordered Set/Append names and modes.", validate: validateBindings },
  },
  surfaces: { Value: value, Render: renderSurface, ...childSurfaces },
  producers: { render },
  frontends: {
    "dsivio-video/text/dvs@1": {
      summary: "Publishes one TextTemplate from exactly one text-template.<name> root. Blocks are fixed/axis/variant/slot in unique order, separated by paragraphs. Variant choice 'default' without when-* conditions is the fallback; other choices need conditions. when-select-* names an axis or variant block and a choice from it.",
      compile(sheet, ctx) {
        try {
          const template = compileTemplate(sheet);
          ctx.record(template.name, { type: TEMPLATE, data: template }, sheet.rules.find((rule) => rule.name === `text-template.${template.name}`)!.span);
        } catch (error) {
          if (error instanceof DvError) ctx.fail(error.code, error.message, error.span ?? sheet.rules[0]?.span ?? { file: sheet.file, start: 0, end: 0, line: 1, column: 1 });
          throw error;
        }
      },
    },
  },
};

export default text;
