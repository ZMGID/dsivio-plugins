import { createHash } from "node:crypto";
import { relative } from "node:path";
import { DvError, spanAt } from "../core/errors.ts";
import type { SourceSpan } from "../core/errors.ts";
import type { AuthoringElement, AuthoringIndex, AuthoringRegistration, AuthoringRelation, AuthoringUnit } from "../core/authoring.ts";
import type { Binding } from "../core/module.ts";
import type { DvsSheet, ElementNode, MarkupDocument, RawElement } from "../markup/ast.ts";

export function sourceVersion(text: string): string { return createHash("sha256").update(text).digest("hex"); }
export function sourceUnit(file: string): string { return createHash("sha256").update(file).digest("hex").slice(0, 16); }
export class SourceIndexBuilder {
  readonly units = new Map<string, AuthoringUnit>();
  readonly elements = new Map<string, AuthoringElement>();
  readonly relations: AuthoringRelation[] = [];
  readonly inputs: AuthoringIndex["inputs"][number][] = [];
  readonly references: AuthoringIndex["references"][number][] = [];
  readonly root: string;
  constructor(root: string) { this.root = root; }
  addUnit(file: string, text: string, language: AuthoringUnit["language"]): AuthoringUnit {
    const unit: AuthoringUnit = { unit: sourceUnit(file), file, fileName: relative(this.root, file).replaceAll("\\", "/"), language, sourceVersion: sourceVersion(text), text };
    this.units.set(unit.unit, unit);
    return unit;
  }
  addMarkup(document: MarkupDocument, surfaceModules?: ReadonlyMap<string, string>): void {
    const unit = this.units.get(sourceUnit(document.file));
    if (!unit) throw new DvError("AUTHORING_UNIT", "Source unit must be registered before its syntax.");
    const modules = new Map(document.imports.filter(d => d.from).map(d => [d.as ?? "", d.from!]));
    const visit = (node: ElementNode | RawElement, path: string, parentIdentity?: string): void => {
      const id = node.attributes.find(a => a.name === "id")?.value;
      const identity = id?.kind === "literal" ? parentIdentity ? `${parentIdentity}/${id.text}` : id.text : path;
      let authorKey = `${unit.fileName}#${identity}`;
      // Invalid duplicate declarations still reach the owning module's original diagnostic.
      if (this.elements.has(authorKey)) authorKey = `${authorKey}@${path}`;
      const prefix = node.tag.includes(":") ? node.tag.slice(0, node.tag.indexOf(":")) : "";
      const openEnd = node.openingTag?.end ?? node.attributes.at(-1)?.span.end ?? node.span.start;
      const openingTag = node.openingTag ?? spanAt(unit.file, unit.text, node.span.start, openEnd);
      const insertion = node.insertion ?? spanAt(unit.file, unit.text, openingTag.end - (node.kind === "element" && node.selfClosing ? 2 : 1));
      const entry: AuthoringElement = { authorKey, sourceUnit: unit.unit, moduleId: surfaceModules?.get(node.tag) ?? modules.get(prefix) ?? "", surface: node.tag, declarationPath: path, elementSpan: node.span, openingTag, insertion, ...(node.closingTag ? { closingTag: node.closingTag } : {}), attributes: node.attributes.map(attribute => ({ name: attribute.name, attribute, nameSpan: attribute.nameSpan ?? spanAt(unit.file, unit.text, attribute.span.start, attribute.span.start + attribute.name.length), valueSpan: attribute.value.span, fullSpan: attribute.span, expectedText: unit.text.slice(attribute.value.span.start, attribute.value.span.end) })), ...(node.kind === "raw" ? { rawBody: node.bodySpan } : {}) };
      if (node.kind === "element" && node.closingTag) {
        entry.contentBody = spanAt(unit.file, unit.text, openingTag.end, node.closingTag.start);
        entry.pureText = node.children.every(child => child.kind === "text");
      }
      this.elements.set(authorKey, entry);
      if (node.kind === "element") node.children.filter(child => child.kind !== "text").forEach((child, index) => visit(child, `${identity}/${child.tag}[${index}]`, identity));
    };
    document.body.forEach((node, index) => visit(node, `${node.tag}[${index}]`));
  }
  addSheet(sheet: DvsSheet): void {
    const unit = this.units.get(sourceUnit(sheet.file));
    if (!unit) throw new DvError("AUTHORING_UNIT", "Source unit must be registered before its syntax.");
    for (const rule of sheet.rules) {
      const authorKey = `${unit.fileName}#${rule.name}`;
      const insertion = rule.insertion ?? spanAt(unit.file, unit.text, rule.span.end - 1);
      this.elements.set(authorKey, { authorKey, sourceUnit: unit.unit, moduleId: sheet.using, surface: "Recipe", declarationPath: rule.name, elementSpan: rule.span, openingTag: rule.nameSpan ?? rule.span, insertion, attributes: [], recipe: { name: rule.name, properties: rule.properties.map(p => ({ name: p.name, value: p.value, nameSpan: p.nameSpan ?? p.span, valueSpan: p.valueSpan ?? p.span, fullSpan: p.fullSpan ?? p.span, deleteSpan: p.deleteSpan ?? p.span })) } });
    }
  }
  owner(span: SourceSpan): AuthoringElement | undefined {
    let owner: AuthoringElement | undefined;
    for (const element of this.elements.values()) {
      if (element.elementSpan.file !== span.file || element.elementSpan.start > span.start || element.elementSpan.end < span.end) continue;
      if (!owner || element.elementSpan.end - element.elementSpan.start < owner.elementSpan.end - owner.elementSpan.start) owner = element;
    }
    return owner;
  }
  bind(binding: Binding, span: SourceSpan, role: AuthoringRegistration["role"] = "output", surfaceOutput?: string): void {
    const owner = this.owner(span);
    if (owner) this.relations.push({ bindingKey: binding.key, authorKey: owner.authorKey, role, ...(surfaceOutput !== undefined ? { surfaceOutput } : {}) });
  }
  register(registration: AuthoringRegistration): void {
    const owner = this.owner(registration.element.span);
    if (!owner || owner.elementSpan.start !== registration.element.span.start) throw new DvError("AUTHORING_OWNER", "Registration requires an exact loaded author element.", { span: registration.element.span });
    this.relations.push({ bindingKey: registration.binding.key, authorKey: owner.authorKey, role: registration.role, ...(registration.identity ? { identity: registration.identity } : {}), ...(registration.consumer ? { consumer: registration.consumer } : {}), ...(registration.attribute ? { attribute: registration.attribute } : {}) });
  }
  snapshot(): AuthoringIndex { return { units: this.units, elements: this.elements, relations: this.relations, inputs: this.inputs, references: this.references }; }
}
