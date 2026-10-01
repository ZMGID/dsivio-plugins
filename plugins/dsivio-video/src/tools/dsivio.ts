import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { DvError } from "../core/errors.ts";

/** Shared CLI lookup for the media gateway and bundled-tool discovery. */
export async function dsivioCommand(): Promise<string> {
  if (process.env.DSIVIO_VIDEO_DSIVIO) return resolve(process.env.DSIVIO_VIDEO_DSIVIO);
  const executable = process.platform === "win32" ? "dsivio.cmd" : "dsivio";
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const path = resolve(directory, executable);
    try { await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); return path; }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || !["ENOENT", "EACCES", "ENOTDIR"].includes(String(error.code))) throw new DvError("GATEWAY_COMMAND_FAILED", `Cannot locate Dsivio: ${String(error)}`, { cause: error });
    }
  }
  const path = join(homedir(), ".kivio", "bin", executable);
  try { await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); return path; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new DvError("GATEWAY_UNAVAILABLE", "Dsivio is unavailable; open Dsivio to install its CLI", { cause: error });
    throw new DvError("GATEWAY_COMMAND_FAILED", `Cannot access Dsivio CLI: ${String(error)}`, { cause: error });
  }
}
