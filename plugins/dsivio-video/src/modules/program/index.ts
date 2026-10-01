import type { ElaborationContext, ModuleDef } from "../../core/module.ts";
import { parseClock } from "../../timeline/timeline.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { validateClockData } from "../../timeline/validate.ts";

const programModule: ModuleDef = {
  id: "dsivio-video/program@1", summary: "Exact rational frame clocks.",
  types: { Clock: { summary: "Positive safe-integer FPS numerator and denominator; author ratio is preserved.", validate: validateClockData } },
  surfaces: { Clock: {
    mode: "structured", doc: { summary: "Declares an exact rational frame clock.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Public clock name." }, { name: "frame-rate", required: true, accepts: "integer or integer ratio", summary: "30 or 30000/1001; decimal FPS is rejected." }], outputs: [{ name: "", type: timelineTypes.clock, summary: "Frame clock." }] },
    elaborate(element, ctx: ElaborationContext) {
      if (element.kind !== "element" || element.children.some(c => c.kind !== "text" || c.text.trim())) ctx.fail("CLOCK_CHILD", "Clock must be empty", element.span);
      const attrs: Record<string, string> = Object.create(null);
      for (const a of element.attributes) { if (!["id", "frame-rate"].includes(a.name) || Object.hasOwn(attrs, a.name) || a.value.kind !== "literal" || !a.value.text.trim()) ctx.fail("CLOCK_ATTRIBUTE", "Clock requires unique literal id and frame-rate", a.span); attrs[a.name] = a.value.text; }
      if (!attrs.id || !attrs["frame-rate"]) ctx.fail("CLOCK_ATTRIBUTE", "Clock requires id and frame-rate", element.span);
      ctx.record(attrs.id, { type: timelineTypes.clock, data: parseClock(attrs["frame-rate"]) }, element.span);
    },
  } }, producers: {},
};
export default programModule;
