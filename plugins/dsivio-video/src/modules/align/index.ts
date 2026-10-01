import { DvError } from "../../core/errors.ts";
import type { ModuleDef } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import { pipelineTypes } from "../../pipeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { Adjustment } from "../../timeline/types.ts";
import { materializeTake } from "../../timeline/align.ts";
import { adjustTake } from "../../timeline/adjust.ts";
import { validateNarrative, validateSegmentRef, validateSemanticTake, validateMomentRef, validateAdjustment } from "../../timeline/validate.ts";
import { validateEvidence, validateSpeechAudio, validateMedia, language } from "../../pipeline/validate.ts";
import { attrs, literal, reference, empty, unsigned, input } from "../pipeline/index.ts";

export const ALIGN_MODULE = "dsivio-video/align@1";
const languageType = `${ALIGN_MODULE}#Language`;
const align: ModuleDef = {
  id: ALIGN_MODULE, summary: "Prepare acoustic evidence and match a complete authored segment to synchronized media.",
  types: {
    SpeechAudio: { summary: "Exact 16 kHz mono PCM s16 evidence audio.", validate: validateSpeechAudio },
    Evidence: { summary: "Provider-neutral raw acoustic measurements in integer samples.", validate: validateEvidence },
    SemanticTake: { summary: "Complete segment/token anchor locations on unchanged media.", validate: validateSemanticTake },
    Adjustment: { summary: "Local anchor edits without media changes.", validate: validateAdjustment },
    Language: { summary: "Explicit lowercase two/three-letter alignment language.", validate: language },
  },
  producers: {
    speechAudio: { inputs: { media: { type: timelineTypes.media } }, outputs: { audio: pipelineTypes.speechAudio }, run(inputs) {
      const media = input(inputs, "media"); validateMedia(media); if (!media.sound) throw new DvError("SPEECH_AUDIO_REQUIRED", "Spoken media has no normalized sound");
      const numerator = BigInt(media.totalFrames) * 16000n * BigInt(media.clock.fps.denominator); const denominator = BigInt(media.clock.fps.numerator); const samples = (2n * numerator + denominator) / (2n * denominator);
      if (samples < 1n || samples > BigInt(Number.MAX_SAFE_INTEGER)) throw new DvError("SPEECH_SAMPLE_OVERFLOW", "Speech sample count exceeds the valid domain");
      return { needs: { audio: { capability: "local/speech-audio", request: { sound: media.sound as unknown as Json, totalSamples16k: Number(samples) } } } };
    } },
    evidence: { inputs: { audio: { type: pipelineTypes.speechAudio }, language: { type: languageType } }, outputs: { evidence: pipelineTypes.evidence }, previewsPending: true, run(inputs) { return { needs: { evidence: { capability: "local/align", request: { audio: input(inputs, "audio"), language: input(inputs, "language") } } } }; } },
    materialize: { inputs: { narrative: { type: timelineTypes.narrative }, segment: { type: timelineTypes.segment }, media: { type: timelineTypes.media }, evidence: { type: pipelineTypes.evidence, optional: true } }, outputs: { take: timelineTypes.take }, run(inputs) {
      const narrative = input(inputs, "narrative"); const segment = input(inputs, "segment"); const media = input(inputs, "media"); const evidence = inputs.evidence === undefined ? undefined : input(inputs, "evidence");
      validateNarrative(narrative); validateSegmentRef(segment); validateMedia(media); if (evidence !== undefined) validateEvidence(evidence);
      return { outputs: { take: { type: timelineTypes.take, data: materializeTake(narrative, segment, media, evidence) as unknown as Json } } };
    } },
    adjust: { inputs: { take: { type: timelineTypes.take }, adjustment: { type: timelineTypes.adjustment } }, outputs: { take: timelineTypes.take }, run(inputs) { const take = input(inputs, "take"); const adjustment = input(inputs, "adjustment"); validateSemanticTake(take); validateAdjustment(adjustment); return { outputs: { take: { type: timelineTypes.take, data: adjustTake(take, adjustment) as unknown as Json } } }; } },
  },
  surfaces: {
    SemanticTake: { mode: "structured", doc: { summary: "Match a complete Script segment to real normalized media; empty segments skip all speech IO.", attributes: ["id", "narrative", "segment", "media", "language"].map(name => ({ name, required: name !== "language", accepts: name === "narrative" ? timelineTypes.narrative : name === "segment" ? timelineTypes.segment : name === "media" ? timelineTypes.media : "text", summary: name === "language" ? "Required for spoken segments; forbidden for empty segments." : name })), outputs: [{ name: "take", type: timelineTypes.take, summary: "Semantic segment and local token frames." }] }, elaborate(node, ctx) {
      if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "SemanticTake is structured", node.span); empty(node, ctx); const a = attrs(node, ["id", "narrative", "segment", "media", "language"], ctx); const id = literal(a.id, "id", node, ctx);
      const narrative = reference(a.narrative, [timelineTypes.narrative], node, ctx); const segment = reference(a.segment, [timelineTypes.segment], node, ctx); const media = reference(a.media, [timelineTypes.media], node, ctx);
      if (narrative.kind !== "record" || segment.kind !== "record") return ctx.fail("SPEECH_SEGMENT_INVALID", "Narrative and Segment must be static Script records", node.span);
      validateNarrative(narrative.value.data); validateSegmentRef(segment.value.data);
      const segmentData = segment.value.data;
      const canonical = narrative.value.data.segments.find(s => s.segmentKey === segmentData.segmentKey);
      if (!canonical || canonical.storyKey !== segmentData.storyKey || canonical.tokenBounds.start !== segmentData.tokenBounds.start || canonical.tokenBounds.end !== segmentData.tokenBounds.end || canonical.anchors.start !== segmentData.anchors.start || canonical.anchors.end !== segmentData.anchors.end) return ctx.fail("SPEECH_SEGMENT_INVALID", "Segment must be a complete Narrative segment", node.span);
      const spoken = canonical.tokenBounds.end > canonical.tokenBounds.start;
      const inputs = { narrative, segment, media };
      if (!spoken) { if (a.language) return ctx.fail("SPEECH_LANGUAGE_INVALID", "Empty segment cannot specify language", a.language.span); ctx.operation({ producer: `${ALIGN_MODULE}#materialize`, inputs, publish: { take: `${id}.take` }, label: id, span: node.span }); return; }
      const lang = literal(a.language, "language", node, ctx); language(lang);
      const audio = ctx.operation({ producer: `${ALIGN_MODULE}#speechAudio`, inputs: { media }, publish: {}, label: `${id}:speech-audio`, span: node.span });
      const evidence = ctx.operation({ producer: `${ALIGN_MODULE}#evidence`, inputs: { audio: audio.audio!, language: ctx.record(null, { type: languageType, data: lang }, node.span) }, publish: {}, label: `${id}:align`, span: node.span });
      ctx.operation({ producer: `${ALIGN_MODULE}#materialize`, inputs: { ...inputs, evidence: evidence.evidence! }, publish: { take: `${id}.take` }, label: id, span: node.span });
    } },
    Adjust: { mode: "structured", doc: { summary: "Edit existing local anchors without changing media or rerunning recognition.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Output prefix." }, { name: "source", required: true, accepts: timelineTypes.take, summary: "SemanticTake to calibrate." }], children: [{ tag: "Anchor", repeat: true, summary: "Empty at={MomentRef}, frame=<local frame>. At least one." }], outputs: [{ name: "take", type: timelineTypes.take, summary: "Calibrated SemanticTake." }] }, elaborate(node, ctx) {
      if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "Adjust is structured", node.span); const a = attrs(node, ["id", "source"], ctx); const id = literal(a.id, "id", node, ctx); const source = reference(a.source, [timelineTypes.take], node, ctx); const prefix = node.tag.slice(0, node.tag.lastIndexOf(":") + 1);
      const adjustment: Adjustment = { storyKey: "", edits: [] };
      for (const child of node.children) { if (child.kind === "text" && !child.text.trim()) continue; if (child.kind !== "element" || child.tag !== `${prefix}Anchor`) return ctx.fail("MARKUP_CHILD", "Adjust accepts only Anchor children", child.span); empty(child, ctx); const c = attrs(child, ["at", "frame"], ctx); const at = reference(c.at, [timelineTypes.moment], child, ctx); if (at.kind !== "record") return ctx.fail("SPEECH_ADJUST_INVALID", "Anchor moment must be static", child.span); validateMomentRef(at.value.data); if (adjustment.storyKey && adjustment.storyKey !== at.value.data.storyKey) return ctx.fail("SPEECH_ADJUST_INVALID", "Adjust moments must belong to one Narrative", child.span); adjustment.storyKey = at.value.data.storyKey; adjustment.edits.push({ anchorKey: at.value.data.anchorKey, localFrame: unsigned(literal(c.frame, "frame", child, ctx), "Local frame") }); }
      validateAdjustment(adjustment); ctx.operation({ producer: `${ALIGN_MODULE}#adjust`, inputs: { take: source, adjustment: ctx.record(null, { type: timelineTypes.adjustment, data: adjustment }, node.span) }, publish: { take: `${id}.take` }, label: id, span: node.span });
    } },
  },
};
export default align;
