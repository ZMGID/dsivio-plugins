import type { ElaborationContext } from "../../core/module.ts";
import type { ElementNode, RawElement } from "../../markup/ast.ts";
import { attributes, literal, empty } from "../../space/parse.ts";
import { entityIdentity } from "../../timeline/identity.ts";
import { captionTypes } from "./types.ts";
export function decodeHidden(node: ElementNode | RawElement, ctx: ElaborationContext): void {
 const attrs = attributes(node, ["id"], ctx); empty(node, ctx); const id = literal(attrs.id, "id", ctx, node); ctx.record(id, { type: captionTypes.style, data: { kind: "hidden", styleKey: entityIdentity(ctx.file, id) } }, node.span);
}
