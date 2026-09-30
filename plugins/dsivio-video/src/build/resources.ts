import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResourceStore } from "../core/capability.ts";
import type { ResourceRef } from "../core/value.ts";
import { DvError } from "../core/errors.ts";

export class ProjectStore implements ResourceStore {
  readonly directory: string;
  constructor(stateDir: string) { this.directory = join(stateDir, "store"); }

  pathOf(ref: ResourceRef): string {
    if (!/^res_[0-9a-f]{32}$/.test(ref.$resource)) throw new DvError("RESOURCE_ID_INVALID", `Invalid resource ID: ${ref.$resource}`);
    return join(this.directory, ref.$resource);
  }

  has(ref: ResourceRef): boolean { return existsSync(this.pathOf(ref)); }

  async putFile(path: string, mime: string, options: { move?: boolean } = {}): Promise<ResourceRef> {
    try {
      const ref = { $resource: `res_${randomBytes(16).toString("hex")}`, bytes: (await stat(path)).size, mime };
      await this.adopt(ref, path);
      if (options.move) await rm(path);
      return ref;
    } catch (error) {
      if (error instanceof DvError) throw error;
      throw new DvError("RESOURCE_WRITE", `Cannot import resource file ${path}`, { cause: error });
    }
  }

  async adopt(ref: ResourceRef, path: string): Promise<void> {
    const destination = this.pathOf(ref);
    const temp = `${destination}.${randomBytes(8).toString("hex")}.incoming`;
    try {
      await mkdir(this.directory, { recursive: true });
      if (this.has(ref)) {
        if ((await stat(destination)).size !== ref.bytes) throw new DvError("RESOURCE_SIZE", `Stored resource size differs: ${ref.$resource}`);
        return;
      }
      await copyFile(path, temp);
      if ((await stat(temp)).size !== ref.bytes) throw new DvError("RESOURCE_SIZE", `Resource size differs from its reference: ${ref.$resource}`);
      await rename(temp, destination);
    } catch (error) {
      await rm(temp, { force: true });
      if (error instanceof DvError) throw error;
      throw new DvError("RESOURCE_WRITE", `Cannot store resource ${ref.$resource}`, { cause: error });
    }
  }
}
