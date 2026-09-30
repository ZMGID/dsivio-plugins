// One error type for every user-facing failure. Codes are stable; messages are for people.

/** Half-open UTF-16 range in a source file; line and column (1-based) locate `start`. */
export interface SourceSpan {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface DvErrorOptions {
  span?: SourceSpan;
  hint?: string;
  cause?: unknown;
}

export class DvError extends Error {
  readonly code: string;
  readonly span: SourceSpan | undefined;
  readonly hint: string | undefined;

  constructor(code: string, message: string, options: DvErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DvError";
    this.code = code;
    this.span = options.span;
    this.hint = options.hint;
  }
}

/** Line/column for an offset, for building spans. */
export function spanAt(file: string, text: string, start: number, end = start): SourceSpan {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < start && index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }
  return { file, start, end, line, column: start - lineStart + 1 };
}
