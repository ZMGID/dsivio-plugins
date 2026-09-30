import { DvError } from "../../core/errors.ts";
import type { Binding, ElaborationContext, InputValue, ModuleDef, ProducerDef, SurfaceDef } from "../../core/module.ts";
import type { Attribute, ElementNode, RawElement } from "../../markup/ast.ts";
import type { Json } from "../../core/value.ts";
import { isPending } from "../../core/value.ts";
import { audioType, imageType, videoType, validateMedia } from "../media/index.ts";

export const GEN_MODULE = "dsivio-video/gen@1";
const textType = "dsivio-video/text@1#Text";
const configType = `${GEN_MODULE}#RequestConfig`;

function attributes(element: ElementNode | RawElement, names: string[], ctx: ElaborationContext): Record<string, Attribute> {
  const result: Record<string, Attribute> = {};
  for (const attr of element.attributes) {
    if (!names.includes(attr.name)) ctx.fail("MARKUP_ATTRIBUTE", `Unknown ${element.tag} attribute ${attr.name}`, attr.span);
    if (result[attr.name]) ctx.fail("MARKUP_ATTRIBUTE", `Duplicate attribute ${attr.name}`, attr.span);
    result[attr.name] = attr;
  }
  return result;
}

function literal(attr: Attribute | undefined, name: string, element: ElementNode | RawElement, ctx: ElaborationContext): string {
  if (!attr) ctx.fail(name === "model" ? "GEN_MODEL_REQUIRED" : "MARKUP_ATTRIBUTE", `${name} is required`, element.span);
  if (attr.value.kind !== "literal" || !attr.value.text.trim()) ctx.fail(name === "model" ? "GEN_MODEL_REQUIRED" : "MARKUP_ATTRIBUTE", `${name} must be non-empty literal text`, attr.span);
  return attr.value.text;
}

function reference(attr: Attribute, type: string, ctx: ElaborationContext): Binding {
  if (attr.value.kind !== "ref") ctx.fail("MARKUP_REFERENCE", `${attr.name} must be a whole value reference`, attr.span);
  const binding = ctx.lookup(attr.value.name, attr.span);
  if (binding.type !== type) ctx.fail("TYPE_INVALID", `${attr.name} expects ${type}, received ${binding.type}`, attr.span);
  if (binding.kind === "record" && type !== textType) {
    try { validateMedia(binding.value.data, type === imageType ? "image" : type === videoType ? "video" : "audio"); }
    catch (error) { if (error instanceof DvError) ctx.fail(error.code, error.message, attr.span); throw error; }
  }
  return binding;
}

function empty(element: ElementNode, ctx: ElaborationContext): void {
  if (element.children.some((child) => child.kind !== "text" || child.text.trim())) ctx.fail("MARKUP_CHILD", `${element.tag} must be empty`, element.span);
}

