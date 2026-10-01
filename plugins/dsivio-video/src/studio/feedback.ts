import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { realpathSync } from "node:fs";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { DvError } from "../core/errors.ts";
import type { FeedbackComment, CommentsList } from "./protocol.ts";
export type { FeedbackComment, NumberedComment, CommentsList } from "./protocol.ts";

export type CommentState = "open" | "resolved" | "all";
interface FeedbackDocument { [key: string]: unknown; schema: "dsivio-video.feedback/1"; comments: FeedbackComment[] }
interface Snapshot { text: string | null; document: FeedbackDocument; revision: string }
const queues = new Map<string, Promise<void>>();

export function feedbackRevision(text: string | null): string { return createHash("sha256").update(text ?? "").digest("hex"); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validRun(run: string): boolean {
  return run.length > 0 && !run.includes("\\") && !run.includes("\0") && !isAbsolute(run) && !/^[A-Za-z]:/.test(run) && posix.normalize(run) === run && run !== "." && run !== ".." && !run.startsWith("../");
}
function validateComment(value: unknown): asserts value is FeedbackComment {
  if (!object(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.run !== "string" || !validRun(value.run) || typeof value.at !== "number" || !Number.isFinite(value.at) || value.at < 0 || typeof value.text !== "string" || !value.text.trim() || (value.resolved !== undefined && typeof value.resolved !== "boolean")) throw new DvError("FEEDBACK_INVALID", "Comment requires a unique non-empty id, normalized Run, non-negative time, non-empty text and optional boolean resolved.");
}
export function parseFeedback(text: string): FeedbackDocument {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { throw new DvError("FEEDBACK_INVALID", "FEEDBACK.json is not valid JSON.", { cause: error }); }
  if (!object(parsed) || parsed.schema !== "dsivio-video.feedback/1" || !Array.isArray(parsed.comments)) throw new DvError("FEEDBACK_INVALID", "FEEDBACK.json requires schema dsivio-video.feedback/1 and a comments array.");
  const ids = new Set<string>();
  for (const comment of parsed.comments) {
    validateComment(comment);
    if (ids.has(comment.id)) throw new DvError("FEEDBACK_INVALID", `Duplicate comment id: ${comment.id}`);
    ids.add(comment.id);
  }
  return parsed as FeedbackDocument;
}

/** Independent of video revisions; each mutation checks the complete latest disk document. */
export class FeedbackStore {
  readonly root: string;
  readonly path: string;
  readonly run: string;
  constructor(workspaceRoot: string, runFile: string) {
    try { this.root = realpathSync(resolve(workspaceRoot)); }
    catch (error) { throw new DvError("FEEDBACK_RUN", "Cannot resolve feedback workspace.", { cause: error }); }
    this.path = join(this.root, "FEEDBACK.json");
    let ancestor = resolve(runFile);
    const suffix: string[] = [];
    while (true) {
      try { ancestor = join(realpathSync(ancestor), ...suffix); break; }
      catch (error) {
        if (!object(error) || (error.code !== "ENOENT" && error.code !== "ENOTDIR") || dirname(ancestor) === ancestor) throw new DvError("FEEDBACK_RUN", "Cannot resolve feedback Run.", { cause: error });
        suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
      }
    }
    this.run = relative(this.root, ancestor).split(sep).join("/");
    if (!validRun(this.run)) throw new DvError("FEEDBACK_RUN", "Run must be a file within the workspace.");
  }
  private async text(): Promise<string | null> {
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || await realpath(this.path) !== this.path) throw new DvError("FEEDBACK_INVALID", "FEEDBACK.json must be a regular workspace file, not a symbolic link.");
      return await readFile(this.path, "utf8");
    } catch (error) {
      if (object(error) && error.code === "ENOENT") return null;
      if (error instanceof DvError) throw error;
      throw new DvError("FEEDBACK_READ", "Cannot read FEEDBACK.json.", { cause: error });
    }
  }
  private async snapshot(): Promise<Snapshot> {
    const text = await this.text();
    return { text, document: text === null ? { schema: "dsivio-video.feedback/1", comments: [] } : parseFeedback(text), revision: feedbackRevision(text) };
  }
  async list(state: CommentState = "all"): Promise<CommentsList> {
    if (!["open", "resolved", "all"].includes(state)) throw new DvError("FEEDBACK_INVALID", "Comment state must be open, resolved or all.");
    const snapshot = await this.snapshot();
    const comments = snapshot.document.comments.filter((comment) => comment.run === this.run).map((comment, index) => ({ ...comment, expectedComment: comment, number: index + 1, resolved: comment.resolved ?? false })).filter((comment) => state === "all" || comment.resolved === (state === "resolved"));
    comments.sort((a, b) => a.at - b.at || a.number - b.number);
    return { schema: "dsivio-video.comments-list/1", run: this.run, commentsRevision: snapshot.revision, comments };
  }
  private async mutate(change: (document: FeedbackDocument) => void): Promise<CommentsList> {
    const previous = queues.get(this.path) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const original = await this.snapshot();
      change(original.document);
      const text = JSON.stringify(original.document, null, 2) + "\n";
      parseFeedback(text);
      if (await this.text() !== original.text) throw new DvError("FEEDBACK_CONFLICT", "FEEDBACK.json changed before saving. Reload comments; your draft is preserved.");
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, text, { flag: "wx" });
        if (await this.text() !== original.text) throw new DvError("FEEDBACK_CONFLICT", "FEEDBACK.json changed while saving. Reload comments; your draft is preserved.");
        await rename(temp, this.path);
      } catch (error) {
        await rm(temp, { force: true });
        if (error instanceof DvError) throw error;
        throw new DvError("FEEDBACK_WRITE", "Cannot save FEEDBACK.json.", { cause: error });
      }
      return this.list();
    });
    const settled = operation.then(() => undefined, () => undefined);
    queues.set(this.path, settled);
    try { return await operation; } finally { if (queues.get(this.path) === settled) queues.delete(this.path); }
  }
  async add(comment: unknown): Promise<CommentsList> {
    if (!object(comment)) throw new DvError("FEEDBACK_INVALID", "New comment must be an object.");
    const candidate = { ...comment, id: comment.id ?? `comment_${randomUUID()}`, run: this.run };
    validateComment(candidate);
    return this.mutate((document) => {
      if (document.comments.some((item) => item.id === candidate.id)) throw new DvError("FEEDBACK_CONFLICT", `Comment id already exists: ${candidate.id}`);
      document.comments.push(candidate);
    });
  }
  private existing(document: FeedbackDocument, id: string, expected: unknown): FeedbackComment {
    const comment = document.comments.find((item) => item.id === id && item.run === this.run);
    if (!comment) throw new DvError("FEEDBACK_NOT_FOUND", `Comment not found: ${id}`);
    // DTO-only numbering/default fields are not part of the old persisted comment.
    if (!isDeepStrictEqual(comment, expected)) throw new DvError("FEEDBACK_CONFLICT", `Comment ${id} changed. Reload comments; your draft is preserved.`);
    return comment;
  }
  async update(id: string, expectedComment: unknown, changes: unknown): Promise<CommentsList> {
    if (!object(changes) || Object.keys(changes).some((key) => !["at", "text", "resolved"].includes(key))) throw new DvError("FEEDBACK_INVALID", "Changes may contain only at, text and resolved.");
    return this.mutate((document) => {
      const comment = this.existing(document, id, expectedComment);
      const updated = { ...comment, ...changes };
      validateComment(updated);
      document.comments[document.comments.indexOf(comment)] = updated;
    });
  }
  async delete(id: string, expectedComment: unknown): Promise<CommentsList> {
    return this.mutate((document) => { const comment = this.existing(document, id, expectedComment); document.comments.splice(document.comments.indexOf(comment), 1); });
  }
}
