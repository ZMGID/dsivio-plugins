import type { ModuleDef, SurfaceDef } from "../../core/module.ts";
import type { Json } from "../../core/value.ts";
import { input } from "../pipeline/index.ts";
import { imageProgramType } from "../../components/image-transform/types.ts";
import { validateImageProgram } from "../../components/image-transform/validate.ts";
import { operationAttributes } from "../../components/image-transform/author.ts";
import { authorProgram as decodeImageProgram, authorTransform as decodeImageTransform, imageTransformCompanions } from "./studio.ts";
const imageType = "dsivio-video/media@1#Image";
const operationSurfaces: Record<string, SurfaceDef> = {};
for (const [tag, specs] of Object.entries(operationAttributes)) {
  operationSurfaces[tag] = {
    mode: "structured",
    elaborate(node, ctx) { ctx.fail("RASTER_CHILD", `${tag} is only valid inside Program.`, node.span); },
    doc: {
      summary: "Empty raster operation; numerical limits checked before execution.",
      attributes: specs.map(spec => ({ name: spec.name, required: spec.required ?? false, accepts: spec.accepts, ...(spec.default === undefined ? {} : { default: String(spec.default) }), summary: `Raster ${spec.name}.` })),
      outputs: [],
    },
  };
}
const module: ModuleDef = {
  id: "dsivio-video/image-transform@1", summary: "Reusable ordered deterministic raster image operations, executed locally.",
  studio: imageTransformCompanions,
  types: { Program: { summary: "Nonempty ordered image operations; encode occurs only last.", validate: validateImageProgram } },
  surfaces: {
    Program: { mode: "structured", elaborate: decodeImageProgram, doc: { summary: "Reusable ordered image program.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Program name." }], children: Object.keys(operationAttributes).map(tag => ({ tag, repeat: true, summary: "Empty ordered raster operation." })), outputs: [{ name: "", type: imageProgramType, summary: "Image program." }] } },
    Transform: { mode: "structured", elaborate: decodeImageTransform, doc: { summary: "Apply program to an existing image, with no paid generation.", attributes: [{ name: "id", required: true, accepts: "text", summary: "Output identity." }, { name: "source", required: true, accepts: imageType, summary: "Existing image." }, { name: "program", required: true, accepts: imageProgramType, summary: "Ordered operations." }], outputs: [{ name: "image", type: imageType, summary: "PNG unless program ends with JPEG/WebP Encode." }] } },
    ...operationSurfaces,
  },
  producers: { transform: { inputs: { source: { type: imageType }, program: { type: imageProgramType } }, outputs: { image: imageType }, previewsPending: true, run(inputs) {
    const program = input(inputs, "program"); validateImageProgram(program);
    return { needs: { image: { capability: "local/raster", request: { action: "edit", source: input(inputs, "source"), orderedSteps: program.orderedSteps as unknown as Json } } } };
  } } },
};
export default module;
