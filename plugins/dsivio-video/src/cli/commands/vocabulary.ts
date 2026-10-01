import { DvError } from "../../core/errors.ts";
import { modules } from "../../modules/index.ts";
import { gatewayModels } from "../../gateway/backend.ts";
import type { MediaKind } from "../../gateway/request.ts";
import type { CliOptions } from "../options.ts";
import { stringOption, usage } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
export async function vocabularyCommand(options: CliOptions): Promise<number> {
  const workspace = openWorkspace(options);
  const kind = stringOption(options, "kind");
  if (kind !== undefined && !["image", "video", "speech", "transcribe", "matting"].includes(kind)) usage("--kind must be image, video, speech, transcribe or matting.");
  if (kind && !options.values.models) usage("--kind requires --models.");
  if (options.values.models) {
    if (options.positionals.length || options.values.tag) usage("--models cannot be combined with modules or --tag.");
    const models = kind === "matting" ? [] : await gatewayModels({ projectRoot: workspace.root, signal: AbortSignal.timeout(10_000) }, kind as MediaKind | undefined);
    result(options, { projectRoot: workspace.root, models }, models.map((model: unknown) => JSON.stringify(model)));
    return 0;
  }
  const selected = options.positionals.length ? options.positionals.map((name) => {
    const module = modules.find((item) => item.id === name || item.id.replace(/@\d+$/, "") === name);
    if (!module) throw new DvError("UNKNOWN_MODULE_IMPORT", `Unknown module ${name}.`);
    return module;
  }) : modules;
  const tags = options.values.tag;
  if (tags && !options.positionals.length) usage("--tag requires a module name.");
  const packages = selected.map((module) => ({ name: module.id, tags: Object.keys(module.surfaces).sort(), description: module.summary }));
  const surfaces = options.positionals.length ? selected.flatMap((module) => Object.entries(module.surfaces).filter(([tag]) => !Array.isArray(tags) || tags.includes(tag)).map(([tag, surface]) => ({ module: module.id, name: tag, tag, mode: surface.mode, ...surface.doc, paid: surface.doc.paid ?? false }))) : [];
  const lines = options.positionals.length ? surfaces.flatMap((surface) => [
    `${surface.module} ${surface.tag} (${surface.mode}${surface.paid ? ", paid" : ""})`, surface.summary,
    ...surface.attributes.map((attr) => `  ${attr.name}${attr.required ? "*" : "?"}: ${attr.accepts}${attr.default === undefined ? "" : ` (default ${attr.default})`} — ${attr.summary}`),
    ...(surface.children ?? []).map((child) => `  child ${child.tag}${child.repeat ? " (repeatable)" : ""}: ${child.summary}`),
    ...surface.outputs.map((output) => `  output ${output.name || "id"}: ${output.type} — ${output.summary}`),
    ...(surface.example ? [surface.example] : []),
  ]) : packages.map((item) => `${item.name} [${item.tags.join(", ")}] — ${item.description}`);
  result(options, { projectRoot: workspace.root, packages, ...(options.positionals.length ? { surfaces } : {}) }, lines);
  return 0;
}
