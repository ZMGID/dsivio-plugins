import { createHash, randomBytes } from "node:crypto";
import { DvError } from "../core/errors.ts";

export function buildId(now = new Date()): string {
  return `bld_${now.toISOString().replace(/[-:.]/g, "")}_${randomBytes(5).toString("hex").toUpperCase()}`;
}

export function validateBuildId(id: string): void {
  const match = /^bld_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z_[0-9A-F]{10}$/.exec(id);
  if (!match) throw new DvError("BUILD_ID_INVALID", `Invalid Build ID: ${id}`);
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== iso) throw new DvError("BUILD_ID_INVALID", `Invalid UTC date in Build ID: ${id}`);
}

export function idempotencyKey(build: string, commandKey: string): string {
  validateBuildId(build);
  return `${build}:${createHash("sha256").update(commandKey).digest("hex").slice(0, 24)}`;
}
