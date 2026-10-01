import { DvError } from "../core/errors.ts";
import type { Attribute, ElementNode, RawElement } from "../markup/ast.ts";
import type { Binding, ElaborationContext } from "../core/module.ts";
import type { AnchorName, Canvas, Frame, Length, Rect } from "./types.ts";
import { validateRect } from "./math.ts";
export function attributes(element: ElementNode | RawElement, allowed: string[], ctx: ElaborationContext): Record<string, Attribute> {
  const result: Record<string, Attribute> = {};
  for (const a of element.attributes) { if (!allowed.includes(a.name) || result[a.name]) return ctx.fail("MARKUP_ATTRIBUTE", `Unexpected or duplicate attribute ${a.name}`, a.span); result[a.name] = a; }
  return result;
}
export function literal(attr: Attribute | undefined, name: string, ctx: ElaborationContext, element: ElementNode | RawElement, fallback?: string): string {
  if (!attr) { if (fallback !== undefined) return fallback; return ctx.fail("MARKUP_ATTRIBUTE", `${name} is required`, element.span); }
  if (attr.value.kind !== "literal" || !attr.value.text.trim()) return ctx.fail("MARKUP_ATTRIBUTE", `${name} must be literal text`, attr.span);
  return attr.value.text;
}
export function reference(attr: Attribute | undefined, types: string[], ctx: ElaborationContext, element: ElementNode | RawElement): Binding {
  if (!attr || attr.value.kind !== "ref") return ctx.fail("MARKUP_REFERENCE", "Expected a whole value reference", attr?.span ?? element.span);
  const b = ctx.lookup(attr.value.name, attr.span); if (!types.includes(b.type)) return ctx.fail("TYPE_INVALID", `Expected ${types.join(" or ")}, received ${b.type}`, attr.span); return b;
}
export function empty(element: ElementNode | RawElement, ctx: ElaborationContext): void {
  if (element.kind !== "element" || element.children.some(c => c.kind !== "text" || c.text.trim())) return ctx.fail("MARKUP_CHILD", `${element.tag} must be empty`, element.span);
}
export function parseNumber(text: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) throw new DvError("SPACE_NUMBER", "Expected a finite decimal number"); return Number(text);
}
export function parseAspect(text:string):number {
 const parts=text.split("/");
 if(parts.length>2)throw new DvError("SPACE_ASPECT","Aspect requires a positive width/height ratio");
 const width=parseNumber(parts[0]!),height=parts.length===2?parseNumber(parts[1]!):1;
 if(width<=0||height<=0||!Number.isFinite(width/height))throw new DvError("SPACE_ASPECT","Aspect requires positive finite dimensions");
 return width/height;
}
export function parseLength(text: string): Length {
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|%)$/.exec(text); if (!m) throw new DvError("SPACE_LENGTH", "Length requires an explicit px or % unit"); return { unit: m[2] as Length["unit"], value: parseNumber(m[1]!) };
}
export function lengthPx(length: Length, dimension: number): number { return length.unit === "px" ? length.value : dimension * length.value / 100; }
export function parentRect(parent: Canvas | Frame): Rect { return "rect" in parent ? parent.rect : { xPx: 0, yPx: 0, ...parent.extent }; }
export function anchorPoint(name: string): { x: number; y: number } {
  const anchors: Record<AnchorName, [number, number]> = { "top-left": [0,0], "top-center": [.5,0], "top-right": [1,0], "center-left": [0,.5], center: [.5,.5], "center-right": [1,.5], "bottom-left": [0,1], "bottom-center": [.5,1], "bottom-right": [1,1] };
  if (!Object.hasOwn(anchors, name)) throw new DvError("SPACE_ANCHOR", `Unknown anchor ${name}`); const [x,y] = anchors[name as AnchorName]; return { x, y };
}
export function anchoredRect(parent: Rect, x: Length, y: Length, widthPx: number, heightPx: number, anchor: string, offsetXPx = 0, offsetYPx = 0): Rect {
  const a = anchorPoint(anchor); const rect = { xPx: parent.xPx + lengthPx(x,parent.widthPx) - widthPx*a.x + offsetXPx, yPx: parent.yPx + lengthPx(y,parent.heightPx) - heightPx*a.y + offsetYPx, widthPx, heightPx }; validateRect(rect); return rect;
}
