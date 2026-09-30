import { DvError } from "../../core/errors.ts";
import type { SourceSpan } from "../../core/errors.ts";
import type { DvsRule, DvsSheet } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";

export type Scalar = string | number | boolean;
export type Choice = { name: string; text: string; conditions: Record<string, Scalar> };
export type Block =
  | { name: string; order: number; kind: "fixed"; text: string }
  | { name: string; order: number; kind: "axis"; parameter: string; choices: Choice[] }
  | { name: string; order: number; kind: "variant"; choices: Choice[] }
  | { name: string; order: number; kind: "slot"; slot: string; optional: boolean; label: string };
export type TextTemplate = { name: string; separator: "paragraph"; defaults: Record<string, Scalar>; blocks: Block[] };

export function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

export function consumedParameters(template: TextTemplate): Set<string> {
  const names = new Set<string>();
  for (const block of template.blocks) {
    if (block.kind === "slot") names.add(block.slot);
    if (block.kind === "axis") names.add(block.parameter);
    if (block.kind === "variant") for (const choice of block.choices) {
      for (const key of Object.keys(choice.conditions)) if (key.startsWith("when-param-")) names.add(key.slice(11));
    }
  }
  return names;
}

function invalid(message: string, span?: SourceSpan): never {
  throw new DvError("TEXT_TEMPLATE", message, { span });
}

function properties(rule: DvsRule): Record<string, Json> {
  const result: Record<string, Json> = Object.create(null);
  for (const property of rule.properties) {
    if (Object.hasOwn(result, property.name)) invalid(`Duplicate property '${property.name}'.`, property.span);
    result[property.name] = property.value;
  }
  return result;
}

function allow(props: Record<string, Json>, names: readonly string[], span: SourceSpan): void {
  for (const key of Object.keys(props)) if (!names.includes(key)) invalid(`Unknown template property '${key}'.`, span);
}

function nonempty(value: Json | undefined, name: string, span: SourceSpan): string {
  if (typeof value !== "string" || value.trim() === "") invalid(`'${name}' must be a nonempty string.`, span);
  return value;
}

export function compileTemplate(sheet: DvsSheet): TextTemplate {
  const roots = sheet.rules.filter((rule) => /^text-template\.[^.]+$/.test(rule.name));
  if (roots.length !== 1) invalid("A template sheet must have exactly one text-template.<name> root.", sheet.rules[0]?.span);
  const root = roots[0]!;
  const name = root.name.slice(14);
  if (!/^[a-z][a-z0-9-]{0,95}$/.test(name)) invalid("Invalid template name.", root.span);
  const rootProps = properties(root);
  const defaults: Record<string, Scalar> = Object.create(null);
  for (const [key, value] of Object.entries(rootProps)) {
    if (key === "separator") {
      if (value !== "paragraph") invalid("Only separator: paragraph is supported.", root.span);
    } else if (key.startsWith("default-") && /^[a-z][a-z0-9-]*$/.test(key.slice(8)) && isScalar(value)) defaults[key.slice(8)] = value;
    else invalid(`Invalid root property '${key}'.`, root.span);
  }
  const blocks: Block[] = [];
  const blockNames = new Set<string>();
  const orders = new Set<number>();
  const choiceRules: DvsRule[] = [];
  for (const rule of sheet.rules) {
    if (rule === root) continue;
    const prefix = `${root.name}.`;
    if (!rule.name.startsWith(prefix)) invalid(`Rule '${rule.name}' is outside this template.`, rule.span);
    const path = rule.name.slice(prefix.length).split(".");
    if (path[0] === "choice" && path.length === 3 && path[1] && path[2]) { choiceRules.push(rule); continue; }
    if (path[0] !== "block" || path.length !== 2 || !path[1]) invalid(`Unrecognized template path '${rule.name}'.`, rule.span);
    const blockName = path[1];
    if (blockNames.has(blockName)) invalid(`Duplicate block '${blockName}'.`, rule.span);
    blockNames.add(blockName);
    const props = properties(rule);
    const order = props.order;
    if (typeof order !== "number" || !Number.isSafeInteger(order) || order < 0 || orders.has(order)) invalid("Block order must be a unique nonnegative safe integer.", rule.span);
    orders.add(order);
    const base = { name: blockName, order };
    switch (props.kind) {
      case "fixed":
        allow(props, ["kind", "order", "text"], rule.span);
        blocks.push({ ...base, kind: "fixed", text: nonempty(props.text, "text", rule.span) });
        break;
      case "axis":
        allow(props, ["kind", "order", "parameter"], rule.span);
        blocks.push({ ...base, kind: "axis", parameter: nonempty(props.parameter, "parameter", rule.span), choices: [] });
        break;
      case "variant":
        allow(props, ["kind", "order"], rule.span);
        blocks.push({ ...base, kind: "variant", choices: [] });
        break;
      case "slot":
        allow(props, ["kind", "order", "slot", "optional", "label"], rule.span);
        if (props.optional !== undefined && typeof props.optional !== "boolean") invalid("Slot optional must be boolean.", rule.span);
        blocks.push({ ...base, kind: "slot", slot: nonempty(props.slot, "slot", rule.span), optional: props.optional === true, label: props.label === undefined ? "" : nonempty(props.label, "label", rule.span) });
        break;
      default: invalid("Block kind must be fixed, axis, variant or slot.", rule.span);
    }
  }
  for (const rule of choiceRules) {
    const path = rule.name.slice(root.name.length + 1).split(".");
    const block = blocks.find((item) => item.name === path[1]);
    if (!block || (block.kind !== "axis" && block.kind !== "variant")) invalid(`Choice refers to a missing or non-choice block '${path[1]}'.`, rule.span);
    const choiceName = path[2]!;
    if (block.choices.some((choice) => choice.name === choiceName)) invalid(`Duplicate choice '${choiceName}'.`, rule.span);
    const props = properties(rule);
    const text = nonempty(props.text, "text", rule.span);
    const conditions: Record<string, Scalar> = Object.create(null);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") continue;
      if (block.kind !== "variant" || !/^(when-param|when-select)-[a-z][a-z0-9_-]*$/.test(key) || !isScalar(value)) invalid(`Invalid choice condition '${key}'.`, rule.span);
      conditions[key] = value;
    }
    if (block.kind === "variant" && Object.keys(conditions).length === 0 && choiceName !== "default") invalid("Variant choices require conditions; only 'default' may be unconditional.", rule.span);
    block.choices.push({ name: choiceName, text, conditions });
  }
  blocks.sort((a, b) => a.order - b.order);
  const template: TextTemplate = { name, separator: "paragraph", defaults, blocks };
  checkTemplate(template, root.span);
  return template;
}

