// Locating and running the external programs dsivio-video needs.

export type ToolName = "ffmpeg" | "ffprobe" | "yt-dlp" | "python";

export interface LocatedTool {
  name: ToolName;
  path: string;
  /** Where it was found, in lookup order: env override, Dsivio's bundled runtime, PATH, plugin-managed install. */
  source: "env" | "dsivio" | "path" | "managed";
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Bytes written to stdin, then closed. */
  input?: Buffer | string;
  /** Kill the process when stdout exceeds this many bytes. */
  maxStdoutBytes?: number;
  /** Called for each stdout chunk; throwing terminates the process. */
  onStdoutChunk?: (chunk: Buffer) => void;
  /** Disable stdout buffering for streaming consumers (the byte limit still applies). */
  collectStdout?: boolean;
  /** Called per stderr line (progress parsing, e.g. ffmpeg showinfo). */
  onStderrLine?: (line: string) => void;
}

export interface RunResult {
  stdout: Buffer;
  /** Tail of stderr (last 8000 characters). */
  stderr: string;
}
