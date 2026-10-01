import type { ElaborationContext, ModuleDef } from "../../core/module.ts";
import { parseScript } from "../../timeline/script.ts";
import { timelineTypes } from "../../timeline/types.ts";
import { validateNarrative, validateSegmentRef, validateSelectionRef, validateMomentRef, validateCaptionDocument } from "../../timeline/validate.ts";
import { TEXT } from "../text/index.ts";

const scriptModule: ModuleDef = {
  id: "dsivio-video/script@1", summary: "Raw author narrative, pronunciation, captions and semantic references.",
  types: {
    Narrative: { summary: "Untimed author truth with distinct token, segment and story anchors.", validate: validateNarrative },
    SegmentRef: { summary: "Complete named segment excerpt.", validate: validateSegmentRef },
    SelectionRef: { summary: "Author-order token range and independently bound semantic endpoints.", validate: validateSelectionRef },
    MomentRef: { summary: "Named reference to one existing anchor.", validate: validateMomentRef },
    CaptionDocument: { summary: "Authored display units and cue grouping, independent of ASR.", validate: validateCaptionDocument },
  },
  surfaces: { Script: {
    mode: "raw", doc: { summary: "Parses named segments, role cues, Dual Text, caption breaks, word attributes and affinity-aware selections/moments. Comments and markers do not split words; reserved characters require backslash escapes.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Public Narrative name." }], outputs: [
      { name: "", type: timelineTypes.narrative, summary: "Narrative." }, { name: "segment.<name>", type: timelineTypes.segment, summary: "Complete SegmentRef." }, { name: "selection.<name>", type: timelineTypes.selection, summary: "SelectionRef." }, { name: "moment.<name>", type: timelineTypes.moment, summary: "MomentRef." }, { name: "caption", type: timelineTypes.caption, summary: "CaptionDocument." }, { name: "speech", type: TEXT, summary: "Pronunciation-only text, also available per segment." }, { name: "dialogue", type: TEXT, summary: "Pronunciation with role labels, also available per segment." },
    ] },
    elaborate(element, ctx: ElaborationContext) {
      if (element.kind !== "raw") ctx.fail("SCRIPT_SURFACE", "Script requires raw markup", element.span);
      if (element.attributes.length !== 1 || element.attributes[0]!.name !== "id" || element.attributes[0]!.value.kind !== "literal" || !element.attributes[0]!.value.text.trim()) ctx.fail("SCRIPT_SURFACE_ATTRIBUTE", "Script requires exactly one literal id", element.span);
      const id = element.attributes[0]!.value.text.trim();
      ctx.identity("narrative", id, element.span);
      const result = parseScript(element.body, id, ctx.file, element.bodyStart, element.bodySpan);
      ctx.record(id, { type: timelineTypes.narrative, data: result.narrative }, element.span);
      ctx.record(`${id}.caption`, { type: timelineTypes.caption, data: result.narrative.captions }, element.span);
      for (const view of ["speech", "dialogue"] as const) ctx.record(`${id}.${view}`, { type: TEXT, data: result[view] }, element.span);
      for (const [name, segment] of Object.entries(result.segments)) {
        ctx.record(`${id}.segment.${name}`, { type: timelineTypes.segment, data: segment }, element.span);
        for (const view of ["speech", "dialogue"] as const) ctx.record(`${id}.segment.${name}.${view}`, { type: TEXT, data: result.segmentTexts[name]![view] }, element.span);
      }
      for (const selection of result.narrative.selections) ctx.record(`${id}.selection.${selection.selectionKey}`, { type: timelineTypes.selection, data: selection }, element.span);
      for (const moment of result.narrative.moments) ctx.record(`${id}.moment.${moment.momentKey}`, { type: timelineTypes.moment, data: moment }, element.span);
    },
  } }, producers: {},
};
export default scriptModule;
