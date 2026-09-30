import { DvError } from "../../core/errors.ts";
import { modules } from "../../modules/index.ts";
import { runDsivio } from "../../gateway/dsivio.ts";
import type { CliOptions } from "../options.ts";
import { stringOption, usage } from "../options.ts";
import { openWorkspace } from "../project.ts";
import { result } from "../output.ts";
export async function vocabularyCommand(options: CliOptions): Promise<number> {
  const workspace = openWorkspace(options);
  const kind = stringOption(options, "kind");
  if (kind !== undefined && kind !== "image" && kind !== "video") usage("--kind must be image or video.");
  if (kind && !options.values.models) usage("--kind requires --models.");
  if (options.values.models) {
    if (options.positionals.length || options.values.tag) usage("--models cannot be combined with modules or --tag.");
    const reply = await runDsivio(["media", "models", ...(kind ? ["--kind", kind] : [])], workspace.root, AbortSignal.timeout(10_000));
    if (reply.code !== 0) throw new DvError(reply.code === 6 ? "GATEWAY_UNAVAILABLE" : "GATEWAY_MODELS_FAILED", reply.code === 6 ? "Open Dsivio to list live models." : `Model query failed: ${reply.stderr || reply.stdout}`);
    const models: unknown = JSON.parse(reply.stdout);
    if (!Array.isArray(models)) throw new DvError("GATEWAY_RESPONSE_INVALID", "Models must be an array.");
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
