import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, ModuleDef, ProducerDef, ProducerInputs } from "../../core/module.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import { isPending } from "../../core/value.ts";
import { pipelineTypes } from "../../pipeline/types.ts";
import { timelineTypes } from "../../timeline/types.ts";
import type { Clock, Rational } from "../../timeline/types.ts";
import type { StreamPolicy, TransformPlan, ExtractFrameOptions } from "../../pipeline/types.ts";
import { selectStreams } from "../../pipeline/select.ts";
import { clock, integer, object, validateAudio, validateAudioOptions, validateFrameOptions, validateInspection, validateMedia, validatePolicy, validateSelection, validateTransform } from "../../pipeline/validate.ts";

export const PIPELINE_MODULE = "dsivio-video/pipeline@1";
const recipeType = "dsivio-video/recipe@1#Recipe";
const videoType = "dsivio-video/media@1#Video";
const audioType = "dsivio-video/media@1#Audio";
const imageType = "dsivio-video/media@1#Image";
export function attrs(element: ElementNode | RawElement, allowed: string[], ctx: ElaborationContext): Record<string, Attribute> {
  const result: Record<string, Attribute> = {};
  for (const attr of element.attributes) { if (!allowed.includes(attr.name) || result[attr.name]) return ctx.fail("MARKUP_ATTRIBUTE", `Unknown or duplicate attribute ${attr.name}`, attr.span); result[attr.name] = attr; }
  return result;
}
export function literal(attr: Attribute | undefined, name: string, node: ElementNode | RawElement, ctx: ElaborationContext): string {
  if (!attr || attr.value.kind !== "literal" || !attr.value.text.trim()) return ctx.fail("MARKUP_ATTRIBUTE", `${name} must be nonempty literal text`, attr?.span ?? node.span);
  return attr.value.text;
}
export function reference(attr: Attribute | undefined, expected: string[], node: ElementNode | RawElement, ctx: ElaborationContext): Binding {
  if (!attr || attr.value.kind !== "ref") return ctx.fail("MARKUP_REFERENCE", "Expected a whole value reference", attr?.span ?? node.span);
  const binding = ctx.lookup(attr.value.name, attr.span);
  if (!expected.includes(binding.type)) return ctx.fail("TYPE_INVALID", `Expected ${expected.join(" or ")}; received ${binding.type}`, attr.span);
  return binding;
}
export function empty(node: ElementNode, ctx: ElaborationContext): void {
  if (node.children.some(c => c.kind !== "text" || c.text.trim())) return ctx.fail("MARKUP_CHILD", `${node.tag} must be empty`, node.span);
}
export function unsigned(value: string, name: string, positive = false): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (positive ? 1 : 0)) throw new DvError("MARKUP_NUMBER", `${name} must be a ${positive ? "positive" : "nonnegative"} safe integer`);
  return Number(value);
}
export function ratio(value: string): Rational {
  if (!/^\d+(?:\/\d+)?$/.test(value)) throw new DvError("MARKUP_RATIO", "Expected positive integer or integer ratio");
  const [n, d = "1"] = value.split("/"); return { numerator: unsigned(n!, "Numerator", true), denominator: unsigned(d, "Denominator", true) };
}
export function input(inputs: ProducerInputs, port: string): Json {
  const value = inputs[port]; if (!value || Array.isArray(value)) throw new DvError("PRODUCER_INPUT", `Missing scalar input ${port}`);
  return isPending(value) ? { ...value } : value.data;
}
function authoredClock(a: Record<string, Attribute>, node: ElementNode, ctx: ElaborationContext): Binding {
  if (Boolean(a.clock) === Boolean(a["frame-rate"])) return ctx.fail("CLOCK_INVALID", "Provide exactly one clock or frame-rate", node.span);
  if (a.clock) return reference(a.clock, [timelineTypes.clock], node, ctx);
  const value: Clock = { fps: ratio(literal(a["frame-rate"], "frame-rate", node, ctx)) };
  return ctx.record(null, { type: timelineTypes.clock, data: value }, node.span);
}
const producers: Record<string, ProducerDef> = {
  inspect: { inputs: { source: { type: videoType } }, outputs: { inspection: pipelineTypes.inspection }, previewsPending: true, run(inputs) { return { needs: { inspection: { capability: "local/inspect", request: { source: input(inputs, "source") } } } }; } },
  inspectAudio: { inputs: { source: { type: audioType } }, outputs: { inspection: pipelineTypes.inspection }, previewsPending: true, run(inputs) { return { needs: { inspection: { capability: "local/inspect", request: { source: input(inputs, "source") } } } }; } },
  select: { inputs: { inspection: { type: pipelineTypes.inspection }, policy: { type: pipelineTypes.policy } }, outputs: { selection: pipelineTypes.selection }, run(inputs) { const inspection = input(inputs, "inspection"); const policy = input(inputs, "policy"); validateInspection(inspection); validatePolicy(policy); return { outputs: { selection: { type: pipelineTypes.selection, data: selectStreams(inspection, policy) as unknown as Json } } }; } },
  normalize: { inputs: { selection: { type: pipelineTypes.selection }, clock: { type: timelineTypes.clock } }, outputs: { media: timelineTypes.media }, previewsPending: true, run(inputs) { return { needs: { media: { capability: "local/normalize", request: { selection: input(inputs, "selection"), clock: input(inputs, "clock") } } } }; } },
  transform: { inputs: { media: { type: timelineTypes.media }, plan: { type: pipelineTypes.transform } }, outputs: { media: timelineTypes.media }, run(inputs) {
    const media = input(inputs, "media"); const plan = input(inputs, "plan"); validateMedia(media); validateTransform(plan);
    let frames = media.totalFrames; const resolved: TransformPlan = { operations: [] };
    for (const op of plan.operations) {
      if (op.kind === "trim") { const end = op.frames.end ?? frames; if (end > frames || end <= op.frames.start) throw new DvError("TRANSFORM_TRIM_RANGE", "Trim must be nonempty and inside current media"); resolved.operations.push({ kind: "trim", frames: { start: op.frames.start, end } }); frames = end - op.frames.start; }
      else { resolved.operations.push(op); const numerator = BigInt(frames) * BigInt(op.speed.denominator); const denominator = BigInt(op.speed.numerator); const result = (2n * numerator + denominator) / (2n * denominator); if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new DvError("TRANSFORM_FRAME_OVERFLOW", "Retime frame count exceeds safe integers"); frames = Math.max(1, Number(result)); }
    }
    return { needs: { media: { capability: "local/transform", request: { media: media as unknown as Json, plan: resolved as Json } } } };
  } },
  still: { inputs: { image: { type: imageType }, clock: { type: timelineTypes.clock }, frames: { type: pipelineTypes.frameCount } }, outputs: { video: videoType }, previewsPending: true, run(inputs) { return { needs: { video: { capability: "local/still-video", request: { image: input(inputs, "image"), clock: input(inputs, "clock"), totalFrames: input(inputs, "frames") } } } }; } },
};
for (const kind of ["video", "audio"] as const) producers[`extractAudio${kind}`] = { inputs: { source: { type: kind === "video" ? videoType : audioType }, options: { type: pipelineTypes.audioOptions } }, outputs: { audio: pipelineTypes.audio }, previewsPending: true, run(inputs) { const options = input(inputs, "options"); validateAudioOptions(options); return { needs: { audio: { capability: "local/extract-audio", request: { source: input(inputs, "source"), streamIndex: options.streamIndex } } } }; } };
producers.extractFrame = { inputs: { source: { type: videoType }, options: { type: pipelineTypes.frameOptions } }, outputs: { image: imageType }, previewsPending: true, run(inputs) { const options = input(inputs, "options"); validateFrameOptions(options); return { needs: { image: { capability: "local/extract-frame", request: { source: input(inputs, "source"), streamIndex: options.streamIndex, position: options.position as Json } } } }; } };
const pipeline: ModuleDef = {
  id: PIPELINE_MODULE, summary: "Deterministic stream selection and local synchronized media preparation.",
  types: {
    Inspection: { summary: "All decoded container streams and effective timing.", validate: validateInspection }, StreamSelection: { summary: "Unambiguous selected moving-picture/audio streams.", validate: validateSelection }, StreamPolicy: { summary: "Authored stream policies and authority.", validate: validatePolicy }, SynchronizedMedia: { summary: "CFR picture and exact 48 kHz PCM on one clock.", validate: validateMedia }, TransformPlan: { summary: "Ordered local trim and pitch-preserving retime.", validate: validateTransform }, NormalizedAudio: { summary: "48 kHz stereo PCM s16 WAV.", validate: validateAudio }, ExtractAudioOptions: { summary: "Explicit audio stream index.", validate: validateAudioOptions }, ExtractFrameOptions: { summary: "Explicit picture stream and frame selection.", validate: validateFrameOptions }, FrameCount: { summary: "Positive safe frame count.", validate(data) { integer(data, "Frames", 1); } },
  },
  producers,
  surfaces: {
    Normalize: { mode: "structured", doc: { summary: "Inspect, select and normalize video or audio to an explicit clock.", attributes: ["id", "source", "clock", "frame-rate", "recipe", "video", "audio", "span-authority"].map(name => ({ name, required: name === "id" || name === "source", accepts: name === "source" ? `${videoType} or ${audioType}` : name === "clock" ? timelineTypes.clock : name === "recipe" ? recipeType : "text", summary: name === "clock" || name === "frame-rate" ? "Exactly one clock choice." : name === "recipe" ? "Recipe or complete explicit video/audio/span-authority policy." : name })), outputs: [{ name: "media", type: timelineTypes.media, summary: "Synchronized normalized media." }] }, elaborate(node, ctx) {
      if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "Normalize is structured", node.span); empty(node, ctx);
      const a = attrs(node, ["id", "source", "clock", "frame-rate", "recipe", "video", "audio", "span-authority"], ctx); const id = literal(a.id, "id", node, ctx);
      const source = reference(a.source, [videoType, audioType], node, ctx); const c = authoredClock(a, node, ctx);
      let policy: StreamPolicy;
      if (a.recipe) {
        if (a.video || a.audio || a["span-authority"]) return ctx.fail("STREAM_POLICY_INVALID", "Recipe and explicit policy are exclusive", node.span);
        const binding = reference(a.recipe, [recipeType], node, ctx);
        if (binding.kind !== "record") return ctx.fail("STREAM_POLICY_INVALID", "Policy Recipe must be static", node.span);
        object(binding.value.data); object(binding.value.data.properties);
        const data = binding.value.data.properties; const unknown = Object.keys(data).filter(k => !["video", "audio", "span-authority"].includes(k));
        if (unknown.length) return ctx.fail("STREAM_POLICY_INVALID", `Unknown policy recipe keys ${unknown}`, node.span);
        const candidate = { video: data.video, audio: data.audio, spanAuthority: data["span-authority"] }; validatePolicy(candidate); policy = candidate;
      }
      else { const candidate = { video: literal(a.video, "video", node, ctx), audio: literal(a.audio, "audio", node, ctx), spanAuthority: literal(a["span-authority"], "span-authority", node, ctx) }; validatePolicy(candidate); policy = candidate; }
      const inspect = ctx.operation({ producer: `${PIPELINE_MODULE}#${source.type === audioType ? "inspectAudio" : "inspect"}`, inputs: { source }, publish: {}, label: `${id}:inspect`, span: node.span });
      const selected = ctx.operation({ producer: `${PIPELINE_MODULE}#select`, inputs: { inspection: inspect.inspection!, policy: ctx.record(null, { type: pipelineTypes.policy, data: policy }, node.span) }, publish: {}, label: `${id}:select`, span: node.span });
      ctx.operation({ producer: `${PIPELINE_MODULE}#normalize`, inputs: { selection: selected.selection!, clock: c }, publish: { media: `${id}.media` }, label: id, span: node.span });
    } },
    Transform: { mode: "structured", doc: { summary: "Transform media before semantic alignment, in declaration order.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Output prefix." }, { name: "source", required: true, accepts: timelineTypes.media, summary: "Normalized media, never SemanticTake." }], children: [{ tag: "Trim", repeat: true, summary: "start-frame (default 0), end-frame-exclusive (default current end)." }, { tag: "Retime", repeat: true, summary: "Positive integer ratio speed; preserve-pitch fixed true." }], outputs: [{ name: "media", type: timelineTypes.media, summary: "Transformed normalized media." }] }, elaborate(node, ctx) {
      if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "Transform is structured", node.span); const a = attrs(node, ["id", "source"], ctx); const id = literal(a.id, "id", node, ctx); const source = reference(a.source, [timelineTypes.media], node, ctx);
      const plan: TransformPlan = { operations: [] }; const prefix = node.tag.slice(0, node.tag.lastIndexOf(":") + 1);
      for (const child of node.children) { if (child.kind === "text" && !child.text.trim()) continue; if (child.kind !== "element") return ctx.fail("MARKUP_CHILD", "Transform only accepts Trim/Retime", child.span); empty(child, ctx);
        if (child.tag === `${prefix}Trim`) { const c = attrs(child, ["start-frame", "end-frame-exclusive"], ctx); const start = c["start-frame"] ? unsigned(literal(c["start-frame"], "start-frame", child, ctx), "start-frame") : 0; const end = c["end-frame-exclusive"] ? unsigned(literal(c["end-frame-exclusive"], "end-frame-exclusive", child, ctx), "end-frame-exclusive", true) : undefined; plan.operations.push({ kind: "trim", frames: { start, ...(end === undefined ? {} : { end }) } }); }
        else if (child.tag === `${prefix}Retime`) { const c = attrs(child, ["speed", "preserve-pitch"], ctx); if (c["preserve-pitch"] && literal(c["preserve-pitch"], "preserve-pitch", child, ctx) !== "true") return ctx.fail("TRANSFORM_INVALID", "Retime must preserve pitch", child.span); plan.operations.push({ kind: "retime", speed: ratio(literal(c.speed, "speed", child, ctx)), preservePitch: true }); }
        else return ctx.fail("MARKUP_CHILD", `Unknown transform ${child.tag}`, child.span);
      }
      validateTransform(plan); ctx.operation({ producer: `${PIPELINE_MODULE}#transform`, inputs: { media: source, plan: ctx.record(null, { type: pipelineTypes.transform, data: plan as Json }, node.span) }, publish: { media: `${id}.media` }, label: id, span: node.span });
    } },
    ExtractAudio: { mode: "structured", doc: { summary: "Extract an explicit audio stream as normalized WAV.", attributes: ["id", "source", "stream-index"].map(name => ({ name, required: true, accepts: name === "source" ? `${videoType} or ${audioType}` : "text", summary: name })), outputs: [{ name: "audio", type: pipelineTypes.audio, summary: "PCM WAV with measured samples." }] }, elaborate(node, ctx) { if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "ExtractAudio is structured", node.span); empty(node, ctx); const a = attrs(node, ["id", "source", "stream-index"], ctx); const id = literal(a.id, "id", node, ctx); const source = reference(a.source, [videoType, audioType], node, ctx); ctx.operation({ producer: `${PIPELINE_MODULE}#extractAudio${source.type === audioType ? "audio" : "video"}`, inputs: { source, options: ctx.record(null, { type: pipelineTypes.audioOptions, data: { streamIndex: unsigned(literal(a["stream-index"], "stream-index", node, ctx), "stream-index") } }, node.span) }, publish: { audio: `${id}.audio` }, label: id, span: node.span }); } },
    ExtractFrame: { mode: "structured", doc: { summary: "Extract one actual decoded frame as PNG.", attributes: ["id", "source", "stream-index", "position"].map(name => ({ name, required: true, accepts: name === "source" ? videoType : "text", summary: name === "position" ? "first|last|frame:<n>|seconds:<decimal>" : name })), outputs: [{ name: "image", type: imageType, summary: "Single-frame PNG." }] }, elaborate(node, ctx) { if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "ExtractFrame is structured", node.span); empty(node, ctx); const a = attrs(node, ["id", "source", "stream-index", "position"], ctx); const id = literal(a.id, "id", node, ctx); const pos = literal(a.position, "position", node, ctx); let position: ExtractFrameOptions["position"];
      if (pos === "first" || pos === "last") position = { kind: pos }; else if (/^frame:\d+$/.test(pos)) position = { kind: "frame", index: unsigned(pos.slice(6), "Frame index") }; else if (/^seconds:\d+(?:\.\d+)?$/.test(pos)) { const [whole, frac = ""] = pos.slice(8).split("."); position = { kind: "seconds", value: { numerator: unsigned(`${whole}${frac}`, "Seconds numerator"), denominator: unsigned(`1${"0".repeat(frac.length)}`, "Seconds denominator", true) } }; } else return ctx.fail("EXTRACT_POSITION_INVALID", "Invalid frame position", node.span);
      ctx.operation({ producer: `${PIPELINE_MODULE}#extractFrame`, inputs: { source: reference(a.source, [videoType], node, ctx), options: ctx.record(null, { type: pipelineTypes.frameOptions, data: { streamIndex: unsigned(literal(a["stream-index"], "stream-index", node, ctx), "stream-index"), position } }, node.span) }, publish: { image: `${id}.image` }, label: id, span: node.span }); } },
    StillVideo: { mode: "structured", doc: { summary: "Repeat an image's first frame into a real CFR video.", attributes: ["id", "image", "clock", "frames"].map(name => ({ name, required: true, accepts: name === "image" ? imageType : name === "clock" ? timelineTypes.clock : "text", summary: name })), outputs: [{ name: "video", type: videoType, summary: "Silent CFR H.264 video." }] }, elaborate(node, ctx) { if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "StillVideo is structured", node.span); empty(node, ctx); const a = attrs(node, ["id", "image", "clock", "frames"], ctx); const id = literal(a.id, "id", node, ctx); ctx.operation({ producer: `${PIPELINE_MODULE}#still`, inputs: { image: reference(a.image, [imageType], node, ctx), clock: reference(a.clock, [timelineTypes.clock], node, ctx), frames: ctx.record(null, { type: pipelineTypes.frameCount, data: unsigned(literal(a.frames, "frames", node, ctx), "Frames", true) }, node.span) }, publish: { video: `${id}.video` }, label: id, span: node.span }); } },
  },
};
export default pipeline;
