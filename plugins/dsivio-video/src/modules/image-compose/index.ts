import type { ModuleDef, ProducerInputs } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import { isPending } from "../../core/value.ts";
import { DvError } from "../../core/errors.ts";
import { input } from "../pipeline/index.ts";
import { composePlanType } from "../../components/image-compose/types.ts";
import { validateComposePlan } from "../../components/image-compose/validate.ts";
import { authorImage as decodeComposeImage, imageComposeCompanions } from "./studio.ts";
const imageType = "dsivio-video/media@1#Image";
function list(inputs: ProducerInputs, name: string): Json[] {
  const values = inputs[name]; if (!Array.isArray(values)) throw new DvError("PRODUCER_INPUT", `Missing list ${name}.`);
  return values.map(value => isPending(value) ? { ...value } : value.data);
}
const module: ModuleDef = {
  id: "dsivio-video/image-compose@1", summary: "Ordered straight-alpha image composition into a PNG canvas.",
  studio: imageComposeCompanions,
  types: { Plan: { summary: "Explicit RGBA background and 1..64 layer options.", validate: validateComposePlan } },
  surfaces: {
    Image: { mode: "structured", elaborate: decodeComposeImage, doc: { summary: "Compose existing images; later layers cover earlier layers.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Output identity." }, { name: "canvas", required: true, accepts: "dsivio-video/space@1#Canvas", summary: "Pixel canvas." }, { name: "background", required: false, accepts: "#RRGGBBAA", default: "#00000000", summary: "Straight alpha backdrop." }], children: [{ tag: "Layer", repeat: true, summary: "1..64 ordered image layers." }], outputs: [{ name: "image", type: imageType, summary: "Canvas-sized PNG." }] } },
    Layer: { mode: "structured", elaborate(node, ctx) { ctx.fail("RASTER_CHILD", "Layer is only valid inside Image.", node.span); }, doc: { summary: "Empty pixel-frame layer; off-canvas pixels are clipped.", attributes: [{ name: "source", required: true, accepts: imageType, summary: "Image bytes." }, { name: "frame", required: true, accepts: "dsivio-video/space@1#Frame", summary: "Frame on the same canvas." }, { name: "fit", required: false, accepts: "contain|cover|stretch", default: "contain", summary: "Image fit." }, { name: "interpolation", required: false, accepts: "nearest|linear|cubic|area|lanczos", default: "lanczos", summary: "Resampling." }, { name: "opacity", required: false, accepts: "0..1", default: "1", summary: "Multiply source alpha." }], outputs: [] } },
  },
  producers: { compose: { inputs: { canvas: { type: "dsivio-video/space@1#Canvas" }, plan: { type: composePlanType }, sources: { type: imageType, list: true }, frames: { type: "dsivio-video/space@1#Frame", list: true } }, outputs: { image: imageType }, previewsPending: true, run(inputs) {
    const plan = input(inputs, "plan"); validateComposePlan(plan);
    return { needs: { image: { capability: "local/raster", request: { action: "compose", canvas: input(inputs, "canvas"), plan, sources: list(inputs, "sources"), frames: list(inputs, "frames") } } } };
  } } },
};
export default module;
