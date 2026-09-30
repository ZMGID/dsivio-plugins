import { createHash, randomBytes } from "node:crypto";
import { basename, resolve } from "node:path";
import { DvError, spanAt } from "../core/errors.ts";
import type { SourceSpan } from "../core/errors.ts";
import type { AuthorGraph, InputSource } from "../core/graph.ts";
import type { Binding, ElaborationContext, FrontendDef, ModuleDef, ProducerDef, SurfaceDef } from "../core/module.ts";
import { validateValue } from "../core/validate.ts";
import type { ResourceRef, Value } from "../core/value.ts";
import { readHeader } from "../markup/header.ts";
import { parseMarkup } from "../markup/parse.ts";
import { parseDvs } from "../markup/dvs.ts";
import type { ImportDecl } from "../markup/ast.ts";
import type { Workspace } from "../source/workspace.ts";
import * as builtins from "../modules/index.ts";

export interface AuthorRegistry {
  findModule(id: string): ModuleDef | undefined;
  findProducer(ref: string): ProducerDef | undefined;
  findFrontend(using: string): FrontendDef | undefined;
}

export function compileAuthor(entry: string, workspace: Workspace, registry: AuthorRegistry = builtins): AuthorGraph {
  const source = workspace.resolveSource(resolve(entry), `./${basename(entry)}`);
  const graph: AuthorGraph = { source, sources: [], records: new Map(), operations: new Map(), outputs: new Map(), publicRecords: new Map(), assets: new Map(), modules: [] };
  const cache = new Map<string, Map<string, Binding>>();
  const active = new Set<string>();
  const usedModules = new Set<string>();
  const assetsByPath = new Map<string, { ref: ResourceRef; binding: Binding }>();
  const fail = (code: string, message: string, span: SourceSpan): never => { throw new DvError(code, message, { span }); };
  const validate = (value: Value, span: SourceSpan): void => {
    const hash = value.type.lastIndexOf("#");
    const owner = registry.findModule(value.type.slice(0, hash));
    const type = hash < 0 ? undefined : owner?.types[value.type.slice(hash + 1)];
    validateValue(value, type, span);
    usedModules.add(owner!.id);
  };
  const surfacesFor = (imports: readonly ImportDecl[]): Map<string, SurfaceDef> => {
    const surfaces = new Map<string, SurfaceDef>();
    for (const decl of imports) {
      if (!decl.from) continue;
      const module = registry.findModule(decl.from);
      if (!module) fail("UNKNOWN_MODULE_IMPORT", `Unknown module ${decl.from}`, decl.span);
      usedModules.add(module!.id);
      for (const [tag, surface] of Object.entries(module!.surfaces)) {
        const name = decl.as ? `${decl.as}:${tag}` : tag;
        if (surfaces.has(name)) fail("MARKUP_SURFACE_COLLISION", `Surface ${name} is already bound`, decl.span);
        surfaces.set(name, surface);
      }
    }
    return surfaces;
  };
  const compile = (file: string, importSpan?: SourceSpan): Map<string, Binding> => {
    if (active.has(file)) throw new DvError("SOURCE_IMPORT_CYCLE", `Source import cycle at ${file}`, { span: importSpan });
    const cached = cache.get(file);
    if (cached) return cached;
    active.add(file);
    graph.sources.push(file);
    const text = workspace.readText(file);
    const header = readHeader(file, text);
    const unit = createHash("sha256").update(file).digest("hex").slice(0, 16);
    let sequence = 0;
    const local = new Map<string, Binding>();
    const imported = new Map<string, Binding>();
    const publish = (name: string, binding: Binding, span: SourceSpan): void => {
      if (!name.trim()) fail("EMPTY_LOGICAL_OUTPUT_ID", "Public names cannot be empty", span);
      if (local.has(name) || imported.has(name)) fail(binding.kind === "record" ? "MARKUP_RECORD_DUPLICATE" : "DUPLICATE_LOGICAL_OUTPUT_ID", `Duplicate public name ${name}`, span);
      local.set(name, binding);
    };
    const ctx: ElaborationContext = {
      file,
      fail,
      lookup(name, span) { const binding = local.get(name) ?? imported.get(name); if (!binding) fail("MARKUP_REFERENCE", `Unknown reference ${name}`, span); return binding!; },
      record(name, value, span) {
        validate(value, span);
        const key = `${unit}:record:${sequence++}`;
        const binding: Binding = { kind: "record", key, type: value.type, value };
        graph.records.set(key, { key, value, span });
        if (name !== null) publish(name, binding, span);
        return binding;
      },
      operation(spec) {
        const producer = registry.findProducer(spec.producer);
        if (!producer) fail("UNKNOWN_PRODUCER", `Unknown producer ${spec.producer}`, spec.span);
        usedModules.add(spec.producer.slice(0, spec.producer.lastIndexOf("#")));
        const key = `${unit}:operation:${sequence++}`;
        const inputs: Record<string, InputSource | InputSource[]> = {};
        const supplied = Object.keys(spec.inputs);
        if (supplied.some((port) => !producer!.inputs[port]) || Object.entries(producer!.inputs).some(([port, def]) => !def.optional && !Object.hasOwn(spec.inputs, port))) fail("AUTHOR_PORT_BINDING_MISMATCH", `Invalid input ports for ${spec.producer}`, spec.span);
        for (const [port, input] of Object.entries(spec.inputs)) {
          const def = producer!.inputs[port]!;
          if (Array.isArray(input) !== !!def.list) fail("AUTHOR_PORT_BINDING_MISMATCH", `Port ${port} ${def.list ? "requires" : "does not accept"} a list`, spec.span);
          const convert = (binding: Binding): InputSource => {
            if (binding.type !== def.type) fail("AUTHOR_INPUT_TYPE_MISMATCH", `Port ${port} expects ${def.type}, received ${binding.type}`, spec.span);
            return binding.kind === "record" ? { record: binding.key } : { operation: binding.operation, port: binding.port };
          };
          inputs[port] = Array.isArray(input) ? input.map(convert) : convert(input);
        }
        const outputs: Record<string, Binding> = {};
        for (const [port, type] of Object.entries(producer!.outputs)) {
          const hash = type.lastIndexOf("#");
          if (hash < 0 || !registry.findModule(type.slice(0, hash))?.types[type.slice(hash + 1)]) fail("UNKNOWN_TYPE", `Unknown type ${type}`, spec.span);
          outputs[port] = { kind: "output", key: `${key}.${port}`, operation: key, port, type };
        }
        for (const [port, name] of Object.entries(spec.publish)) {
          if (!outputs[port]) fail("AUTHOR_PORT_BINDING_MISMATCH", `Unknown output port ${port}`, spec.span);
          publish(name, outputs[port]!, spec.span);
        }
        graph.operations.set(key, { key, producer: spec.producer, label: spec.label, inputs, outputs: { ...producer!.outputs }, span: spec.span });
        return outputs;
      },
      asset(locator, type, mime, span) {
        const path = workspace.resolveAsset(file, locator);
        const mediaType = mime ?? "application/octet-stream";
        const existing = assetsByPath.get(path);
        if (existing) {
          if (existing.ref.mime !== mediaType) fail("SOURCE_ASSET_MEDIA_TYPE_CONFLICT", `Conflicting media types for ${locator}`, span);
          if (existing.binding.type === type) return existing.binding;
        }
        const ref = existing?.ref ?? { $resource: `res_${randomBytes(16).toString("hex")}`, bytes: workspace.statFile(path, span), mime: mediaType };
        graph.assets.set(ref.$resource, { path, ref });
        const binding = ctx.record(null, { type, data: { $resource: ref.$resource, bytes: ref.bytes, mime: ref.mime } }, span);
        assetsByPath.set(path, { ref, binding });
        return binding;
      },
    };
    if (header.using === "dsivio-video/markup@1") {
      let surfaces: Map<string, SurfaceDef> | undefined;
      const document = parseMarkup(file, text, { isRaw(tag, imports) {
        if (tag === "import") return false;
        surfaces ??= surfacesFor(imports);
        return surfaces.get(tag)?.mode === "raw";
      } });
      if (document.root !== "dvml") throw new DvError("MARKUP_ROOT", "Author source requires a dvml root", { span: spanAt(file, text, header.bodyStart) });
      surfaces ??= surfacesFor(document.imports);
      for (const decl of document.imports) {
        if (!decl.source) continue;
        const child = workspace.resolveSource(file, decl.source);
        for (const [name, binding] of compile(child, decl.span)) {
          const qualified = `${decl.as}.${name}`;
          if (imported.has(qualified)) fail("MARKUP_SOURCE_EXPORT_COLLISION", `Duplicate imported name ${qualified}`, decl.span);
          imported.set(qualified, binding);
        }
      }
      for (const element of document.body) {
        const surface = surfaces.get(element.tag);
        if (!surface) fail("MARKUP_UNKNOWN_SURFACE", `Unknown surface ${element.tag}`, element.span);
        surface!.elaborate(element, ctx);
      }
    } else {
      const frontend = registry.findFrontend(header.using);
      if (!frontend) throw new DvError("UNKNOWN_FRONTEND", `Unknown frontend ${header.using}`, { span: spanAt(file, text, 0, header.bodyStart) });
      const sheet = parseDvs(file, text);
      frontend!.compile(sheet, { record: (name, value, span) => { ctx.record(name, value, span); }, fail });
    }
    const exports = new Map([...imported, ...local]);
    cache.set(file, exports);
    active.delete(file);
    return exports;
  };
  for (const [name, binding] of compile(source)) {
    if (binding.kind === "record") graph.publicRecords.set(name, binding.key);
    else graph.outputs.set(name, { name, type: binding.type, operation: binding.operation, port: binding.port });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    const operation = graph.operations.get(key);
    if (!operation) throw new DvError("UNKNOWN_AUTHOR_COMPONENT", `Unknown operation ${key}`);
    if (visiting.has(key)) fail("AUTHOR_COMPONENT_CYCLE", `Operation cycle at ${operation.label}`, operation.span);
    if (visited.has(key)) return;
    visiting.add(key);
    const producer = registry.findProducer(operation.producer)!;
    for (const [port, source] of Object.entries(operation.inputs)) {
      for (const input of Array.isArray(source) ? source : [source]) {
        let actualType: string | undefined;
        if ("operation" in input) {
          actualType = graph.operations.get(input.operation)?.outputs[input.port];
          if (actualType === undefined) fail("UNKNOWN_AUTHOR_OUTPUT", `Unknown operation output ${input.operation}.${input.port}`, operation.span);
          visit(input.operation);
        } else {
          actualType = graph.records.get(input.record)?.value.type;
          if (actualType === undefined) fail("UNKNOWN_AUTHOR_RECORD", `Unknown record ${input.record}`, operation.span);
        }
        if (actualType !== producer.inputs[port]!.type) fail("AUTHOR_INPUT_TYPE_MISMATCH", `Port ${port} expects ${producer.inputs[port]!.type}, received ${actualType}`, operation.span);
      }
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of graph.operations.keys()) visit(key);
  graph.modules = [...usedModules].sort();
  return graph;
}
