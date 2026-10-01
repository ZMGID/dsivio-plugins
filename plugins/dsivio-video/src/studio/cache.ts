import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityDef, ExecuteContext } from "../core/capability.ts";
import type { Json, ResourceRef, Value } from "../core/value.ts";
import { canonicalJson, isResourceRef, resourcesIn } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import type { ExecutionCache, ExecutionRegistry } from "../build/execute.ts";
import { validateExecutionValue } from "../build/execute.ts";
import { ProjectStore } from "../build/resources.ts";
import { toolVersion } from "../tools/index.ts";
import { ASR_SERVICE_VERSION, WHISPERX_VERSION, readAsrConfiguration } from "../asr/install.ts";
import { FONT_CATALOG_VERSION, FONT_PACKAGE_PINS } from "../fonts/types.ts";
import { RASTER_VERSION, NUMPY_VERSION, OPENCV_VERSION } from "../raster/install.ts";

export const STUDIO_CACHE_SCHEMA = "dsivio-video.studio-cache/1";
/** Bump the corresponding algorithm version whenever its output semantics change. */
export const STUDIO_IMPLEMENTATION_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  "local/inspect": "inspect/1", "local/normalize": "normalize/1", "local/transform": "transform/1",
  "local/extract-audio": "extract-audio/1", "local/extract-frame": "extract-frame/1", "local/still-video": "still-video/1",
  "local/speech-audio": "speech-audio/1", "local/align": "align/1", "local/font-face": "font-face/1",
  "local/raster": "raster/1", "local/prepare-audio-playback": "prepare-audio-playback/1",
});
interface Digest { sha256: string; bytes: number; mime: string }
interface ResourceDigest extends Digest { resource: ResourceRef }
interface CacheEntry {
  schema: typeof STUDIO_CACHE_SCHEMA;
  key: string;
  capability: string;
  implementationVersion: string;
  request: Json;
  value: Value;
  resourceDigests: ResourceDigest[];
}
interface Flight { controller: AbortController; consumers: number; promise: Promise<Value> }
// Shared by all cache instances in this process; views may have different lifetimes.
const flights = new Map<string, Flight>();
export interface StudioCacheOptions {
  stateDir: string;
  registry: ExecutionRegistry;
  resources?: ProjectStore;
  /** Exact complete version pins for a custom capability, or for an injected executor. */
  implementationVersions?: Readonly<Record<string, string>>;
}
function failure(code: string, message: string, cause: unknown): DvError {
  return cause instanceof DvError ? cause : new DvError(code, message, { cause });
}
function cancelled(): DvError { return new DvError("ABORTED", "Studio preparation cancelled"); }
async function digestFile(path: string, ref: ResourceRef): Promise<Digest> {
  try {
    if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || typeof ref.mime !== "string" || !ref.mime.trim()) throw new DvError("RESOURCE_INVALID", "Resource requires exact bytes and MIME");
    const before = await stat(path);
    if (!before.isFile() || before.size !== ref.bytes) throw new DvError("RESOURCE_SIZE", `Resource bytes differ: ${ref.$resource}`);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
    const after = await stat(path);
    if (bytes !== ref.bytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw new DvError("RESOURCE_CHANGED", `Resource changed while reading: ${ref.$resource}`);
    return { sha256: hash.digest("hex"), bytes, mime: ref.mime };
  } catch (cause) { throw failure("RESOURCE_READ", `Cannot read resource ${ref.$resource}`, cause); }
}

export class StudioCache implements ExecutionCache {
  readonly directory: string;
  readonly resources: ProjectStore;
  private readonly options: StudioCacheOptions;
  constructor(options: StudioCacheOptions) {
    this.options = options;
    this.directory = join(options.stateDir, "studio", "cache", "v1");
    this.resources = options.resources ?? new ProjectStore(options.stateDir);
  }

