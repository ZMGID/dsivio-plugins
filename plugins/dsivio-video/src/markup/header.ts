import { DvError, spanAt } from "../core/errors.ts";

export function readHeader(file: string, text: string): { using: string; bodyStart: number } {
  const start = text.startsWith("\uFEFF") ? 1 : 0;
  const fail: (code: string, message: string, offset: number, end?: number) => never = (code, message, offset, end = offset) => {
    throw new DvError(code, message, { span: spanAt(file, text, offset, end) });
  };
  if (!text.startsWith("<?dvml", start)) fail("SOURCE_HEADER_MISSING", "A dvml header must begin the file.", start);
  const close = text.indexOf("?>", start + 6);
  if (close < 0) fail("SOURCE_HEADER_UNCLOSED", "The dvml header is not closed.", start, text.length);
  const header = text.slice(start, close + 2);
  const match = /^<\?dvml[ \t]+using=(?:"([^"\r\n]*)"|'([^'\r\n]*)')[ \t]*\?>$/.exec(header);
  if (!match) fail("SOURCE_HEADER_INVALID", "The header accepts only a quoted using attribute, without newlines.", start, close + 2);
  const using = match[1] ?? match[2]!;
  if (!using || /[\s<>&'"{}]/.test(using)) {
    fail("SOURCE_HEADER_FRONTEND", "The frontend request must be nonempty and contain no whitespace, entities, or interpolation.", start + header.indexOf("=") + 2, close);
  }
  const bodyStart = close + 2;
  const following = /\S/.exec(text.slice(bodyStart));
  if (following && text.startsWith("<?dvml", bodyStart + following.index)) {
    fail("SOURCE_HEADER_DUPLICATE", "Only one source header is allowed.", bodyStart + following.index);
  }
  return { using, bodyStart };
}
