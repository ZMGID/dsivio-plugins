import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DvError, spanAt } from "../core/errors.ts";
import type { SourceSpan } from "../core/errors.ts";

export interface WorkspaceOptions {
  cwd: string;
  workspace?: string;
  assetRoots?: readonly string[];
}

function filesystemError(error: unknown, path: string): never {
  const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "SOURCE_IO";
  throw new DvError(code === "ENOENT" || code === "ENOTDIR" ? "SOURCE_NOT_FOUND" : code, `Cannot read ${path}.`, { span: spanAt(path, "", 0), cause: error });
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    filesystemError(error, path);
  }
}

function contains(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
}

export class Workspace {
  readonly root: string;
  readonly stateDir: string;
  readonly assetRoots: readonly string[];

  private constructor(root: string, assetRoots: readonly string[]) {
    this.root = root;
    this.stateDir = join(root, ".dsivio-video");
    this.assetRoots = assetRoots;
  }

  static open(options: WorkspaceOptions): Workspace {
    const cwd = canonical(resolve(options.cwd));
    let root = options.workspace === undefined ? cwd : canonical(resolve(cwd, options.workspace));
    if (options.workspace === undefined) {
      for (let candidate = cwd; ; candidate = dirname(candidate)) {
        try {
          if (statSync(join(candidate, ".dsivio-video")).isDirectory()) {
            root = candidate;
            break;
          }
        } catch (error) {
          if (!(error !== null && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
            filesystemError(error, join(candidate, ".dsivio-video"));
          }
        }
        if (dirname(candidate) === candidate) break;
      }
    }
    return new Workspace(root, (options.assetRoots ?? []).map((path) => canonical(resolve(cwd, path))));
  }

  resolveSource(importerFile: string, locator: string): string {
    return this.resolveLocator(importerFile, locator, false);
  }

  resolveAsset(importerFile: string, locator: string): string {
    return this.resolveLocator(importerFile, locator, true);
  }

  private resolveLocator(importerFile: string, locator: string, asset: boolean): string {
    const span = spanAt(importerFile, "", 0);
    if (!locator.startsWith("./") && !locator.startsWith("../")) {
      throw new DvError("UNSUPPORTED_SOURCE_IMPORT", "Locators must start with ./ or ../.", { span });
    }
    const path = canonical(resolve(dirname(importerFile), locator));
    if (!contains(this.root, path) && !(asset && this.assetRoots.some((root) => contains(root, path)))) {
      throw new DvError(asset ? "SOURCE_ASSET_OUTSIDE_ROOT" : "SOURCE_OUTSIDE_ROOT", `The path ${path} is outside the allowed roots.`, { span });
    }
    return path;
  }

  statFile(path: string, span: SourceSpan = spanAt(path, "", 0)): number {
    const target = canonical(path);
    if (!contains(this.root, target) && !this.assetRoots.some((root) => contains(root, target))) {
      throw new DvError("SOURCE_ASSET_OUTSIDE_ROOT", `The asset ${target} is outside the allowed roots.`, { span });
    }
    let stat;
    try {
      stat = statSync(target);
    } catch (error) {
      filesystemError(error, target);
    }
    if (!stat.isFile()) throw new DvError("SOURCE_ASSET_NOT_FILE", `The asset ${target} must be a regular file.`, { span });
    return stat.size;
  }

  readText(path: string, options: { asset?: boolean; span?: SourceSpan } = {}): string {
    const target = canonical(path);
    const span = options.span ?? spanAt(path, "", 0);
    if (!contains(this.root, target) && !(options.asset && this.assetRoots.some((root) => contains(root, target)))) {
      throw new DvError(options.asset ? "SOURCE_ASSET_OUTSIDE_ROOT" : "SOURCE_OUTSIDE_ROOT", `The source ${target} is outside the allowed roots.`, { span });
    }
    if (options.asset) this.statFile(target, span);
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(target));
    } catch (error) {
      filesystemError(error, target);
    }
  }
}