  /** Import source bytes through ProjectStore, reusing an opaque identity by exact content and MIME. */
  async ingestSource(ref: ResourceRef, path: string): Promise<ResourceRef> {
    const digest = await digestFile(path, ref);
    const identity = createHash("sha256").update(canonicalJson(digest as unknown as Json)).digest("hex");
    const stable: ResourceRef = { $resource: `res_${identity.slice(0, 32)}`, bytes: digest.bytes, mime: digest.mime };
    if (this.resources.has(stable)) {
      const stored = await digestFile(this.resources.pathOf(stable), stable);
      if (stored.sha256 !== digest.sha256) throw new DvError("RESOURCE_DIGEST", `Stored resource content differs: ${stable.$resource}`);
    } else {
      await this.resources.adopt(stable, path);
      const stored = await digestFile(this.resources.pathOf(stable), stable);
      if (stored.sha256 !== digest.sha256) throw new DvError("RESOURCE_CHANGED", `Source changed during import: ${ref.$resource}`);
    }
    return stable;
  }

  async contentIdentity(request: Json, context: ExecuteContext): Promise<Json> {
    const walk = async (node: Json): Promise<Json> => {
      if (context.signal.aborted) throw cancelled();
      if (isResourceRef(node)) return await digestFile(context.store.pathOf(node), node) as unknown as Json;
      if (Array.isArray(node)) return Promise.all(node.map(walk));
      if (node !== null && typeof node === "object") {
        const entries = await Promise.all(Object.entries(node).map(async ([key, value]) => [key, await walk(value)] as const));
        return Object.fromEntries(entries);
      }
      return node;
    };
    try { return await walk(request); }
    catch (cause) { throw failure("STUDIO_CACHE_REQUEST", "Cannot identify Studio preparation request", cause); }
  }

  async implementationVersion(capability: string, context: ExecuteContext): Promise<string> {
    const injected = this.options.implementationVersions?.[capability];
    if (injected) return injected;
    const algorithm = STUDIO_IMPLEMENTATION_VERSIONS[capability];
    if (!algorithm) throw new DvError("STUDIO_CACHE_VERSION", `No implementation version for ${capability}`);
    const pins: Record<string, Json> = { algorithm };
    if (capability === "local/font-face") { pins.catalog = FONT_CATALOG_VERSION; pins.packages = FONT_PACKAGE_PINS; }
    else if (capability === "local/raster") { pins.service = RASTER_VERSION; pins.numpy = NUMPY_VERSION; pins.opencv = OPENCV_VERSION; pins.python = "3.12"; }
    else {
      pins.ffprobe = await toolVersion("ffprobe", { projectRoot: context.projectRoot });
      if (capability !== "local/inspect") pins.ffmpeg = await toolVersion("ffmpeg", { projectRoot: context.projectRoot });
      if (capability === "local/align") {
        const configuration = await readAsrConfiguration();
        if (!configuration) throw new DvError("ASR_NOT_PREPARED", "Local alignment model is not prepared");
        pins.service = ASR_SERVICE_VERSION; pins.whisperx = WHISPERX_VERSION;
        pins.model = configuration.model; pins.languages = configuration.languages;
        pins.device = configuration.device; pins.compute = configuration.compute; pins.batchSize = configuration.batchSize;
        pins.preparation = "verify-16k-mono/1;prepared-language-model/1";
      }
    }
    return canonicalJson(pins);
  }

  async execute(capability: CapabilityDef, request: Json, context: ExecuteContext, validate: (value: Value) => void, run: (context: ExecuteContext) => Promise<Value>): Promise<Value> {
    try {
      if (!this.options.registry.findModule) throw new DvError("STUDIO_CACHE_TYPES", "Studio cache requires a TypeDef registry");
      const identity = await this.contentIdentity(request, context);
      const implementationVersion = await this.implementationVersion(capability.name, context);
      if (context.signal.aborted) throw cancelled();
      const key = createHash("sha256").update(canonicalJson({ schema: STUDIO_CACHE_SCHEMA, capability: capability.name, implementationVersion, resolvedRequest: identity })).digest("hex");
      const flightKey = join(this.directory, key);
      let flight = flights.get(flightKey);
      if (!flight) {
        const controller = new AbortController();
        const sharedContext = {
          ...context, signal: controller.signal,
          workDir: join(this.options.stateDir, "studio", "work", `${key}-${randomBytes(8).toString("hex")}`),
        };
        const promise = this.prepare(key, capability, implementationVersion, identity, sharedContext, validate, run)
          .finally(async () => { await rm(sharedContext.workDir, { recursive: true, force: true }); });
        const current: Flight = { controller, consumers: 0, promise };
        current.promise = promise.finally(() => { if (flights.get(flightKey) === current) flights.delete(flightKey); });
        flights.set(flightKey, current);
        flight = current;
      }
      return await this.consume(flightKey, flight, context.signal, validate);
    } catch (cause) { throw failure("STUDIO_CACHE_FAILED", "Studio cache preparation failed", cause); }
  }

