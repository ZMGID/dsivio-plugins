import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { DvError } from "../core/errors.ts";
import { canonicalJson, isPending, isResourceRef } from "../core/value.ts";
import type { Json } from "../core/value.ts";

export interface ModelDescription {
  descriptionVersion: number; identity: string; operation: string; factsRevision: string; factsComplete: boolean;
  arguments: Record<string, ArgumentDescription>; constraints: Constraint[];
  products: Record<string, Json>; lifecycle: Record<string, Json>; billingInfo: Json;
  [key: string]: unknown;
}
export interface ArgumentDescription {
  dataType: "string" | "boolean" | "integer" | "number" | "mediaList";
  required?: boolean; allowed?: Json[]; specialValues?: Json[]; defaultValue?: Json;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; lengthUnit?: string;
  minCount?: number; maxCount?: number; mimePatterns?: string[]; rejectedMime?: string[];
  locations?: string[]; maxBytes?: number; entryAttributes?: Record<string, unknown>;
  derivedFrom?: unknown; transport?: { flag?: string; optionKey?: string; encoding: string };
  [key: string]: unknown;
}
export type Condition = { provided: string } | { equals: { argument: string; value: Json } } | { all: Condition[] } | { any: Condition[] } | { not: Condition };
export interface Constraint { ruleId: string; when?: Condition; check: string; arguments: string[]; presenceMode?: "truthy" | "provided"; limit?: number; weights?: Record<string, number>; allowed?: Json[] }
export interface ModelEntry { id: string; providerId: string; providerName: string; model: string; kind: string; default: boolean; known: boolean; capabilities: Json; description: ModelDescription; [key: string]: unknown }
export function factsRevision(description: object): string {
  const { factsRevision: _revision, ...content } = description as Record<string, unknown>;
  return `sha256:${createHash("sha256").update(canonicalJson(content as Json)).digest("hex")}`;
}
export function withFactsRevision<T extends object>(description: T): T & { factsRevision: string } { return { ...description, factsRevision: factsRevision(description) }; }
export class ModelArgumentError extends DvError {
  readonly detail: { code: string; argumentPath: string; ruleId: string | null; actual: Json; expected: Json; message: string };
  constructor(code: string, path: string, actual: Json, expected: Json, message: string, ruleId: string | null = null) {
    super(code, message); this.detail = { code, argumentPath: path, ruleId, actual, expected, message };
  }
}
const object = (v: unknown): v is Record<string, Json> => v !== null && typeof v === "object" && !Array.isArray(v);
const pending = (v: unknown): boolean => isPending(v) || (Array.isArray(v) ? v.some(pending) : object(v) && Object.values(v).some(pending));
function invalid(message: string): never { throw new DvError("MODEL_DESCRIPTION_INVALID", message); }
const aliases: Record<string, string> = { aspect_ratio: "aspectRatio", output_format: "outputFormat" };
export function validateDescription(d: ModelDescription): void {
  if (!object(d) || d.descriptionVersion !== 1 || typeof d.identity !== "string" || !d.identity.trim() || !["image", "video", "speech", "transcribe"].includes(d.operation) || typeof d.factsComplete !== "boolean" || !object(d.arguments) || !Array.isArray(d.constraints) || !object(d.products) || !object(d.lifecycle) || d.factsRevision !== factsRevision(d)) invalid("Model description revision or structure is invalid");
  const names = new Set(Object.keys(d.arguments)), transports = new Set<string>();
  const condition = (c: Condition): void => {
    if (!object(c) || Object.keys(c).length !== 1) invalid("Invalid model condition");
    if ("provided" in c) { if (!names.has(c.provided as string)) invalid("Dangling provided argument"); }
    else if ("equals" in c) { if (!object(c.equals) || !names.has(c.equals.argument as string) || !Object.hasOwn(c.equals, "value")) invalid("Invalid equals condition"); }
    else if ("all" in c || "any" in c) { const items = "all" in c ? c.all : c.any; if (!Array.isArray(items)) invalid("Invalid condition list"); for (const item of items) condition(item); }
    else if ("not" in c) condition(c.not); else invalid("Unknown condition operation");
  };
  const edges = new Map<string, string[]>();
  for (const [name, arg] of Object.entries(d.arguments)) {
    if (!object(arg) || !["string", "boolean", "integer", "number", "mediaList"].includes(arg.dataType)) invalid(`Invalid dataType for ${name}`);
    if (arg.required !== undefined && typeof arg.required !== "boolean") invalid(`Invalid required flag for ${name}`);
    for (const field of ["minimum", "maximum", "multipleOf", "minAspectRatio", "maxAspectRatio", "minDuration", "maxDuration", "minFrameRate", "maxFrameRate"] as const) if (arg[field] !== undefined && (typeof arg[field] !== "number" || !Number.isFinite(arg[field]))) invalid(`Invalid numeric ${field} for ${name}`);
    for (const field of ["minLength", "maxLength", "minCount", "maxCount", "maxBytes", "minWidth", "maxWidth", "minHeight", "maxHeight"] as const) if (arg[field] !== undefined && (!Number.isSafeInteger(arg[field]) || (arg[field] as number) < 0)) invalid(`Invalid ${field} for ${name}`);
    for (const [lower, upper] of [["minimum", "maximum"], ["minLength", "maxLength"], ["minCount", "maxCount"], ["minWidth", "maxWidth"], ["minHeight", "maxHeight"], ["minDuration", "maxDuration"], ["minFrameRate", "maxFrameRate"], ["minAspectRatio", "maxAspectRatio"]] as const) if (typeof arg[lower] === "number" && typeof arg[upper] === "number" && arg[lower] > arg[upper]) invalid(`Reversed domain for ${name}`);
    if (arg.multipleOf !== undefined && (arg.multipleOf as number) <= 0) invalid(`Invalid multipleOf for ${name}`);
    for (const field of ["allowed", "specialValues", "mimePatterns", "rejectedMime", "locations", "allowedCodecs", "allowedAudioCodecs"] as const) if (arg[field] !== undefined && !Array.isArray(arg[field])) invalid(`Invalid ${field} for ${name}`);
    if (arg.transport !== undefined && (!object(arg.transport) || !["scalar", "utf8-file", "options-json"].includes(arg.transport.encoding) || arg.transport.optionKey !== undefined && typeof arg.transport.optionKey !== "string" || arg.transport.flag !== undefined && typeof arg.transport.flag !== "string")) invalid(`Invalid transport for ${name}`);
    if (arg.transport?.optionKey) { if (transports.has(arg.transport.optionKey)) invalid("Duplicate transport optionKey"); transports.add(arg.transport.optionKey); }
    if (arg.derivedFrom !== undefined) {
      const derive = arg.derivedFrom as { operation?: string; argument?: string; kind?: string; source?: string };
      const operation = typeof arg.derivedFrom === "string" ? arg.derivedFrom : derive.operation ?? derive.kind;
      if (!["imageAspectRatio", "videoDuration"].includes(String(operation))) invalid("Unknown derive operation");
      const source = derive.argument ?? derive.source; if (source) { if (!names.has(source)) invalid("Dangling derive source"); edges.set(name, [source]); }
    }
  }
  const visit = (name: string, stack: Set<string>): void => { if (stack.has(name)) invalid("Cyclic derived defaults"); const next = new Set(stack).add(name); for (const source of edges.get(name) ?? []) visit(source, next); };
  for (const name of names) visit(name, new Set());
  for (const rule of d.constraints) {
    if (!rule || typeof rule.ruleId !== "string" || !rule.ruleId || !["require", "excludeTogether", "countAtMost", "weightedCountAtMost", "durationTotalAtMost", "restrictAllowed"].includes(rule.check) || !Array.isArray(rule.arguments) || rule.arguments.some(a => !names.has(a)) || rule.presenceMode !== undefined && !["truthy", "provided"].includes(rule.presenceMode)) invalid("Invalid model constraint");
    if (["countAtMost", "weightedCountAtMost", "durationTotalAtMost"].includes(rule.check) && (typeof rule.limit !== "number" || !Number.isFinite(rule.limit) || rule.limit < 0)) invalid("Invalid model constraint limit");
    if (rule.check === "restrictAllowed" && !Array.isArray(rule.allowed)) invalid("Invalid restricted argument domain");
    if (rule.weights && (!object(rule.weights) || Object.entries(rule.weights).some(([name, weight]) => !names.has(name) || typeof weight !== "number" || !Number.isFinite(weight) || weight < 0))) invalid("Invalid model constraint weights");
    if (rule.when) condition(rule.when);
  }
}
export function normalizeArguments(input: Record<string, Json>, resolveName: (name: string) => string = name => name): Record<string, Json> {
  const args: Record<string, Json> = Object.create(null);
  for (const [raw, value] of Object.entries(input)) { const name = resolveName(aliases[raw] ?? raw); if (Object.hasOwn(args, name)) throw new ModelArgumentError("MODEL_ARGUMENT_DUPLICATE", name, value, null, `Duplicate argument or alias ${name}`); args[name] = value; }
  return args;
}
export function validateAndResolve(d: ModelDescription, input: Record<string, Json>, options: { materialized?: boolean; providedArguments?: string[] } = {}): Record<string, Json> {
  validateDescription(d);
  const args = normalizeArguments(input);
  for (const [name, value] of Object.entries(args)) if (!Object.hasOwn(d.arguments, name)) throw new ModelArgumentError("MODEL_ARGUMENT_UNSUPPORTED", name, value, null, `${d.identity} does not accept ${name}`);
  const provided = new Set((options.providedArguments ?? Object.keys(args)).map(name => aliases[name] ?? name));
  const fail = (name: string, value: Json, expected: Json, message: string): never => { throw new ModelArgumentError("MODEL_ARGUMENT_INVALID", name, value, expected, message); };
  for (const [name, descriptor] of Object.entries(d.arguments)) {
    if (provided.has(name) || descriptor.derivedFrom === undefined || (Object.hasOwn(args, name) && !isPending(args[name]))) continue;
    const derive = descriptor.derivedFrom as { operation?: string; argument?: string; kind?: string; source?: string };
    const operation = typeof descriptor.derivedFrom === "string" ? descriptor.derivedFrom : derive.operation ?? derive.kind;
    const sourceName = derive.argument ?? derive.source ?? (operation === "videoDuration" ? Object.hasOwn(args, "referenceVideos") ? "referenceVideos" : "videos" : Object.hasOwn(args, "firstFrame") ? "firstFrame" : Object.hasOwn(args, "referenceImages") ? "referenceImages" : "images");
    const source = args[sourceName], entry = Array.isArray(source) ? source[0] : source;
    const metadata = object(entry) ? { ...(object(entry.source) ? entry.source : {}), ...entry } : {};
    if (operation === "videoDuration" && typeof metadata.duration === "number") args[name] = metadata.duration;
    else if (operation === "imageAspectRatio" && typeof metadata.width === "number" && typeof metadata.height === "number" && metadata.height > 0) {
      const gcd = (a: number, b: number): number => { while (b) { const remainder = a % b; a = b; b = remainder; } return a; };
      const divisor = gcd(metadata.width, metadata.height);
      args[name] = `${metadata.width / divisor}:${metadata.height / divisor}`;
    } else if (entry !== undefined && !options.materialized) args[name] = { $pending: `derive:${name}`, type: "dsivio-video/gateway@1#DerivedArgument" };
    else if (entry !== undefined) fail(name, null, "measured source", `Cannot derive ${name} from ${sourceName}`);
  }
  for (const [name, descriptor] of Object.entries(d.arguments)) {
    if (!Object.hasOwn(args, name) && descriptor.defaultValue !== undefined) args[name] = structuredClone(descriptor.defaultValue);
    const value = args[name];
    if (value === undefined) { if (descriptor.required) throw new ModelArgumentError("MODEL_ARGUMENT_REQUIRED", name, null, "provided", `${name} is required`); continue; }
    if (isPending(value)) { if (options.materialized) fail(name, value, "materialized", `${name} is still Pending`); continue; }
    if (descriptor.resource === true && isResourceRef(value) && !options.materialized) continue;
    if (descriptor.resource === true && typeof value === "string") { const location = /^https:\/\//.test(value) ? "https" : "local"; if (location === "local" && !isAbsolute(value) || descriptor.locations?.length && !descriptor.locations.includes(location) && !(location === "local" && descriptor.locations.includes("file"))) fail(name, value, descriptor.locations ?? ["local", "https"], "Invalid resource location"); }
    if (descriptor.specialValues?.some(v => canonicalJson(v) === canonicalJson(value))) continue;
    const type = descriptor.dataType;
    if (type === "mediaList") {
      if (!Array.isArray(value)) fail(name, value, "mediaList", `${name} must be a media list`);
      const list = value as Json[];
      if ((descriptor.minCount !== undefined && list.length < descriptor.minCount) || (descriptor.maxCount !== undefined && list.length > descriptor.maxCount)) fail(name, value, { minCount: descriptor.minCount ?? 0, maxCount: descriptor.maxCount ?? null }, `${name} has invalid media count`);
      for (let index = 0; index < list.length; index++) {
        const item = list[index]; if (!object(item) || !(typeof item.source === "string" || isResourceRef(item.source) || isPending(item.source)) || !object(item.attributes ?? {})) fail(`${name}.${index}`, item ?? null, "media entry", "Invalid media entry");
        if (!object(item)) continue;
        const source = item.source; if (isPending(source)) { if (options.materialized) fail(name, value, "materialized", "Pending media"); continue; }
        const metadata = { ...(object(source) ? source : {}), ...item };
        const mime = metadata.mime;
        if (descriptor.opaqueSources !== true && options.materialized && (descriptor.mimePatterns?.length || descriptor.rejectedMime?.length) && typeof mime !== "string") fail(`${name}.${index}.mime`, null, descriptor.mimePatterns ?? [], "Cannot validate media MIME");
        if (descriptor.maxBytes !== undefined && options.materialized && typeof metadata.bytes !== "number") fail(`${name}.${index}.bytes`, null, descriptor.maxBytes, "Cannot validate media byte size");
        if (typeof mime === "string" && (descriptor.rejectedMime?.includes(mime) || (descriptor.mimePatterns?.length && !descriptor.mimePatterns.some(p => p === mime || (p.endsWith("/*") && mime.startsWith(p.slice(0, -1))))))) fail(`${name}.${index}.mime`, mime, descriptor.mimePatterns ?? [], "Unsupported media MIME");
        if (descriptor.maxBytes !== undefined && typeof metadata.bytes === "number" && metadata.bytes > descriptor.maxBytes) fail(`${name}.${index}.bytes`, metadata.bytes, descriptor.maxBytes, "Media exceeds byte limit");
        if (descriptor.opaqueSources !== true && typeof source === "string") { const location = /^https:\/\//.test(source) ? "https" : "local"; if (location === "local" && !isAbsolute(source) || descriptor.locations?.length && !descriptor.locations.includes(location) && !(location === "local" && descriptor.locations.includes("file"))) fail(`${name}.${index}.source`, source, descriptor.locations ?? ["local", "https"], "Unsupported media location"); }
        for (const property of ["width", "height", "duration"] as const) { const range = descriptor[property] as { minimum?: number; maximum?: number } | undefined; const measured = metadata[property]; if (range && (typeof measured === "number" ? (range.minimum !== undefined && measured < range.minimum) || (range.maximum !== undefined && measured > range.maximum) : options.materialized)) fail(`${name}.${index}.${property}`, typeof measured === "number" ? measured : null, range as Json, `Media ${property} out of range or unknown`); }
        for (const [property, minKey, maxKey] of [["width", "minWidth", "maxWidth"], ["height", "minHeight", "maxHeight"], ["duration", "minDuration", "maxDuration"], ["aspectRatio", "minAspectRatio", "maxAspectRatio"], ["frameRate", "minFrameRate", "maxFrameRate"]] as const) {
          const minimum = descriptor[minKey], maximum = descriptor[maxKey];
          if (minimum === undefined && maximum === undefined) continue;
          const measured = property === "aspectRatio" && typeof metadata.width === "number" && typeof metadata.height === "number" ? metadata.width / metadata.height : metadata[property];
          if (typeof measured !== "number") { if (options.materialized) fail(`${name}.${index}.${property}`, null, "measured", `Cannot validate media ${property}`); continue; }
          if ((typeof minimum === "number" && measured < minimum) || (typeof maximum === "number" && measured > maximum)) fail(`${name}.${index}.${property}`, measured, { minimum: (minimum as Json) ?? null, maximum: (maximum as Json) ?? null }, `Media ${property} out of range`);
        }
        for (const [field, domain] of [["codec", descriptor.allowedCodecs], ["audioCodecs", descriptor.allowedAudioCodecs]] as const) {
          if (!Array.isArray(domain)) continue;
          const actual = metadata[field], values = Array.isArray(actual) ? actual : actual === undefined ? [] : [actual];
          if (actual === undefined && options.materialized) fail(`${name}.${index}.${field}`, null, domain as Json, `Cannot validate media ${field}`);
          if (values.some(codec => !domain.includes(codec))) fail(`${name}.${index}.${field}`, actual ?? null, domain as Json, `Unsupported media ${field}`);
        }
        for (const attribute of Object.keys(object(item.attributes) ? item.attributes : {})) if (!Object.hasOwn(descriptor.entryAttributes ?? {}, attribute)) throw new ModelArgumentError("MODEL_ARGUMENT_UNSUPPORTED", `${name}.${index}.attributes.${attribute}`, item.attributes ?? null, (descriptor.entryAttributes ?? {}) as Json, "Unknown authored media attribute");
        for (const [attribute, spec] of Object.entries(descriptor.entryAttributes ?? {})) {
          const entry = spec as { required?: boolean; allowed?: Json[]; dataType?: string; minimum?: number; maximum?: number }, actual = object(item.attributes) ? item.attributes[attribute] : undefined;
          const badType = entry.dataType === "integer" ? !Number.isSafeInteger(actual) : entry.dataType === "number" ? typeof actual !== "number" || !Number.isFinite(actual) : entry.dataType !== undefined && typeof actual !== entry.dataType;
          if (entry.required && actual === undefined || actual !== undefined && (badType || entry.allowed && !entry.allowed.includes(actual) || typeof actual === "number" && (entry.minimum !== undefined && actual < entry.minimum || entry.maximum !== undefined && actual > entry.maximum))) fail(`${name}.${index}.attributes.${attribute}`, actual ?? null, spec as Json, "Invalid media entry attribute");
        }
      }
      continue;
    }
    if ((type === "integer" ? typeof value !== "number" || !Number.isSafeInteger(value) : type === "number" ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== type)) fail(name, value, type, `${name} must be ${type}`);
    const inAllowed = descriptor.allowed?.some(v => canonicalJson(v) === canonicalJson(value)) ?? false;
    const hasRange = descriptor.minimum !== undefined || descriptor.maximum !== undefined;
    const inRange = typeof value === "number" && hasRange && (descriptor.minimum === undefined || value >= descriptor.minimum) && (descriptor.maximum === undefined || value <= descriptor.maximum);
    const pixels = descriptor.pixelDimensions === true && typeof value === "string" && /^[1-9]\d*x[1-9]\d*$/.test(value);
    if ((descriptor.allowed || hasRange) && !inAllowed && !inRange && !pixels) fail(name, value, { allowed: descriptor.allowed ?? [], minimum: descriptor.minimum ?? null, maximum: descriptor.maximum ?? null }, `${name} outside allowed domain`);
    if (typeof value === "number" && typeof descriptor.multipleOf === "number" && value % descriptor.multipleOf !== 0) fail(name, value, descriptor.multipleOf, `${name} must be a multiple of ${descriptor.multipleOf}`);
    if (typeof value === "string") { const length = descriptor.lengthUnit === "utf16CodeUnit" ? value.length : [...value].length; if ((descriptor.minLength !== undefined && length < descriptor.minLength) || (descriptor.maxLength !== undefined && length > descriptor.maxLength)) fail(name, value, { minLength: descriptor.minLength ?? null, maxLength: descriptor.maxLength ?? null }, `${name} has invalid length`); }
  }
  const when = (c: Condition): boolean | undefined => {
    if ("provided" in c) return provided.has(c.provided);
    if ("equals" in c) return pending(args[c.equals.argument]) ? undefined : Object.hasOwn(args, c.equals.argument) && canonicalJson(args[c.equals.argument]!) === canonicalJson(c.equals.value);
    if ("not" in c) { const value = when(c.not); return value === undefined ? undefined : !value; }
    const all = "all" in c, values = (all ? c.all : c.any).map(when);
    if (all && values.includes(false)) return false;
    if (!all && values.includes(true)) return true;
    return values.includes(undefined) ? undefined : all;
  };
  for (const rule of d.constraints) {
    if (rule.when && when(rule.when) !== true) continue;
    const present = rule.arguments.filter(a => rule.presenceMode === "truthy" ? !!args[a] : provided.has(a));
    const count = (a: string): number => isPending(args[a]) ? 0 : Array.isArray(args[a]) ? (args[a] as Json[]).length : args[a] === undefined ? 0 : 1;
    let valid = true;
    switch (rule.check) {
      case "require": valid = rule.arguments.every(a => Object.hasOwn(args, a)); break;
      case "excludeTogether": valid = present.length <= 1; break;
      case "countAtMost": valid = rule.arguments.reduce((n,a) => n + count(a), 0) <= (rule.limit ?? 0); break;
      case "weightedCountAtMost": valid = rule.arguments.reduce((n,a) => n + count(a) * (rule.weights?.[a] ?? 1), 0) <= (rule.limit ?? 0); break;
      case "durationTotalAtMost": { let sum = 0, unknown = false; for (const a of rule.arguments) for (const item of Array.isArray(args[a]) ? args[a] as Json[] : []) { const duration = object(item) ? item.duration : undefined; if (typeof duration === "number") sum += duration; else unknown = true; } valid = sum <= (rule.limit ?? 0); if (unknown && options.materialized) valid = false; break; }
      case "restrictAllowed": valid = rule.arguments.every(a => args[a] === undefined || pending(args[a]) || rule.allowed?.some(v => canonicalJson(v) === canonicalJson(args[a]!))); break;
    }
    if (!valid) throw new ModelArgumentError("MODEL_CONSTRAINT_FAILED", rule.arguments.join(","), Object.fromEntries(rule.arguments.map(a => [a, args[a] ?? null])), rule as unknown as Json, `Model constraint ${rule.ruleId} failed`, rule.ruleId);
  }
  return args;
}

/** Compatibility view is a projection, never a second model catalogue. */
export function projectCapabilities(d: ModelDescription): Json {
  if (d.operation !== "image" && d.operation !== "video") return null;
  const a = d.arguments, caps: Record<string, Json> = {}, defaults: Record<string, Json> = {};
  for (const [name, field, legacy] of [["duration", "durations", "duration"], ["resolution", "resolutions", "resolution"], ["aspectRatio", "ratios", "ratio"], ["size", "sizes", "size"], ["quality", "qualities", "quality"]] as const) {
    if (a[name]?.allowed) caps[field] = a[name]!.allowed!;
    if (a[name]?.defaultValue !== undefined) defaults[legacy] = a[name]!.defaultValue!;
  }
  if (a.n?.maximum !== undefined) caps.maxCount = a.n.maximum;
  if (a.n?.defaultValue !== undefined) defaults.count = a.n.defaultValue;
  for (const [name, field] of [["images", "maxReferenceImages"], ["referenceImages", "maxReferenceImages"], ["referenceVideos", "maxReferenceVideos"], ["referenceAudios", "maxReferenceAudios"]] as const) if (a[name]?.maxCount !== undefined) caps[field] = a[name]!.maxCount!;
  caps.customPixelSize = a.size?.pixelDimensions === true;
  if (a.prompt?.maxLength !== undefined) caps.maxPromptLength = a.prompt.maxLength;
  if (d.operation === "video") {
    caps.firstFrame = !!a.firstFrame; caps.lastFrame = !!a.lastFrame; caps.audioToggle = !!a.generateAudio;
    if (a.generateAudio?.defaultValue !== undefined) defaults.audio = a.generateAudio.defaultValue;
    caps.modes = ["text", ...(a.firstFrame ? ["image"] : []), ...(a.firstFrame && a.lastFrame ? ["frames"] : []), ...(a.referenceImages || a.referenceVideos || a.referenceAudios ? ["reference"] : [])];
    caps.lastFrameNeedsFirst = d.constraints.some(rule => rule.check === "require" && rule.arguments.includes("firstFrame") && rule.when && "provided" in rule.when && rule.when.provided === "lastFrame");
    caps.localReferenceMedia = ["referenceVideos", "referenceAudios"].every(name => !a[name] || a[name]!.locations?.includes("local") || a[name]!.locations?.includes("file"));
  }
  if (Object.keys(defaults).length) caps.defaults = defaults;
  return caps;
}

/** Old hosts expose only their existing public facts; extras cannot be accepted. */
export function legacyDescription(model: ModelEntry): ModelDescription {
  if (model.kind !== "image" && model.kind !== "video") throw new DvError("MODEL_DESCRIPTION_UNAVAILABLE", "Host model description unavailable for this operation");
  const caps = object(model.capabilities) ? model.capabilities : {}, args: Record<string, ArgumentDescription> = {
    prompt: { dataType: "string", required: true, minLength: 1, ...(typeof caps.maxPromptLength === "number" ? { maxLength: caps.maxPromptLength } : {}), transport: { flag: "--prompt-file", encoding: "utf8-file" } },
  }, constraints: Constraint[] = [];
  if (model.known) {
    const defaults = object(caps.defaults) ? caps.defaults : {};
    for (const [name, field, flag, legacy] of [["aspectRatio", "ratios", "--ratio", "ratio"], ["size", "sizes", "--size", "size"], ["quality", "qualities", "--quality", "quality"], ["resolution", "resolutions", "--resolution", "resolution"], ["duration", "durations", "--duration", "duration"]] as const) {
      if (!Array.isArray(caps[field]) || !caps[field].length) continue;
      args[name] = { dataType: name === "duration" ? "integer" : "string", allowed: caps[field], ...(defaults[legacy] !== undefined ? { defaultValue: defaults[legacy] } : {}), ...(name === "size" && caps.customPixelSize === true ? { pixelDimensions: true } : {}), transport: { flag, encoding: "scalar" } };
    }
    if (typeof caps.maxCount === "number" && caps.maxCount > 0) args.n = { dataType: "integer", minimum: 1, maximum: caps.maxCount, ...(defaults.count !== undefined ? { defaultValue: defaults.count } : {}), transport: { flag: "--n", encoding: "scalar" } };
    for (const [name, field, flag, mime] of [[model.kind === "image" ? "images" : "referenceImages", "maxReferenceImages", "--ref", "image/*"], ["referenceVideos", "maxReferenceVideos", "--ref-video", "video/*"], ["referenceAudios", "maxReferenceAudios", "--ref-audio", "audio/*"]] as const) {
      if (model.kind === "image" && name !== "images") continue;
      if (typeof caps[field] !== "number" || caps[field] <= 0) continue;
      args[name] = { dataType: "mediaList", maxCount: caps[field], mimePatterns: [mime], locations: mime === "image/*" || caps.localReferenceMedia === true ? ["local", "https"] : ["https"], transport: { flag, encoding: "scalar" } };
    }
    if (model.kind === "video") {
      if (caps.audioToggle === true) args.generateAudio = { dataType: "boolean", ...(defaults.audio !== undefined ? { defaultValue: defaults.audio } : {}), transport: { optionKey: "generateAudio", encoding: "options-json" } };
      for (const [name, flag] of [["firstFrame", "--first-frame"], ["lastFrame", "--last-frame"]] as const) if (caps[name] === true) args[name] = { dataType: "mediaList", maxCount: 1, mimePatterns: ["image/*"], locations: ["local", "https"], transport: { flag, encoding: "scalar" } };
      if (args.lastFrame && args.firstFrame && caps.lastFrameNeedsFirst === true) constraints.push({ ruleId: "legacy-last-needs-first", when: { provided: "lastFrame" }, check: "require", arguments: ["firstFrame"] });
      const refs = ["referenceImages", "referenceVideos", "referenceAudios"].filter(name => args[name]), frames = ["firstFrame", "lastFrame"].filter(name => args[name]);
      if (caps.framesExcludeReferences === true) for (const frame of frames) for (const ref of refs) constraints.push({ ruleId: `legacy-${frame}-exclude-${ref}`, check: "excludeTogether", arguments: [frame, ref] });
      if (caps.referenceAudioNeedsVisual === true && args.referenceAudios) constraints.push({ ruleId: "legacy-audio-needs-visual", when: { all: [{ provided: "referenceAudios" }, ...["referenceImages", "referenceVideos"].filter(name => args[name]).map(name => ({ not: { provided: name } }))] }, check: "restrictAllowed", arguments: ["referenceAudios"], allowed: [[]] });
    }
  }
  return withFactsRevision({ descriptionVersion: 1, identity: model.id, operation: model.kind, factsComplete: false, unknownFacts: ["legacyHost.description"], legacyPublic: true, legacyCapabilities: model.capabilities ?? null, arguments: args, constraints, products: { mediaKind: model.kind }, lifecycle: { submission: "asynchronous", remoteCancel: "unsupported" }, billingInfo: null });
}
