import { createHash } from "node:crypto";
import { readFileSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DvError } from "../core/errors.ts";

export interface StudioWatcherOptions {
  /** Run, loaded Source/Recipe closure, and referenced local assets. */
  files: readonly string[];
  /** FEEDBACK changes never dirty or compile the work. It may not exist yet. */
  feedbackFile?: string;
  onDirty: (files: readonly string[]) => void;
  onCompile: (files: readonly string[]) => void;
  onComments: () => void;
  onError: (error: DvError) => void;
}

/** Directory subscriptions survive atomic file replacement and compilation failure. */
export class StudioWatcher {
  private readonly options: StudioWatcherOptions;
  private readonly files = new Map<string, string>();
  private readonly directories = new Map<string, FSWatcher>();
  private readonly desiredDirectories = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly feedbackFile: string | undefined;
  private feedbackVersion: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(options: StudioWatcherOptions) {
    this.options = options;
    this.feedbackFile = options.feedbackFile === undefined ? undefined : resolve(options.feedbackFile);
    if (this.feedbackFile !== undefined) {
      this.feedbackVersion = this.version(this.feedbackFile);
      this.desiredDirectories.add(dirname(this.feedbackFile));
    }
    this.addFiles(options.files);
  }

  /** Add newly discovered imports/assets; never remove old subscriptions on errors. */
  addFiles(files: Iterable<string>): void {
    if (this.closed) return;
    for (const source of files) {
      const file = resolve(source);
      if (file === this.feedbackFile || this.files.has(file)) continue;
      this.files.set(file, this.version(file));
      this.desiredDirectories.add(dirname(file));
    }
    this.subscribeDirectories();
    // Close the baseline/subscription startup gap (fs.watch delivery is asynchronous).
    // This is a one-shot reconciliation, not polling or a second debounce.
    queueMicrotask(() => {
      if (this.closed) return;
      this.subscribeDirectories();
      for (const directory of this.desiredDirectories) this.inspect(directory, undefined);
    });
  }

  /** Adopt writes already compiled/scheduled by the caller, suppressing watcher echoes. */
  acknowledgeFiles(files: Iterable<string>): void {
    if (this.closed) return;
    for (const source of files) {
      const file = resolve(source);
      if (this.files.has(file)) this.files.set(file, this.version(file));
      this.pending.delete(file);
    }
    if (this.pending.size === 0) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    for (const watcher of this.directories.values()) watcher.close();
    this.directories.clear();
  }

  private version(file: string): string {
    try {
      if (!statSync(file).isFile()) throw new DvError("STUDIO_WATCH_IO", `Watched path is not a regular file: ${file}.`);
      return createHash("sha256").update(readFileSync(file)).digest("hex");
    } catch (cause) {
      if (cause !== null && typeof cause === "object" && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")) return "missing";
      const error = cause instanceof DvError ? cause : new DvError("STUDIO_WATCH_IO", `Cannot read watched file ${file}.`, { cause });
      const signature = `error:${error.message}:${cause !== null && typeof cause === "object" && "code" in cause ? String(cause.code) : ""}`;
      if ((file === this.feedbackFile ? this.feedbackVersion : this.files.get(file)) !== signature) this.options.onError(error);
      return signature;
    }
  }

  private subscribeDirectories(): void {
    for (const desired of this.desiredDirectories) {
      let directory = desired;
      // A missing import or FEEDBACK directory is covered by its nearest existing
      // ancestor. Creation events grow the directory subscriptions dynamically.
      while (!this.directories.has(directory)) {
        try {
          if (!statSync(directory).isDirectory()) {
            directory = dirname(directory);
            continue;
          }
          const watcher = watch(directory, (_event, filename) => {
            if (this.closed) return;
            this.subscribeDirectories();
            this.inspect(directory, filename === null ? undefined : filename.toString());
          });
          this.directories.set(directory, watcher);
          watcher.on("error", (cause: Error) => {
            watcher.close();
            this.directories.delete(directory);
            if (!this.closed) this.options.onError(new DvError("STUDIO_WATCH_IO", `Cannot watch directory ${directory}.`, { cause }));
          });
          break;
        } catch (cause) {
          if (cause !== null && typeof cause === "object" && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")) {
            const parent = dirname(directory);
            if (parent !== directory) {
              directory = parent;
              continue;
            }
          }
          this.options.onError(new DvError("STUDIO_WATCH_IO", `Cannot watch directory ${directory}.`, { cause }));
          break;
        }
      }
    }
  }

  private inspect(directory: string, filename: string | undefined): void {
    const changed: string[] = [];
    const candidate = filename === undefined ? directory : resolve(directory, filename);
    for (const [file, previous] of this.files) {
      const suffix = relative(candidate, file);
      if (suffix !== "" && (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`))) continue;
      const current = this.version(file);
      if (current === previous) continue;
      this.files.set(file, current);
      this.pending.add(file);
      changed.push(file);
    }
    if (changed.length > 0) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        const files = [...this.pending];
        this.pending.clear();
        if (!this.closed) this.options.onCompile(files);
      }, 80);
      this.options.onDirty(changed);
    }
    if (this.feedbackFile !== undefined) {
      const suffix = relative(candidate, this.feedbackFile);
      if (suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))) {
        const current = this.version(this.feedbackFile);
        if (current !== this.feedbackVersion) {
          this.feedbackVersion = current;
          this.options.onComments();
        }
      }
    }
  }
}
