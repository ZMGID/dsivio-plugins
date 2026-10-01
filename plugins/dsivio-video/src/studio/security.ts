import { randomBytes, timingSafeEqual } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DvError } from "../core/errors.ts";

type HostRequest = Pick<IncomingMessage, "rawHeaders">;
type StudioRequest = Pick<IncomingMessage, "rawHeaders" | "method">;

function forbidden(message: string): never {
  throw new DvError("STUDIO_FORBIDDEN", message);
}

/** Do not use Node's normalized headers: duplicate Host and credential fields must fail. */
function header(request: HostRequest, name: string, required = true): string | undefined {
  let value: string | undefined;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() !== name) continue;
    if (value !== undefined) forbidden(`Duplicate ${name} header.`);
    value = request.rawHeaders[index + 1];
    if (value === undefined) forbidden(`Malformed ${name} header.`);
  }
  if (required && value === undefined) forbidden(`Missing ${name} header.`);
  return value;
}

/** Process-local secret; only bootstrap may disclose it, never URLs or persisted state. */
export function createStudioToken(): string {
  try {
    return randomBytes(32).toString("hex");
  } catch (cause) {
    throw new DvError("STUDIO_SECURITY", "Cannot create the Studio session secret.", { cause });
  }
}

/** Returns the exact accepted authority, suitable for same-request Origin comparison. */
export function assertStudioHost(request: HostRequest, port: number): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) forbidden("Invalid Studio listening port.");
  const host = header(request, "host");
  if (host === undefined || !/^(?:localhost|127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(host)) {
    forbidden("Studio requires a loopback Host with an explicit port.");
  }
  if (Number(host.slice(host.lastIndexOf(":") + 1)) !== port) forbidden("Host does not match the Studio listening port.");
  return host;
}

/** All JSON mutations require the exact request origin and the in-memory session secret. */
export function assertStudioWrite(request: StudioRequest, port: number, token: string): void {
  const host = assertStudioHost(request, port);
  if (request.method === "OPTIONS") forbidden("Studio does not accept cross-origin preflight requests.");
  if (header(request, "origin") !== `http://${host}`) forbidden("Origin does not match the request Host.");
  const site = header(request, "sec-fetch-site", false);
  if (site !== undefined && site !== "same-origin") forbidden("Studio writes require same-origin fetches.");
  const supplied = header(request, "x-studio-token");
  if (supplied === undefined || !/^[a-f0-9]{64}$/.test(supplied) || !/^[a-f0-9]{64}$/.test(token)) {
    forbidden("Invalid Studio session token.");
  }
  if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(token, "hex"))) forbidden("Invalid Studio session token.");
  const contentType = header(request, "content-type");
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") forbidden("Studio writes require application/json.");
}

/** Call before routing any HTTP request; OPTIONS is always forbidden and never gets CORS. */
export function assertStudioRequest(request: StudioRequest, port: number, token: string): void {
  assertStudioHost(request, port);
  if (request.method === "OPTIONS") forbidden("Studio does not accept cross-origin preflight requests.");
  if (["PUT", "POST", "DELETE", "PATCH"].includes(request.method ?? "")) assertStudioWrite(request, port, token);
}

function contains(root: string, file: string): boolean {
  const suffix = relative(root, file);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
}

/**
 * Recheck immediately before every source write. loadedFiles are the canonical paths
 * retained from compilation, not freshly resolved aliases that could have been retargeted.
 * The returned canonical file is the only authorized destination.
 */
export function assertSourceWrite(workspaceRoot: string, file: string, loadedFiles: Iterable<string>): string {
  try {
    const root = realpathSync(workspaceRoot);
    const requested = resolve(file);
    const parent = realpathSync(dirname(requested));
    const canonical = realpathSync(requested);
    if (!contains(root, parent) || !contains(root, canonical)) {
      throw new DvError("STUDIO_SOURCE_FORBIDDEN", "Source writes cannot escape the workspace.");
    }
    let loaded = false;
    for (const source of loadedFiles) {
      if (resolve(source) === canonical) {
        loaded = true;
        break;
      }
    }
    if (!loaded || !statSync(canonical).isFile()) {
      throw new DvError("STUDIO_SOURCE_FORBIDDEN", "Source writes require a regular file in the loaded source closure.");
    }
    return canonical;
  } catch (cause) {
    if (cause instanceof DvError) throw cause;
    throw new DvError("STUDIO_SOURCE_IO", `Cannot authorize source write to ${file}.`, { cause });
  }
}