function surface(kind: "image" | "video"): SurfaceDef {
  const name = kind === "image" ? "Image" : "Video";
  const params = kind === "image" ? ["ratio", "size", "quality", "count"] : ["duration", "resolution", "ratio", "audio"];
  return {
    mode: "structured",
    doc: {
      summary: `Generate paid ${kind} media with an explicitly enabled Dsivio model; publishes the first output.`,
      paid: true,
      attributes: [
        { name: "id", required: true, accepts: "text", summary: "Public output prefix." },
        { name: "model", required: true, accepts: "text", summary: "Exact enabled provider/model id; checked during plan." },
        { name: "prompt", required: true, accepts: `${textType} or literal text`, summary: "Non-empty prompt; a literal becomes private Text." },
        ...params.map((param) => ({ name: param, required: false, accepts: param === "audio" ? "boolean" : param === "count" || param === "duration" ? "number" : "text", summary: `Model-specific ${param}, validated against live capabilities; omitted values use backend defaults.` })),
        ...(kind === "video" ? ["first-frame", "last-frame"].map((param) => ({ name: param, required: false, accepts: imageType, summary: "Image value reference; support and frame constraints are checked during plan." })) : []),
      ],
      children: [
        { tag: "Reference", repeat: true, summary: kind === "image" ? "Empty child with exactly image={Image}; order is preserved." : "Empty child with exactly one of image={Image}, video={Video}, audio={Audio}; category order is preserved." },
        ...(kind === "video" ? [{ tag: "Option", repeat: true, summary: "Empty child with name, value, optional type (string default, number, boolean, json). Preserved in options; Dsivio currently rejects model-specific extras at plan." }] : []),
      ],
      outputs: [{ name: kind, type: kind === "image" ? imageType : videoType, summary: `First generated ${kind} resource.` }],
      example: `<gen:${name} id="shot" model="provider/model" prompt="Morning light"/>`,
    },
    elaborate(element, ctx: ElaborationContext) {
      if (element.kind !== "element") ctx.fail("MARKUP_ELEMENT", `${element.tag} requires structured markup`, element.span);
      const attrs = attributes(element, ["id", "model", "prompt", ...params, ...(kind === "video" ? ["first-frame", "last-frame"] : [])], ctx);
      const id = literal(attrs.id, "id", element, ctx);
      const model = literal(attrs.model, "model", element, ctx);
      const promptAttr = attrs.prompt;
      if (!promptAttr) ctx.fail("GEN_PROMPT_REQUIRED", "prompt is required", element.span);
      const prompt = promptAttr.value.kind === "ref" ? reference(promptAttr, textType, ctx) : ctx.record(null, { type: textType, data: literal(promptAttr, "prompt", element, ctx) }, promptAttr.span);
      const scalar: Record<string, Json> = {};
      for (const name of params) {
        const attr = attrs[name];
        if (!attr) continue;
        const value = literal(attr, name, element, ctx);
        if (name === "audio") {
          if (value !== "true" && value !== "false") ctx.fail("GEN_PARAM_INVALID", "audio must be true or false", attr.span);
          scalar[name] = value === "true";
        } else if (name === "duration" || name === "count") {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) ctx.fail("GEN_PARAM_INVALID", `${name} must be a positive integer`, attr.span);
          scalar[name] = Number(value);
        } else scalar[name] = value;
      }
      const inputs: Record<string, Binding | Binding[]> = { prompt };
      const options: Record<string, Json> = {};
      const refs: Record<string, Binding[]> = { images: [], videos: [], audios: [] };
      for (const [attrName, port] of [["first-frame", "firstFrame"], ["last-frame", "lastFrame"]] as const) {
        if (attrs[attrName]) inputs[port] = reference(attrs[attrName], imageType, ctx);
      }
      const prefix = element.tag.includes(":") ? element.tag.slice(0, element.tag.lastIndexOf(":") + 1) : "";
      for (const child of element.children) {
        if (child.kind === "text" && !child.text.trim()) continue;
        if (child.kind !== "element") ctx.fail("MARKUP_CHILD", `${element.tag} does not accept body text or raw children`, child.span);
        empty(child, ctx);
        if (child.tag === `${prefix}Reference`) {
          const childAttrs = attributes(child, kind === "image" ? ["image"] : ["image", "video", "audio"], ctx);
          const entries = Object.entries(childAttrs);
          if (entries.length !== 1) ctx.fail("GEN_REFERENCE_INVALID", "Reference requires exactly one image, video or audio reference", child.span);
          const [category, attr] = entries[0]!;
          refs[category === "image" ? "images" : category === "video" ? "videos" : "audios"]!.push(reference(attr, category === "image" ? imageType : category === "video" ? videoType : audioType, ctx));
        } else if (kind === "video" && child.tag === `${prefix}Option`) {
          const childAttrs = attributes(child, ["name", "value", "type"], ctx);
          const name = literal(childAttrs.name, "name", child, ctx);
          if (Object.hasOwn(options, name)) ctx.fail("GEN_OPTION_INVALID", `Duplicate option ${name}`, child.span);
          const value = literal(childAttrs.value, "value", child, ctx);
          const type = childAttrs.type ? literal(childAttrs.type, "type", child, ctx) : "string";
          let converted: Json = value;
          if (type === "number") {
            if (!value.trim() || !Number.isFinite(Number(value))) ctx.fail("GEN_OPTION_INVALID", `Option ${name} must be a finite number`, child.span);
            converted = Number(value);
          } else if (type === "boolean") {
            if (value !== "true" && value !== "false") ctx.fail("GEN_OPTION_INVALID", `Option ${name} must be true or false`, child.span);
            converted = value === "true";
          } else if (type === "json") {
            try { converted = JSON.parse(value) as Json; }
            catch (error) { ctx.fail("GEN_OPTION_INVALID", `Option ${name} must be valid JSON: ${String(error)}`, child.span); }
          } else if (type !== "string") ctx.fail("GEN_OPTION_INVALID", `Unknown option type ${type}; use string, number, boolean or json`, child.span);
          Object.defineProperty(options, name, { value: converted, enumerable: true, configurable: true, writable: true });
        } else ctx.fail("MARKUP_CHILD", `Unexpected child ${child.tag} in ${element.tag}`, child.span);
      }
      for (const [port, values] of Object.entries(refs)) if (values.length) inputs[port] = values;
      inputs.config = ctx.record(null, { type: configType, data: { model, params: scalar, options } }, element.span);
      ctx.operation({ producer: `${GEN_MODULE}#${kind}`, inputs, publish: { [kind]: `${id}.${kind}` }, label: id, span: element.span });
    },
  };
}

