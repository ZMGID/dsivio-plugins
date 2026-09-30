import { DvError } from "../core/errors.ts";
import type { CliOptions } from "./options.ts";

export function result(options: CliOptions, data: unknown, lines: string[]): void {
  process.stdout.write(options.json ? JSON.stringify(data) + "\n" : lines.join("\n") + "\n");
}
export function failure(error: unknown, options: { json: boolean; debug: boolean; color?: string }, help: string): number {
  const code = error instanceof DvError ? error.code : "CLI_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const source = error instanceof DvError && error.span ? { file: error.span.file, line: error.span.line, column: error.span.column } : null;
  const hint = error instanceof DvError && error.hint ? error.hint : code === "CLI_USAGE" ? help : "Use --debug for the stack trace.";
  const trace = options.debug && error instanceof Error ? error.stack : undefined;
  if (options.json) process.stdout.write(JSON.stringify({ ok: false, error: { code, message, source, hint, ...(trace ? { trace } : {}) }, ...(code === "CLI_USAGE" ? { help } : {}) }) + "\n");
  else {
    const label = options.color === "always" || (options.color === "auto" && process.stderr.isTTY) ? "\x1b[31merror\x1b[0m" : "error";
    process.stderr.write(`${label} ${code}${source ? ` ${source.file}:${source.line}:${source.column}` : ""}\n${message}\n${hint}\n${trace ? trace + "\n" : ""}`);
  }
  return code === "CLI_USAGE" ? 2 : 1;
}
