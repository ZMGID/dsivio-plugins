import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, InputValue, ModuleDef, ProducerDef, SurfaceDef } from "../../core/module.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import { isPending, isResourceRef, resourcesIn } from "../../core/value.ts";
import { audioType, imageType, videoType, validateMedia } from "../media/index.ts";
import { object } from "../../gateway/request.ts";
export const GEN_MODULE = "dsivio-video/gen@1";
const textType = "dsivio-video/text@1#Text", configType = `${GEN_MODULE}#RequestConfig`, consentType = `${GEN_MODULE}#ConsentAttestation`;
type Kind = "image" | "video" | "speech";
const mediaTypes = { image: imageType, video: videoType, speech: audioType };
const canonical: Record<string, string> = { ratio: "aspectRatio", count: "n", audio: "generateAudio", "output-format": "outputFormat", "first-frame": "firstFrame", "last-frame": "lastFrame", "voice-ref": "voiceReference", "consent-attestation": "consentAttestation" };
function attributes(element: ElementNode | RawElement, names: string[], ctx: ElaborationContext): Record<string, Attribute> {
  const result: Record<string, Attribute> = {};
  for (const attr of element.attributes) { if (!names.includes(attr.name) || Object.hasOwn(result, attr.name)) ctx.fail("MARKUP_ATTRIBUTE", `Unknown or duplicate ${element.tag} attribute ${attr.name}`, attr.span); result[attr.name] = attr; }
  return result;
}
function literal(attr: Attribute | undefined, name: string, node: ElementNode | RawElement, ctx: ElaborationContext): string {
  if (!attr || attr.value.kind !== "literal" || !attr.value.text.trim()) ctx.fail(name === "model" ? "GEN_MODEL_REQUIRED" : "MARKUP_ATTRIBUTE", `${name} requires non-empty literal text`, attr?.span ?? node.span);
  return attr.value.text;
}
function reference(attr: Attribute, type: string, ctx: ElaborationContext): Binding {
  if (attr.value.kind !== "ref") ctx.fail("MARKUP_REFERENCE", `${attr.name} must be a whole value reference`, attr.span);
  const binding = ctx.lookup(attr.value.name, attr.span);
  if (binding.type !== type) ctx.fail("TYPE_INVALID", `${attr.name} expects ${type}, received ${binding.type}`, attr.span);
  return binding;
}
function surface(kind: Kind): SurfaceDef {
  const name = kind === "image" ? "Image" : kind === "video" ? "Video" : "Speech", output = kind === "speech" ? "audio" : kind;
  const params = kind === "image" ? ["ratio", "size", "quality", "count"] : kind === "video" ? ["duration", "resolution", "ratio", "audio"] : ["mode", "voice", "output-format"];
  const text = kind === "speech" ? "text" : "prompt";
  const extra = kind === "video" ? ["first-frame", "last-frame"] : kind === "speech" ? ["voice-ref", "consent-attestation", "instruction"] : [];
  return { mode: "structured", doc: { summary: `Generate ${kind} through the selected immutable backend; publish its first ${output}.`, paid: true,
    attributes: [{ name: "id", required: true, accepts: "text", summary: "Public output prefix." }, { name: "model", required: true, accepts: "text", summary: "Explicit enabled provider/model." }, { name: text, required: true, accepts: `${textType} or literal text`, summary: "Text preserved exactly; live descriptor validates it." }, ...[...params, ...extra].map(param => ({ name: param, required: false, accepts: param === "voice-ref" ? audioType : param.includes("frame") ? imageType : "text", summary: "Live model descriptor controls domain/defaults; media references preserve graph dependencies." }))],
    children: [{ tag: "Option", repeat: true, summary: "Empty name/value/type child (string, number, boolean, json). Media must use typed references, never JSON." }, ...(kind === "speech" ? [] : [{ tag: "Reference", repeat: true, summary: "Exactly one typed image/video/audio reference; order preserved." }])], outputs: [{ name: output, type: mediaTypes[kind], summary: "First generated resource; task retains all outputs." }] },
    elaborate(node, ctx) {
      if (node.kind !== "element") return ctx.fail("MARKUP_ELEMENT", "Generation requires structured markup", node.span);
      const a = attributes(node, ["id", "model", text, ...params, ...extra], ctx), id = literal(a.id, "id", node, ctx), model = literal(a.model, "model", node, ctx);
      const inputs: Record<string, Binding | Binding[]> = {}, args: Record<string, Json> = {};
      for (const field of [text, ...(kind === "speech" ? ["instruction"] : [])]) {
        const attr = a[field]; if (!attr) { if (field === text) ctx.fail("GEN_TEXT_REQUIRED", `${field} is required`, node.span); continue; }
        inputs[field] = attr.value.kind === "ref" ? reference(attr, textType, ctx) : ctx.record(null, { type: textType, data: literal(attr, field, node, ctx) }, attr.span);
      }
      for (const param of params) {
        if (!a[param]) continue; const value = literal(a[param], param, node, ctx), key = canonical[param] ?? param;
        if (param === "audio") { if (!["true", "false"].includes(value)) ctx.fail("GEN_PARAM_INVALID", "audio must be true or false", a[param]!.span); args[key] = value === "true"; }
        else if (param === "duration" || param === "count") { if (param === "duration" && value === "auto") args[key] = value; else { const number = Number(value); if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) ctx.fail("GEN_PARAM_INVALID", `${param} must be a positive integer${param === "duration" ? " or auto" : ""}`, a[param]!.span); args[key] = number; } }
        else args[key] = value;
      }
      for (const field of ["first-frame", "last-frame", "voice-ref"]) if (a[field]) inputs[canonical[field]!] = reference(a[field]!, field === "voice-ref" ? audioType : imageType, ctx);
      if (a["consent-attestation"]) inputs.consentAttestation = ctx.asset(literal(a["consent-attestation"], "consent-attestation", node, ctx), consentType, "text/plain", a["consent-attestation"]!.span);
      const refs: Record<string, Binding[]> = { images: [], videos: [], audios: [] }, prefix = node.tag.includes(":") ? node.tag.slice(0, node.tag.lastIndexOf(":") + 1) : "";
      for (const child of node.children) {
        if (child.kind === "text" && !child.text.trim()) continue;
        if (child.kind !== "element") return ctx.fail("MARKUP_CHILD", "Generation children must be empty Reference or Option", child.span);
        if (child.children.some(c => c.kind !== "text" || c.text.trim())) ctx.fail("MARKUP_CHILD", "Generation children must be empty Reference or Option", child.span);
        if (child.tag === `${prefix}Reference` && kind !== "speech") {
          const r = attributes(child, kind === "image" ? ["image"] : ["image", "video", "audio"], ctx), entries = Object.entries(r);
          if (entries.length !== 1) ctx.fail("GEN_REFERENCE_INVALID", "Reference requires exactly one media reference", child.span);
          const [category, attr] = entries[0]!; refs[`${category}s`]!.push(reference(attr, category === "image" ? imageType : category === "video" ? videoType : audioType, ctx));
        } else if (child.tag === `${prefix}Option`) {
          const o = attributes(child, ["name", "value", "type"], ctx), key = literal(o.name, "name", child, ctx), raw = literal(o.value, "value", child, ctx), type = o.type ? literal(o.type, "type", child, ctx) : "string";
          if (Object.hasOwn(args, key) || Object.hasOwn(inputs, key)) ctx.fail("GEN_OPTION_INVALID", `Duplicate option ${key}`, child.span);
          let value: Json = raw;
          if (type === "number") { if (!Number.isFinite(Number(raw))) ctx.fail("GEN_OPTION_INVALID", "Option must be finite number", child.span); value = Number(raw); }
          else if (type === "boolean") { if (!["true", "false"].includes(raw)) ctx.fail("GEN_OPTION_INVALID", "Option must be boolean", child.span); value = raw === "true"; }
          else if (type === "json") { try { value = JSON.parse(raw) as Json; } catch { ctx.fail("GEN_OPTION_INVALID", "Option must be valid JSON", child.span); } }
          else if (type !== "string") ctx.fail("GEN_OPTION_INVALID", "Unknown Option type", child.span);
          if (resourcesIn(value).length) ctx.fail("GEN_OPTION_INVALID", "Resource Options must use typed ports, not forged resource JSON", child.span);
          if (Array.isArray(value) && value.some(entry => object(entry) && typeof entry.source === "string" && (/^(?:\/|[A-Za-z]:[\\/]|\.{1,2}\/|file:)/.test(entry.source)))) ctx.fail("GEN_OPTION_INVALID", "Local media Options must use typed Reference ports so files are captured", child.span);
          args[key] = value;
        } else ctx.fail("MARKUP_CHILD", `Unexpected generation child ${child.tag}`, child.span);
      }
      for (const [port, values] of Object.entries(refs)) if (values.length) inputs[port] = values;
      inputs.config = ctx.record(null, { type: configType, data: { model, arguments: args } }, node.span);
      ctx.operation({ producer: `${GEN_MODULE}#${kind}`, inputs, publish: { [output]: `${id}.${output}` }, label: id, span: node.span });
    } };
}
function producer(kind: Kind): ProducerDef {
  const output = kind === "speech" ? "audio" : kind, text = kind === "speech" ? "text" : "prompt";
  return { inputs: { config: { type: configType }, [text]: { type: textType }, ...(kind === "speech" ? { instruction: { type: textType, optional: true }, voiceReference: { type: audioType, optional: true }, consentAttestation: { type: consentType, optional: true } } : { images: { type: imageType, list: true, optional: true } }), ...(kind === "video" ? { videos: { type: videoType, list: true, optional: true }, audios: { type: audioType, list: true, optional: true }, firstFrame: { type: imageType, optional: true }, lastFrame: { type: imageType, optional: true } } : {}) }, outputs: { [output]: mediaTypes[kind] }, previewsPending: true,
    run(inputs) {
      const config = inputs.config; if (!config || Array.isArray(config) || isPending(config) || !object(config.data) || typeof config.data.model !== "string" || !object(config.data.arguments)) throw new DvError("GEN_REQUEST_INVALID", "Generation config must be known");
      const args = { ...config.data.arguments };
      for (const [port, value] of Object.entries(inputs)) {
        if (port === "config" || value === undefined) continue;
        const data = (v: InputValue): Json => {
          if (isPending(v)) return { ...v };
          if ([imageType, videoType, audioType].includes(v.type)) validateMedia(v.data, v.type === imageType ? "image" : v.type === videoType ? "video" : "audio");
          return v.data;
        };
        if (["images", "videos", "audios"].includes(port)) {
          if (!Array.isArray(value)) throw new DvError("TYPE_INVALID", "Reference port requires list");
          const key = kind === "video" ? `reference${port[0]!.toUpperCase()}${port.slice(1)}` : port;
          args[key] = value.map(v => ({ source: data(v), attributes: {} }));
        } else { if (Array.isArray(value)) throw new DvError("TYPE_INVALID", "Single input port requires value"); args[port] = ["firstFrame", "lastFrame", "voiceReference"].includes(port) ? [{ source: data(value), attributes: {} }] : data(value); }
      }
      return { needs: { [output]: { capability: `gateway/${kind}`, request: { model: config.data.model, arguments: args } } } };
    } };
}
const gen: ModuleDef = { id: GEN_MODULE, summary: "Image, video and speech generation through the fixed selected backend.", types: {
  RequestConfig: { summary: "Private canonical model arguments.", validate(data) { if (!object(data) || typeof data.model !== "string" || !data.model.trim() || !object(data.arguments)) throw new DvError("TYPE_INVALID", "Invalid RequestConfig"); } },
  ConsentAttestation: { summary: "User-authorized consent text resource, included in input hashes.", validate(data) { if (!isResourceRef(data) || data.mime !== "text/plain" || data.bytes < 1) throw new DvError("TYPE_INVALID", "Consent attestation requires nonempty text file"); } },
}, surfaces: { Image: surface("image"), Video: surface("video"), Speech: surface("speech") }, producers: { image: producer("image"), video: producer("video"), speech: producer("speech") } };
export default gen;