function producer(kind: "image" | "video"): ProducerDef {
  return {
    inputs: {
      config: { type: configType }, prompt: { type: textType }, images: { type: imageType, list: true, optional: true },
      ...(kind === "video" ? { firstFrame: { type: imageType, optional: true }, lastFrame: { type: imageType, optional: true }, videos: { type: videoType, list: true, optional: true }, audios: { type: audioType, list: true, optional: true } } : {}),
    },
    outputs: { [kind]: kind === "image" ? imageType : videoType },
    previewsPending: true,
    run(inputs) {
      const config = inputs.config;
      if (!config || Array.isArray(config) || isPending(config) || config.type !== configType || config.data === null || typeof config.data !== "object" || Array.isArray(config.data)) throw new DvError("GEN_REQUEST_INVALID", "Generation config must be a known RequestConfig");
      const data = config.data;
      if (typeof data.model !== "string" || !data.model.trim()) throw new DvError("GEN_MODEL_REQUIRED", "model is required");
      if (!data.params || typeof data.params !== "object" || Array.isArray(data.params) || !data.options || typeof data.options !== "object" || Array.isArray(data.options)) throw new DvError("GEN_REQUEST_INVALID", "Invalid generation config");
      const prompt = inputs.prompt;
      if (!prompt || Array.isArray(prompt) || prompt.type !== textType || (!isPending(prompt) && (typeof prompt.data !== "string" || !prompt.data.trim()))) throw new DvError("GEN_PROMPT_INVALID", "prompt must be non-empty Text");
      const request: Record<string, Json> = { model: data.model, prompt: isPending(prompt) ? { ...prompt } : prompt.data, params: data.params, options: data.options };
      const references: Record<string, Json[]> = {};
      for (const [port, category, type] of [["images", "image", imageType], ["videos", "video", videoType], ["audios", "audio", audioType]] as const) {
        const list = inputs[port];
        if (list !== undefined && !Array.isArray(list)) throw new DvError("GEN_REFERENCE_INVALID", `${port} must be a list`);
        references[port] = (list ?? []).map((value: InputValue) => {
          if (value.type !== type) throw new DvError("TYPE_INVALID", `${port} expects ${type}`);
          if (isPending(value)) return { ...value };
          validateMedia(value.data, category);
          return value.data;
        });
      }
      request.references = references;
      for (const port of ["firstFrame", "lastFrame"]) {
        const value = inputs[port];
        if (value === undefined) continue;
        if (Array.isArray(value) || value.type !== imageType) throw new DvError("TYPE_INVALID", `${port} expects Image`);
        if (isPending(value)) request[port] = { ...value };
        else { validateMedia(value.data, "image"); request[port] = value.data; }
      }
      return { needs: { [kind]: { capability: `gateway/${kind}`, request } } };
    },
  };
}

const gen: ModuleDef = {
  id: GEN_MODULE,
  summary: "Paid image and video generation through Dsivio's enabled models.",
  types: { RequestConfig: { summary: "Private authored model, parameters and options.", validate(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data) || typeof data.model !== "string" || !data.model.trim() || data.params === null || typeof data.params !== "object" || Array.isArray(data.params) || data.options === null || typeof data.options !== "object" || Array.isArray(data.options)) throw new DvError("TYPE_INVALID", "Invalid RequestConfig");
  } } },
  surfaces: { Image: surface("image"), Video: surface("video") },
  producers: { image: producer("image"), video: producer("video") },
};
export default gen;
