import type { ModuleDef } from "../../core/module.ts";
import type { Json, Value } from "../../core/value.ts";
import type { CaptionDocument, Timeline, Window } from "../../timeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { CaptionStyle, CaptionUsePlan } from "../../components/caption/types.ts";
import { captionTypes } from "../../components/caption/types.ts";
import { decodeHidden } from "../../components/caption/author.ts";
import { projectCaptionContent, resolveCaptionUses } from "../../components/caption/program.ts";
import { validateCaptionStyle, validateCaptionContent, validateCaptionUsePlan, validateCaptionUses } from "../../components/caption/validate.ts";
const caption: ModuleDef = {
 id: "dsivio-video/caption@1", summary: "Author-owned caption display identity projected onto measured Timeline word clocks; shared Hidden and ordered role-aware Uses.",
 types: { Style: { summary: "Shared hidden or fine caption presentation intent", validate: validateCaptionStyle }, Content: { summary: "Complete authored Cues with measured display-unit clocks", validate: validateCaptionContent }, UsePlan: { summary: "Ordered typed-list Use indexes", validate: validateCaptionUsePlan }, Uses: { summary: "Ordered style selection rules, without re-cutting Cues", validate: validateCaptionUses } },
 surfaces: { Hidden: { mode: "structured", doc: { summary: "No caption presentation, participating in ordinary last-Use precedence.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Style identity" }], outputs: [{ name: "", type: captionTypes.style, summary: "Shared Hidden Style" }] }, elaborate: decodeHidden } },
 producers: {
  content: { inputs: { document: { type: timelineTypes.caption }, timeline: { type: timelineTypes.timeline } }, outputs: { content: captionTypes.content }, run(inputs) { return { outputs: { content: { type: captionTypes.content, data: projectCaptionContent((inputs.document as Value).data as unknown as CaptionDocument, (inputs.timeline as Value).data as unknown as Timeline) as unknown as Json } } }; } },
  uses: { inputs: { timeline: { type: timelineTypes.timeline }, plan: { type: captionTypes.plan }, windows: { type: timelineTypes.window, list: true }, styles: { type: captionTypes.style, list: true } }, outputs: { uses: captionTypes.uses }, run(inputs) { return { outputs: { uses: { type: captionTypes.uses, data: resolveCaptionUses((inputs.timeline as Value).data as unknown as Timeline, (inputs.plan as Value).data as unknown as CaptionUsePlan, (inputs.windows as Value[]).map(v => v.data as unknown as Window), (inputs.styles as Value[]).map(v => v.data as unknown as CaptionStyle)) as unknown as Json } } }; } },
 },
};
export default caption;