  private consume(key: string, flight: Flight, signal: AbortSignal, validate: (value: Value) => void): Promise<Value> {
    flight.consumers++;
    const { promise, resolve, reject } = Promise.withResolvers<Value>();
    let settled = false;
    const leave = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (--flight.consumers === 0) {
        if (flights.get(key) === flight) flights.delete(key);
        flight.controller.abort();
      }
      return true;
    };
    const abort = (): void => { if (leave()) reject(cancelled()); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    flight.promise.then(value => {
      if (!leave()) return;
      try { validate(value); resolve(value); } catch (cause) { reject(cause); }
    }, cause => { if (leave()) reject(cause); });
    return promise;
  }

  private async prepare(key: string, capability: CapabilityDef, implementationVersion: string, identity: Json, context: ExecuteContext, validate: (value: Value) => void, run: (context: ExecuteContext) => Promise<Value>): Promise<Value> {
    const file = join(this.directory, `${key}.json`);
    try {
      const entry = JSON.parse(await readFile(file, "utf8")) as CacheEntry;
      if (entry.schema !== STUDIO_CACHE_SCHEMA || entry.key !== key || entry.capability !== capability.name || entry.implementationVersion !== implementationVersion || canonicalJson(entry.request) !== canonicalJson(identity) || entry.value.type !== capability.returns) throw new DvError("STUDIO_CACHE_INVALID", "Cache identity differs");
      validateExecutionValue(this.options.registry, entry.value);
      validate(entry.value);
      const refs = resourcesIn(entry.value.data);
      if (!Array.isArray(entry.resourceDigests) || refs.length !== entry.resourceDigests.length) throw new DvError("STUDIO_CACHE_INVALID", "Cache resource list differs");
      for (let index = 0; index < refs.length; index++) {
        const expected = entry.resourceDigests[index]!;
        const ref = refs[index]!.ref;
        if (canonicalJson(ref as unknown as Json) !== canonicalJson(expected.resource as unknown as Json)) throw new DvError("STUDIO_CACHE_INVALID", "Cache resource identity differs");
        const actual = await digestFile(context.store.pathOf(ref), ref);
        if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes || actual.mime !== expected.mime) throw new DvError("RESOURCE_DIGEST", "Cached resource content differs");
      }
      if (context.signal.aborted) throw cancelled();
      return entry.value;
    } catch (cause) {
      if (context.signal.aborted) throw cancelled();
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) await rm(file, { force: true });
    }
    if (context.signal.aborted) throw cancelled();
    const value = await run(context);
    validateExecutionValue(this.options.registry, value);
    validate(value);
    const resourceDigests: ResourceDigest[] = [];
    for (const { ref } of resourcesIn(value.data)) resourceDigests.push({ resource: ref, ...await digestFile(context.store.pathOf(ref), ref) });
    if (context.signal.aborted) throw cancelled();
    const entry: CacheEntry = { schema: STUDIO_CACHE_SCHEMA, key, capability: capability.name, implementationVersion, request: identity, value, resourceDigests };
    const temporary = `${file}.${randomBytes(8).toString("hex")}.incoming`;
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporary, canonicalJson(entry as unknown as Json) + "\n", { mode: 0o600, flag: "wx" });
      if (context.signal.aborted) throw cancelled();
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    return value;
  }
}
