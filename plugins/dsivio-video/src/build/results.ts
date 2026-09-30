import { randomBytes } from "node:crypto";
import { copyFile, cp, link, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { HistoryReader, HistoricalOutput } from "../core/history.ts";
import type { Json, TypeRef, Value, ValueClass } from "../core/value.ts";
import { isResourceRef, valueClass } from "../core/value.ts";
import { DvError } from "../core/errors.ts";
import { validateBuildId } from "./ids.ts";
import { ProjectStore } from "./resources.ts";

export type ResultOutput = { type: TypeRef; class: ValueClass; value: Json } | { forward: { build: string; output: string } };
export interface OperationEvidence {
  command: string;
  backend: string | null;
  model: string | null;
  phase: string;
  receipt: string | null;
  error: { code: string; message: string } | null;
}
export interface ResultManifest {
  id: string;
  title: string | null;
  author: string;
  run: string;
  targets: string[];
  createdAt: string;
  completedAt: string | null;
  outcome: "open" | "complete" | "failed" | "cancelled";
  failure: { code: string; message: string } | null;
  outputs: Record<string, ResultOutput>;
  operations: OperationEvidence[];
}
export interface ListOptions { limit?: number; before?: string }

export class ResultsRepository implements HistoryReader {
  readonly stateDir: string;
  readonly resources: ProjectStore;
  constructor(stateDir: string) { this.stateDir = stateDir; this.resources = new ProjectStore(stateDir); }

  pathOf(id: string): string {
    validateBuildId(id);
    return join(this.stateDir, "results", `${id.slice(4, 8)}-${id.slice(8, 10)}-${id.slice(10, 12)}`, id, "result.json");
  }

  async write(manifest: ResultManifest): Promise<void> {
    const path = this.pathOf(manifest.id);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    const { id: _id, ...document } = manifest;
    try { await writeFile(temp, JSON.stringify(document, null, 2) + "\n", { flag: "wx" }); await rename(temp, path); }
    catch (error) { await rm(temp, { force: true }); throw new DvError("RESULT_WRITE", `Cannot publish result ${manifest.id}`, { cause: error }); }
  }

  async read(id: string): Promise<ResultManifest | undefined> {
    const path = this.pathOf(id);
    try { return { ...JSON.parse(await readFile(path, "utf8")), id } as ResultManifest; }
    catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      throw new DvError("RESULT_READ", `Cannot read result ${id}`, { cause: error });
    }
  }

  async list(options: ListOptions = {}): Promise<ResultManifest[]> {
    const root = join(this.stateDir, "results");
    let dates: string[];
    try { dates = await readdir(root); }
    catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw new DvError("RESULT_READ", "Cannot list results", { cause: error });
    }
    const ids: string[] = [];
    for (const date of dates.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))) {
      for (const id of await readdir(join(root, date))) {
        if (/^bld_\d{8}T\d{9}Z_[0-9A-F]{10}$/.test(id) && (!options.before || id < options.before)) ids.push(id);
      }
    }
    ids.sort().reverse();
    const rows: ResultManifest[] = [];
    for (const id of ids) {
      const result = await this.read(id);
      if (result && result.outcome !== "open") rows.push(result);
      if (rows.length >= (options.limit ?? 20)) break;
    }
    return rows;
  }

  async history(outputName: string, options: ListOptions & { author?: string } = {}): Promise<ResultManifest[]> {
    const rows = await this.list({ before: options.before, limit: Number.MAX_SAFE_INTEGER });
    return rows.filter((row) => Object.hasOwn(row.outputs, outputName) && (!options.author || row.author === options.author)).slice(0, options.limit ?? 20);
  }

  async readOutput(buildId: string, output: string): Promise<HistoricalOutput | undefined> {
    return this.resolveOutput(buildId, output, true, new Set());
  }

  private async resolveOutput(build: string, name: string, finished: boolean, seen: Set<string>): Promise<HistoricalOutput | undefined> {
    const key = `${build}:${name}`;
    if (seen.has(key)) throw new DvError("HISTORY_CYCLE", `Historical output forwarding cycle at ${key}`);
    seen.add(key);
    const result = await this.read(build);
    if (!result) return undefined;
    if (finished && result.outcome === "open") throw new DvError("HISTORY_OPEN", `Build ${build} has not finished`);
    if (!Object.hasOwn(result.outputs, name)) return undefined;
    const output = result.outputs[name];
    if (!output) return undefined;
    if ("forward" in output) {
      const forwarded = await this.resolveOutput(output.forward.build, output.forward.output, true, seen);
      if (!forwarded) throw new DvError("HISTORY_MISSING", `Forwarded output ${key} is missing`);
      return forwarded;
    }
    return { type: output.type, value: { type: output.type, data: output.value } };
  }

  async exportOutput(buildId: string, output: string, to: string): Promise<{ type: TypeRef; class: ValueClass; path: string }> {
    const resolved = await this.resolveOutput(buildId, output, false, new Set());
    if (!resolved) throw new DvError("OUTPUT_MISSING", `Output ${output} is not available in ${buildId}`);
    const kind = valueClass(resolved.value);
    const destination = resolve(to);
    try { await lstat(destination); throw new DvError("EXPORT_EXISTS", `Destination exists: ${destination}`); }
    catch (error) {
      if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    await mkdir(dirname(destination), { recursive: true });
    const temp = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
    let directoryClaimed = false;
    try {
      if (kind === "scalar") await writeFile(temp, JSON.stringify(resolved.value.data, null, 2) + "\n", { flag: "wx" });
      else if (isResourceRef(resolved.value.data)) await copyFile(this.resources.pathOf(resolved.value.data), temp);
      else {
        await mkdir(join(temp, "files"), { recursive: true });
        const copied = new Map<string, string>();
        const rewrite = async (data: Json): Promise<Json> => {
          if (isResourceRef(data)) {
            let relative = copied.get(data.$resource);
            if (!relative) {
              relative = `files/${data.$resource}`;
              await copyFile(this.resources.pathOf(data), join(temp, relative));
              copied.set(data.$resource, relative);
            }
            return { $resource: relative, bytes: data.bytes, mime: data.mime };
          }
          if (Array.isArray(data)) return Promise.all(data.map(rewrite));
          if (data !== null && typeof data === "object") {
            const rewritten: Record<string, Json> = {};
            for (const key of Object.keys(data)) Object.defineProperty(rewritten, key, { value: await rewrite(data[key]!), enumerable: true, writable: true, configurable: true });
            return rewritten;
          }
          return data;
        };
        const value: Value = { type: resolved.type, data: await rewrite(resolved.value.data) };
        await writeFile(join(temp, "value.json"), JSON.stringify(value, null, 2) + "\n");
      }
      if (kind === "composite") {
        await mkdir(destination);
        directoryClaimed = true;
        for (const entry of await readdir(temp)) await cp(join(temp, entry), join(destination, entry), { recursive: true, force: false, errorOnExist: true });
        await rm(temp, { recursive: true });
      } else {
        await link(temp, destination);
        await rm(temp);
      }
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      if (directoryClaimed) await rm(destination, { recursive: true, force: true });
      if (error !== null && typeof error === "object" && "code" in error && (error.code === "EEXIST" || error.code === "ERR_FS_CP_EEXIST")) throw new DvError("EXPORT_EXISTS", `Destination exists: ${destination}`, { cause: error });
      if (error instanceof DvError) throw error;
      throw new DvError("EXPORT_FAILED", `Cannot export ${output} to ${destination}`, { cause: error });
    }
    return { type: resolved.type, class: kind, path: destination };
  }
}
