import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { DvError } from "../core/errors.ts";
import { dsivioCommand } from "./dsivio.ts";
import type { LocatedTool, RunOptions, RunResult, ToolName } from "./types.ts";

export const toolNames: readonly ToolName[] = ["ffmpeg", "ffprobe", "yt-dlp", "python"];
const environmentNames: Record<ToolName, string> = {
  ffmpeg: "DSIVIO_VIDEO_FFMPEG", ffprobe: "DSIVIO_VIDEO_FFPROBE", "yt-dlp": "DSIVIO_VIDEO_YT_DLP", python: "DSIVIO_VIDEO_PYTHON",
};
const located = new Map<string, Promise<LocatedTool>>();
const bundled = new Map<string, Promise<Partial<Record<ToolName, string>>>>();

function installHint(name: ToolName): string {
  const install = process.platform === "darwin" ? "brew install ffmpeg yt-dlp" : process.platform === "win32" ? "winget install Gyan.FFmpeg; winget install yt-dlp.yt-dlp" : "Install ffmpeg and yt-dlp with your distribution's package manager.";
  return `Set ${environmentNames[name]} to an executable path, or ${install}.${name === "python" ? " Install Python 3.12 (macOS: brew install python@3.12)." : ""}`;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES"].includes(String(error.code))) return false;
    throw new DvError("TOOL_NOT_FOUND", `Cannot inspect executable ${path}: ${String(error)}`, { cause: error, hint: "Check the executable path and filesystem permissions." });
  }
}

async function bundledTools(projectRoot: string): Promise<Partial<Record<ToolName, string>>> {
  const key = JSON.stringify([process.env.DSIVIO_VIDEO_DSIVIO, process.env.PATH, homedir(), projectRoot]);
  let pending = bundled.get(key);
  if (!pending) {
    pending = (async () => {
      let command: string;
      try { command = await dsivioCommand(); }
      catch (error) {
        if (error instanceof DvError && error.code === "GATEWAY_UNAVAILABLE") return {};
        throw error;
      }
      // Dsivio's Windows shim only forwards to its native executable. Do not invoke cmd.exe.
      if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
        let shim: string;
        try { shim = await readFile(command, "utf8"); }
        catch (error) { throw new DvError("TOOL_FAILED", `Cannot read Dsivio launcher ${command}`, { cause: error, hint: "Reinstall the Dsivio CLI." }); }
        const target = /^@"([^"\r\n]+)" %\*\s*$/.exec(shim)?.[1];
        if (!target || !isAbsolute(target)) return {};
        command = target;
      }
      let reply: RunResult;
      try { reply = await runTool(command, ["tools", "--json"], { cwd: projectRoot, timeoutMs: 5000, maxStdoutBytes: 1024 * 1024 }); }
      catch (error) {
        // Old or unavailable host CLIs are not a requirement for standalone tools.
        if (error instanceof DvError && ["TOOL_FAILED", "TOOL_TIMEOUT", "TOOL_OUTPUT_LIMIT"].includes(error.code)) return {};
        throw error;
      }
      let data: unknown;
      try { data = JSON.parse(reply.stdout.toString("utf8")); }
      catch { return {}; } // Older CLIs may print usage rather than a JSON tools reply.
      if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
      const paths: Partial<Record<ToolName, string>> = {};
      for (const name of toolNames) {
        const value: unknown = Reflect.get(data, name);
        if (typeof value === "string" && isAbsolute(value) && await executable(value)) paths[name] = value;
      }
      return paths;
    })();
    bundled.set(key, pending);
  }
  return pending;
}

export async function locateTool(name: ToolName, options: { projectRoot?: string } = {}): Promise<LocatedTool> {
  const root = resolve(options.projectRoot ?? process.cwd());
  const key = JSON.stringify([name, process.env[environmentNames[name]], process.env.DSIVIO_VIDEO_DSIVIO, process.env.PATH, homedir(), root]);
  let pending = located.get(key);
  if (!pending) {
    pending = (async () => {
      const override = process.env[environmentNames[name]];
      if (override) {
        const path = resolve(root, override);
        if (await executable(path)) return { name, path, source: "env" };
        throw new DvError("TOOL_NOT_FOUND", `${environmentNames[name]} is not an executable file: ${path}`, { hint: installHint(name) });
      }
      const tools = await bundledTools(root);
      if (tools[name]) return { name, path: tools[name], source: "dsivio" };
      const candidates = name === "python" ? ["python3", "python"] : [name];
      const filenames = process.platform === "win32" ? candidates.map((candidate) => `${candidate}.exe`) : candidates;
      for (const directory of (process.env.PATH ?? "").split(delimiter)) {
        if (!directory) continue;
        for (const filename of filenames) {
          const path = resolve(root, directory, filename);
          if (await executable(path)) return { name, path, source: "path" };
        }
      }
      for (const filename of filenames) {
        const path = join(homedir(), ".dsivio-video", "tools", filename);
        if (await executable(path)) return { name, path, source: "managed" };
      }
      throw new DvError("TOOL_NOT_FOUND", `Cannot find ${name}`, { hint: installHint(name) });
    })();
    located.set(key, pending);
    pending.catch(() => located.delete(key));
  }
  return pending;
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = process.platform === "win32" ? ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"] : ["PATH"];
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.includes(process.platform === "win32" ? key.toUpperCase() : key)) env[key] = value;
  }
  return env;
}

