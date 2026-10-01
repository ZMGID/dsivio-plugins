import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DvError } from "../core/errors.ts";

function fsCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function publicationError(error: unknown, target: string): DvError {
  return new DvError(fsCode(error) === "EEXIST" ? "MEDIA_OUTPUT_EXISTS" : "MEDIA_OUTPUT_FAILED", `Cannot publish media to ${target}: ${error instanceof Error ? error.message : String(error)}`, { cause: error, hint: "Choose a new writable output path; existing paths are never overwritten." });
}
export async function prepareOutput(path: string): Promise<string> {
  const target = resolve(path);
  try {
    try {
      await lstat(target);
    } catch (error) {
      if (fsCode(error) !== "ENOENT") throw error;
      await mkdir(dirname(target), { recursive: true });
      return target;
    }
    throw new DvError("MEDIA_OUTPUT_EXISTS", `Output already exists: ${target}`, { hint: "Choose a new output path." });
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw publicationError(error, target);
  }
}
/** Publishes without replacing even a concurrently created file or dangling symlink. */
export async function publishFile(tempPath: string, targetPath: string): Promise<void> {
  try {
    try {
      await link(tempPath, targetPath);
    } catch (error) {
      if (fsCode(error) !== "EXDEV") throw error;
      await copyFile(tempPath, targetPath, constants.COPYFILE_EXCL);
    }
  } catch (error) {
    throw publicationError(error, targetPath);
  }
}
/** Reserves the directory exclusively: POSIX rename alone can replace an existing empty directory. */
export async function publishDirectory(tempPath: string, targetPath: string): Promise<void> {
  try {
    await mkdir(targetPath);
  } catch (error) {
    throw publicationError(error, targetPath);
  }
  try {
    for (const entry of await readdir(tempPath)) await rename(join(tempPath, entry), join(targetPath, entry));
  } catch (error) {
    await rm(targetPath, { recursive: true, force: true });
    throw publicationError(error, targetPath);
  }
}
