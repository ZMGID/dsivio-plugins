import { basename, resolve } from "node:path";
import { DvError, spanAt } from "../core/errors.ts";
import type { SourceSpan } from "../core/errors.ts";
import type { RunIntent } from "../core/graph.ts";
import type { Attribute, MarkupDocument } from "../markup/ast.ts";
import { readHeader } from "../markup/header.ts";
import { parseMarkup } from "../markup/parse.ts";
import type { Workspace } from "../source/workspace.ts";

export function readRun(file: string, workspace: Workspace): RunIntent {
  file = workspace.resolveSource(resolve(file), `./${basename(file)}`);
  const text = workspace.readText(file);
  const start = spanAt(file, text, 0);
  const fail = (code: string, message: string, span: SourceSpan = start): never => { throw new DvError(code, message, { span }); };
  if (readHeader(file, text).using !== "dsivio-video/run@1") fail("UNKNOWN_FRONTEND", "Run requires dsivio-video/run@1");
  let doc: MarkupDocument;
  try { doc = parseMarkup(file, text, { isRaw: () => false }); }
  catch (cause) {
    if (!(cause instanceof DvError)) throw cause;
    const codes: Record<string, string> = { MARKUP_ROOT: "RUN_ROOT", MARKUP_ROOT_UNCLOSED: "RUN_ROOT", MARKUP_ROOT_CLOSE: "RUN_ROOT", MARKUP_ROOT_ATTRIBUTE: "RUN_ATTRIBUTE", MARKUP_BODY_TEXT: "RUN_TEXT", MARKUP_TRAILING: "RUN_TRAILING", MARKUP_ATTRIBUTE: "RUN_ATTRIBUTE", MARKUP_ATTRIBUTE_DUPLICATE: "RUN_DUPLICATE", MARKUP_REFERENCE: "RUN_ATTRIBUTE" };
    const code = cause.code.startsWith("MARKUP_IMPORT") ? "RUN_CHILD" : codes[cause.code] ?? cause.code;
    throw new DvError(code, cause.message, { span: cause.span, cause });
  }
  if (doc.root !== "dvrun") fail("RUN_ROOT", "Run root must be dvrun");
  const attrs = (attributes: Attribute[], allowed: string[], span: SourceSpan): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const attr of attributes) {
      if (!allowed.includes(attr.name) || attr.value.kind !== "literal") fail("RUN_ATTRIBUTE", `Invalid attribute ${attr.name}`, attr.span);
      if (Object.hasOwn(values, attr.name)) fail("RUN_DUPLICATE", `Duplicate attribute ${attr.name}`, attr.span);
      const value = attr.value.kind === "literal" ? attr.value.text.trim() : "";
      if (!value) fail("RUN_ATTRIBUTE", `Attribute ${attr.name} cannot be empty`, attr.span);
      values[attr.name] = value;
    }
    for (const name of allowed) if (!Object.hasOwn(values, name)) fail(name === "version" ? "RUN_VERSION" : "RUN_ATTRIBUTE", `Missing attribute ${name}`, span);
    return values;
  };
  if (attrs(doc.rootAttributes, ["version"], start).version !== "1") fail("RUN_VERSION", "Only run version 1 is supported");
  if (doc.imports.length) fail("RUN_CHILD", "Run imports are not supported", doc.imports[0]!.span);
  const run: RunIntent = { file, author: "", targets: [], targetSpans: new Map(), candidates: new Map(), satisfy: new Map(), satisfySpans: new Map() };
  const allowed: Record<string, string[]> = { author: ["source"], target: ["output"], file: ["id", "type", "from", "media-type"], value: ["id", "type", "from"], "build-record": ["id", "build", "output"], satisfy: ["output", "candidate"] };
  for (const [index, node] of doc.body.entries()) {
    if (!Object.hasOwn(allowed, node.tag)) fail("RUN_CHILD", `Unsupported run child ${node.tag}`, node.span);
    if (node.kind === "raw") throw new DvError("RUN_CHILD", "Run children must be structured", { span: node.span });
    for (const child of node.children) {
      if (child.kind === "text" && child.text.trim()) fail("RUN_TEXT", "Run declarations cannot contain text", child.span);
      if (child.kind !== "text") fail("RUN_CHILD", "Run declarations cannot contain children", child.span);
    }
    const values = attrs(node.attributes, allowed[node.tag]!, node.span);
    if (node.tag === "author") {
      if (index !== 0 || run.author) fail("RUN_AUTHOR_ORDER", "Author must be the first and only author declaration", node.span);
      run.author = workspace.resolveSource(file, values.source!);
      continue;
    }
    if (!run.author) fail("RUN_AUTHOR_ORDER", "Author must come before other declarations", node.span);
    if (node.tag === "target") {
      if (run.targets.includes(values.output!)) fail("RUN_DUPLICATE", `Duplicate target ${values.output}`, node.span);
      run.targets.push(values.output!);
      run.targetSpans.set(values.output!, node.attributes.find((attr) => attr.name === "output")!.value.span);
    } else if (node.tag === "satisfy") {
      if (run.satisfy.has(values.output!)) fail("RUN_SATISFACTION_DUPLICATE", `Duplicate satisfaction for ${values.output}`, node.span);
      run.satisfy.set(values.output!, values.candidate!);
      run.satisfySpans.set(values.output!, node.span);
    } else {
      const name = values.id!;
      if (run.candidates.has(name)) fail("RUN_DUPLICATE", `Duplicate candidate ${name}`, node.span);
      if (node.tag === "build-record") run.candidates.set(name, { kind: "build", name, build: values.build!, output: values.output!, span: node.span });
      else {
        if (!/^[^\s#]+@[^\s#]+#[^\s#]+$/.test(values.type!)) fail("RUN_TYPE", `Invalid type address ${values.type}`, node.span);
        // Resolve selected candidates during planning, so unused bad paths remain inert.
        const path = resolve(file, "..", values.from!);
        if (!values.from!.startsWith("./") && !values.from!.startsWith("../")) fail("RUN_ATTRIBUTE", "Candidate paths must start with ./ or ../", node.span);
        if (node.tag === "file") {
          if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(values["media-type"]!)) fail("RUN_MEDIA_TYPE", "A concrete media type is required", node.span);
          run.candidates.set(name, { kind: "file", name, type: values.type!, path, mime: values["media-type"]!, span: node.span });
        } else run.candidates.set(name, { kind: "value", name, type: values.type!, path, span: node.span });
      }
    }
  }
  if (!run.author) fail("RUN_AUTHOR_MISSING", "Run requires an author");
  if (!run.targets.length) fail("RUN_TARGETS", "Run requires at least one target");
  return run;
}