/** Run a located tool or an absolute executable without a shell or credential inheritance. */
export async function runTool(tool: ToolName | LocatedTool | string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const label = typeof tool === "string" ? tool : tool.name;
  const aborted = (): DvError => new DvError("ABORTED", `${label} was interrupted`, { cause: options.signal?.reason, hint: "Retry the command when ready." });
  if (options.signal?.aborted) throw aborted();
  let command: string;
  if (typeof tool !== "string") command = tool.path;
  else if (toolNames.includes(tool as ToolName)) command = (await locateTool(tool as ToolName, options.cwd ? { projectRoot: options.cwd } : {})).path;
  else if (isAbsolute(tool)) command = tool;
  else throw new DvError("TOOL_NOT_FOUND", `Expected a tool name or absolute executable path: ${tool}`, { hint: "Use an absolute executable path." });
  if (options.signal?.aborted) throw aborted();
  const timeoutMs = options.timeoutMs ?? 600_000;
  const maxStdoutBytes = options.maxStdoutBytes ?? 256 * 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 0) throw new DvError("TOOL_FAILED", "Tool limits must be non-negative safe integers", { hint: "Pass timeoutMs and maxStdoutBytes as integer limits." });
  return await new Promise<RunResult>((fulfill, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: minimalEnvironment(), shell: false, stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let total = 0;
    let stderr = "";
    let stderrLine = "";
    let failure: DvError | undefined;
    const stop = (error: DvError): void => {
      if (!failure) failure = error;
      child.kill("SIGKILL");
    };
    const onAbort = (): void => stop(aborted());
    const timer = setTimeout(() => stop(new DvError("TOOL_TIMEOUT", `${label} exceeded ${timeoutMs} ms`, { hint: "Increase timeoutMs or reduce the operation's size." })), timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const callbackFailure = (error: unknown): void => stop(error instanceof DvError ? error : new DvError("TOOL_FAILED", `${label} output handler failed: ${String(error)}`, { cause: error, hint: "Check the output handler and tool output." }));
    child.stdout!.on("data", (chunk: Buffer) => {
      if (failure) return;
      total += chunk.length;
      if (total > maxStdoutBytes) {
        stop(new DvError("TOOL_OUTPUT_LIMIT", `${label} stdout exceeded ${maxStdoutBytes} bytes`, { hint: "Increase maxStdoutBytes or request less output." }));
        return;
      }
      if (options.collectStdout !== false) chunks.push(chunk);
      try { options.onStdoutChunk?.(chunk); }
      catch (error) { callbackFailure(error); }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
      if (!options.onStderrLine || failure) return;
      stderrLine += chunk;
      let end: number;
      while ((end = stderrLine.search(/[\r\n]/)) >= 0) {
        const line = stderrLine.slice(0, end);
        stderrLine = stderrLine.slice(end + 1);
        try { options.onStderrLine(line); }
        catch (error) { callbackFailure(error); break; }
      }
    });
    child.on("error", (error) => { if (!failure) failure = new DvError("TOOL_FAILED", `Cannot start ${label}: ${error.message}`, { cause: error, hint: "Check executable permissions and its required runtime." }); });
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      // EPIPE means the tool closed stdin; the exit status remains authoritative.
      if (error.code !== "EPIPE") stop(new DvError("TOOL_FAILED", `Cannot write ${label} stdin: ${error.message}`, { cause: error, hint: "Check the input and tool diagnostics." }));
    });
    if (options.input !== undefined) child.stdin!.end(options.input);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (!failure && stderrLine && options.onStderrLine) {
        try { options.onStderrLine(stderrLine); }
        catch (error) { failure = error instanceof DvError ? error : new DvError("TOOL_FAILED", `${label} output handler failed: ${String(error)}`, { cause: error, hint: "Check the output handler." }); }
      }
      if (failure) reject(failure);
      else if (code !== 0) reject(new DvError("TOOL_FAILED", `${label} exited ${code ?? `with signal ${signal}`}\n${stderr}`, { hint: "Check the arguments, input files, and stderr diagnostics." }));
      else fulfill({ stdout: Buffer.concat(chunks, options.collectStdout === false ? 0 : total), stderr });
    });
  });
}

export async function toolVersion(name: ToolName, options: { projectRoot?: string } = {}): Promise<string> {
  const tool = await locateTool(name, options);
  const result = await runTool(tool, [name === "ffmpeg" || name === "ffprobe" ? "-version" : "--version"], { timeoutMs: 5000, maxStdoutBytes: 1024 * 1024 });
  const version = (result.stdout.toString("utf8").trim() || result.stderr.trim()).split(/\r?\n/)[0];
  if (!version) throw new DvError("TOOL_FAILED", `${name} returned an empty version`, { hint: installHint(name) });
  return version;
}
