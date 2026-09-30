import { parseArgs } from "node:util";
import { DvError } from "../core/errors.ts";

export interface CliOptions {
  json: boolean;
  verbose: boolean;
  debug: boolean;
  color: "auto" | "always" | "never";
  workspace?: string;
  assetRoots: string[];
  limit: number;
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
}
export interface CommandSpec {
  usage: string;
  min: number;
  max: number;
  options?: Record<string, "string" | "boolean" | "multiple">;
}
export function usage(message: string): never {
  throw new DvError("CLI_USAGE", message);
}
export function integer(value: string | undefined, name: string, fallback: number, minimum = 0): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) usage(`--${name} must be ${minimum === 0 ? "a non-negative" : "a positive"} safe integer.`);
  return Number(value);
}
export function parseOptions(args: string[], spec: CommandSpec): CliOptions {
  const options: Record<string, { type: "string" | "boolean"; multiple?: boolean }> = {
    json: { type: "boolean" }, verbose: { type: "boolean" }, debug: { type: "boolean" }, help: { type: "boolean" },
    color: { type: "string" }, "no-color": { type: "boolean" }, workspace: { type: "string" },
    "asset-root": { type: "string", multiple: true }, limit: { type: "string" },
  };
  for (const [name, type] of Object.entries(spec.options ?? {})) options[name] = type === "multiple" ? { type: "string", multiple: true } : { type };
  const parsed = (() => {
    try { return parseArgs({ args, options, strict: true, allowPositionals: true, tokens: true }); }
    catch (error) { return usage(error instanceof Error ? error.message : String(error)); }
  })();
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name) && !options[token.name]?.multiple) usage(`Duplicate option --${token.name}.`);
    seen.add(token.name);
    if (token.value !== undefined && (token.value === "" || token.value.startsWith("--"))) usage(`Missing value for --${token.name}.`);
  }
  const values: CliOptions["values"] = {};
  for (const [name, value] of Object.entries(parsed.values)) {
    values[name] = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : value;
  }
  if (values.color !== undefined && values["no-color"]) usage("--color and --no-color are mutually exclusive.");
  if (values.color !== undefined && !["auto", "always", "never"].includes(String(values.color))) usage("--color must be auto, always, or never.");
  if (!values.help && (parsed.positionals.length < spec.min || parsed.positionals.length > spec.max)) usage(`Expected ${spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`} positional argument(s).`);
  const result: CliOptions = {
    json: values.json === true, verbose: values.verbose === true, debug: values.debug === true,
    color: values["no-color"] ? "never" : values.color === "always" ? "always" : values.color === "never" ? "never" : "auto",
    assetRoots: Array.isArray(values["asset-root"]) ? values["asset-root"] : [],
    limit: integer(typeof values.limit === "string" ? values.limit : undefined, "limit", 20, 1), values, positionals: parsed.positionals,
  };
  if (typeof values.workspace === "string") result.workspace = values.workspace;
  return result;
}
export function stringOption(options: CliOptions, name: string): string | undefined {
  const value = options.values[name];
  return typeof value === "string" ? value : undefined;
}