function checkTemplate(template: TextTemplate, span?: SourceSpan): void {
  const names = consumedParameters(template);
  for (const key of Object.keys(template.defaults)) if (!names.has(key)) invalid(`Default '${key}' is not consumed by this template.`, span);
  const checked = new Set<string>();
  const visiting = new Set<string>();
  const visit = (block: Block): void => {
    if (checked.has(block.name)) return;
    if (visiting.has(block.name)) invalid(`Cyclic selection condition involving '${block.name}'.`, span);
    visiting.add(block.name);
    if (block.kind === "axis" || block.kind === "variant") {
      if (!block.choices.length) invalid(`Block '${block.name}' requires choices.`, span);
      for (const choice of block.choices) for (const [key, value] of Object.entries(choice.conditions)) {
        if (!key.startsWith("when-select-")) continue;
        const dependency = template.blocks.find((item) => item.name === key.slice(12));
        if (!dependency || (dependency.kind !== "axis" && dependency.kind !== "variant")) invalid(`Condition '${key}' refers to a missing selection block.`, span);
        if (typeof value !== "string" || !dependency.choices.some((item) => item.name === value)) invalid(`Condition '${key}' refers to an unknown choice.`, span);
        visit(dependency);
      }
    }
    visiting.delete(block.name);
    checked.add(block.name);
  };
  template.blocks.forEach(visit);
}

export function validateTemplate(data: Json): asserts data is TextTemplate {
  const bad: () => never = () => { throw new DvError("TYPE_INVALID", "Invalid compiled TextTemplate."); };
  if (data === null || typeof data !== "object" || Array.isArray(data)
    || typeof data.name !== "string" || !/^[a-z][a-z0-9-]{0,95}$/.test(data.name) || data.separator !== "paragraph"
    || data.defaults === null || typeof data.defaults !== "object" || Array.isArray(data.defaults) || !Array.isArray(data.blocks)
    || Object.keys(data).some((key) => !["name", "separator", "defaults", "blocks"].includes(key))) bad();
  for (const [name, value] of Object.entries(data.defaults)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || !isScalar(value)) bad();
  }
  const names = new Set<string>();
  let previousOrder = -1;
  for (const block of data.blocks) {
    if (block === null || typeof block !== "object" || Array.isArray(block)
      || typeof block.name !== "string" || !/^[a-z][a-z0-9_-]*$/.test(block.name)
      || names.has(block.name) || typeof block.order !== "number"
      || !Number.isSafeInteger(block.order) || block.order <= previousOrder) bad();
    names.add(block.name);
    previousOrder = block.order;
    let keys: readonly string[];
    if (block.kind === "fixed") {
      keys = ["name", "order", "kind", "text"];
      if (typeof block.text !== "string" || block.text.trim() === "") bad();
    } else if (block.kind === "slot") {
      keys = ["name", "order", "kind", "slot", "optional", "label"];
      if (typeof block.slot !== "string" || block.slot.trim() === ""
        || typeof block.optional !== "boolean" || typeof block.label !== "string"
        || (block.label !== "" && block.label.trim() === "")) bad();
    } else if (block.kind === "axis" || block.kind === "variant") {
      keys = block.kind === "axis" ? ["name", "order", "kind", "parameter", "choices"] : ["name", "order", "kind", "choices"];
      if (block.kind === "axis" && (typeof block.parameter !== "string" || block.parameter.trim() === "")) bad();
      if (!Array.isArray(block.choices)) bad();
      const choiceNames = new Set<string>();
      for (const choice of block.choices) {
        if (choice === null || typeof choice !== "object" || Array.isArray(choice)
          || typeof choice.name !== "string" || !/^[a-z][a-z0-9_-]*$/.test(choice.name) || choiceNames.has(choice.name)
          || typeof choice.text !== "string" || choice.text.trim() === ""
          || choice.conditions === null || typeof choice.conditions !== "object" || Array.isArray(choice.conditions)
          || Object.keys(choice).some((key) => !["name", "text", "conditions"].includes(key))) bad();
        choiceNames.add(choice.name);
        const conditions = Object.entries(choice.conditions);
        if (block.kind === "axis" && conditions.length !== 0) bad();
        if (block.kind === "variant" && conditions.length === 0 && choice.name !== "default") bad();
        for (const [key, value] of conditions) {
          if (!/^(when-param|when-select)-[a-z][a-z0-9_-]*$/.test(key) || !isScalar(value)) bad();
        }
      }
    } else bad();
    if (Object.keys(block).some((key) => !keys.includes(key))) bad();
  }
  try { checkTemplate(data as TextTemplate); }
  catch (error) { if (error instanceof DvError) bad(); throw error; }
}
