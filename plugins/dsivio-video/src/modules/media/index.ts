import { DvError } from "../../core/errors.ts";
import type { ElaborationContext, ModuleDef, SurfaceDef } from "../../core/module.ts";
import { isResourceRef } from "../../core/value.ts";
import type { Json } from "../../core/value.ts";

export const MEDIA_MODULE = "dsivio-video/media@1";
export const imageType = `${MEDIA_MODULE}#Image`;
export const videoType = `${MEDIA_MODULE}#Video`;
export const audioType = `${MEDIA_MODULE}#Audio`;

export function validateMedia(data: Json, kind: "image" | "video" | "audio"): void {
  if (!isResourceRef(data) || !data.$resource || typeof data.bytes !== "number" || !Number.isSafeInteger(data.bytes) || data.bytes < 0 || typeof data.mime !== "string" || !data.mime.startsWith(`${kind}/`) || data.mime.length === kind.length + 1 || Object.keys(data).some((key) => !["$resource", "bytes", "mime"].includes(key))) {
    throw new DvError("TYPE_INVALID", `Expected exactly one ${kind}/ ResourceRef with an id, byte count and MIME type`);
  }
}

const mimes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac", opus: "audio/opus",
};

function surface(name: "Image" | "Video" | "Audio"): SurfaceDef {
  const kind = name.toLowerCase();
  const type = `${MEDIA_MODULE}#${name}`;
  return {
    mode: "structured",
    doc: {
      summary: `Import a project ${kind} file as a resource.`,
      attributes: [
        { name: "id", required: true, accepts: "text", summary: "Public record name." },
        { name: "src", required: true, accepts: "text", summary: "Project-relative file locator, starting with ./ or ../." },
        { name: "mime", required: false, accepts: "text", summary: `A ${kind}/ MIME type; required for unknown extensions.` },
      ],
      outputs: [{ name: "", type, summary: `Imported ${kind} resource.` }],
      example: `<media:${name} id="source" src="./source.${name === "Image" ? "png" : name === "Video" ? "mp4" : "wav"}"/>`,
    },
    elaborate(element, ctx: ElaborationContext) {
      if (element.kind !== "element") ctx.fail("MARKUP_ELEMENT", `media:${name} requires a structured element`, element.span);
      const attrs: Record<string, string> = {};
      for (const attr of element.attributes) {
        if (!["id", "src", "mime"].includes(attr.name)) ctx.fail("MARKUP_ATTRIBUTE", `Unknown media:${name} attribute ${attr.name}`, attr.span);
        if (attr.name in attrs) ctx.fail("MARKUP_ATTRIBUTE", `Duplicate attribute ${attr.name}`, attr.span);
        if (attr.value.kind !== "literal") ctx.fail("MARKUP_ATTRIBUTE", `${attr.name} must be literal text`, attr.span);
        attrs[attr.name] = attr.value.text;
      }
      if (!attrs.id) ctx.fail("MARKUP_ATTRIBUTE", "id is required", element.span);
      if (!attrs.src) ctx.fail("MARKUP_ATTRIBUTE", "src is required", element.span);
      if (element.children.some((child) => child.kind !== "text" || child.text.trim())) ctx.fail("MARKUP_CHILD", `media:${name} must be empty`, element.span);
      const extension = /\.([^./\\]+)$/.exec(attrs.src)?.[1]?.toLowerCase();
      const mime = attrs.mime ?? (extension ? mimes[extension] : undefined);
      if (!mime) ctx.fail("MEDIA_MIME_REQUIRED", `Cannot infer MIME for ${attrs.src}; specify mime explicitly`, element.span);
      if (!mime.startsWith(`${kind}/`) || mime.length === kind.length + 1) ctx.fail("TYPE_INVALID", `media:${name} requires a ${kind}/ MIME type, received ${mime}`, element.span);
      const binding = ctx.asset(attrs.src, type, mime, element.span);
      if (binding.kind !== "record") ctx.fail("TYPE_INVALID", "An imported asset must be a record", element.span);
      ctx.record(attrs.id, binding.value, element.span);
    },
  };
}

const media: ModuleDef = {
  id: MEDIA_MODULE,
  summary: "Project image, video and audio resources.",
  types: {
    Image: { summary: "One image resource.", validate: (data) => validateMedia(data, "image") },
    Video: { summary: "One video resource.", validate: (data) => validateMedia(data, "video") },
    Audio: { summary: "One audio resource.", validate: (data) => validateMedia(data, "audio") },
  },
  surfaces: { Image: surface("Image"), Video: surface("Video"), Audio: surface("Audio") },
  producers: {},
};
export default media;
