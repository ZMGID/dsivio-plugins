import { DvError } from "../../core/errors.ts";
import type { ProducerDef, ProducerInputs } from "../../core/module.ts";
import { isPending } from "../../core/value.ts";
import type { Json, Value } from "../../core/value.ts";
import { RECIPE, validateRecipe } from "../recipe/index.ts";
import { consumedParameters, isScalar, validateTemplate } from "./template.ts";
import type { Block, Choice, Scalar } from "./template.ts";

export const TEXT = "dsivio-video/text@1#Text";
export const TEMPLATE = "dsivio-video/text@1#TextTemplate";
export const BINDINGS = "dsivio-video/text@1#RenderBindings";
export type RenderBindings = { params: Record<string, Scalar>; edits: { name: string; mode: "set" | "append" }[] };

export function validateText(data: Json): void {
  if (typeof data !== "string") throw new DvError("TYPE_INVALID", "Text data must be a string.");
}

export function validateBindings(data: Json): asserts data is RenderBindings {
  if (data === null || typeof data !== "object" || Array.isArray(data)
    || data.params === null || typeof data.params !== "object" || Array.isArray(data.params)
    || !Array.isArray(data.edits) || Object.keys(data).some((key) => key !== "params" && key !== "edits")) {
    throw new DvError("TYPE_INVALID", "Invalid RenderBindings.");
  }
  for (const [name, value] of Object.entries(data.params)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || !isScalar(value)) throw new DvError("TYPE_INVALID", "Render params must be named finite scalars.");
  }
  for (const edit of data.edits) {
    if (edit === null || typeof edit !== "object" || Array.isArray(edit)
      || typeof edit.name !== "string" || !/^[a-z][a-z0-9_-]*$/.test(edit.name) || (edit.mode !== "set" && edit.mode !== "append")
      || Object.keys(edit).some((key) => key !== "name" && key !== "mode")) throw new DvError("TYPE_INVALID", "Render edits must contain a name and set/append mode.");
  }
}

function valueInput(inputs: ProducerInputs, name: string, type: string): Value {
  const value = inputs[name];
  if (value !== undefined && !Array.isArray(value) && isPending(value)) throw new DvError("TEXT_INPUT_PENDING", "Render requires known inputs.");
  if (value === undefined || Array.isArray(value) || !("data" in value) || value.type !== type) throw new DvError("TYPE_INVALID", `Invalid render input '${name}'.`);
  return value;
}

export const render: ProducerDef = {
  inputs: { template: { type: TEMPLATE }, recipe: { type: RECIPE, optional: true }, bindings: { type: BINDINGS }, texts: { type: TEXT, list: true } },
  outputs: { text: TEXT },
  run(inputs) {
    const templateValue = valueInput(inputs, "template", TEMPLATE);
    validateTemplate(templateValue.data);
    const template = templateValue.data;
    const bindingValue = valueInput(inputs, "bindings", BINDINGS);
    validateBindings(bindingValue.data);
    const { params, edits } = bindingValue.data;
    const consumed = consumedParameters(template);
    const bindings: Record<string, Scalar | Scalar[]> = Object.create(null);
    if (inputs.recipe !== undefined) {
      const recipeValue = valueInput(inputs, "recipe", RECIPE);
      validateRecipe(recipeValue.data);
      for (const [name, value] of Object.entries(recipeValue.data.properties)) {
        if (!consumed.has(name)) continue;
        if (!isScalar(value)) throw new DvError("TEXT_RECIPE_VALUE", `Consumed recipe property '${name}' must be a finite scalar.`);
        bindings[name] = value;
      }
    }
    for (const [name, value] of Object.entries(params)) {
      if (!consumed.has(name)) throw new DvError("TEXT_BINDING_UNKNOWN", `Template does not consume parameter '${name}'.`);
      bindings[name] = value;
    }
    const texts = inputs.texts;
    if (!Array.isArray(texts) || texts.length !== edits.length) throw new DvError("TYPE_INVALID", "Render text inputs must match the ordered bindings.");
    for (let index = 0; index < edits.length; index++) {
      const edit = edits[index]!;
      const value = texts[index]!;
      if (isPending(value)) throw new DvError("TEXT_INPUT_PENDING", "Render requires known Text inputs.");
      if (value.type !== TEXT || typeof value.data !== "string") throw new DvError("TYPE_INVALID", "Render Set/Append inputs must be Text.");
      if (!consumed.has(edit.name)) throw new DvError("TEXT_BINDING_UNKNOWN", `Template does not consume binding '${edit.name}'.`);
      const previous = bindings[edit.name];
      if (edit.mode === "set") {
        if (Object.hasOwn(bindings, edit.name)) throw new DvError("TEXT_BINDING_DUPLICATE", `Set cannot replace existing binding '${edit.name}'.`);
        bindings[edit.name] = value.data;
      } else if (Array.isArray(previous)) previous.push(value.data);
      else bindings[edit.name] = previous === undefined ? [value.data] : [previous, value.data];
    }
    // Defaults are applied only after dynamic bindings: a Set may replace a template default.
    for (const [name, value] of Object.entries(template.defaults)) if (!Object.hasOwn(bindings, name)) bindings[name] = value;
    const selections: Record<string, Choice> = Object.create(null);
    const select = (block: Extract<Block, { kind: "axis" | "variant" }>): Choice => {
      const existing = selections[block.name];
      if (existing) return existing;
      let selected: Choice | undefined;
      if (block.kind === "axis") {
        selected = block.choices.find((choice) => choice.name === bindings[block.parameter]);
        if (!selected) throw new DvError("TEXT_AXIS_UNMATCHED", `Axis '${block.name}' has no choice for '${block.parameter}'.`);
      } else {
        const matches = block.choices.filter((choice) => Object.keys(choice.conditions).length > 0 && Object.entries(choice.conditions).every(([key, value]) => {
          if (key.startsWith("when-param-")) return bindings[key.slice(11)] === value;
          const dependency = template.blocks.find((item) => item.name === key.slice(12));
          if (!dependency || (dependency.kind !== "axis" && dependency.kind !== "variant")) throw new DvError("TYPE_INVALID", "Invalid selection dependency.");
          return select(dependency).name === value;
        }));
        if (matches.length > 1) throw new DvError("TEXT_VARIANT_AMBIGUOUS", `Variant '${block.name}' matches multiple choices.`);
        selected = matches[0] ?? block.choices.find((choice) => choice.name === "default" && Object.keys(choice.conditions).length === 0);
        if (!selected) throw new DvError("TEXT_VARIANT_UNMATCHED", `Variant '${block.name}' has no matching choice or default.`);
      }
      selections[block.name] = selected;
      return selected;
    };
    const paragraphs: string[] = [];
    for (const block of template.blocks) {
      let text: string;
      if (block.kind === "fixed") text = block.text;
      else if (block.kind === "axis" || block.kind === "variant") text = select(block).text;
      else {
        const value = bindings[block.slot];
        if (value === undefined) {
          if (block.optional) continue;
          throw new DvError("TEXT_SLOT_MISSING", `Required slot '${block.slot}' has no binding.`);
        }
        if (Array.isArray(value)) throw new DvError("TEXT_SLOT_LIST", `Scalar slot '${block.slot}' cannot consume a list.`);
        text = String(value);
        if (text && block.label) text = `${block.label}\n${text}`;
      }
      if (text !== "") paragraphs.push(text);
    }
    return { outputs: { text: { type: TEXT, data: paragraphs.join("\n\n") } } };
  },
};
