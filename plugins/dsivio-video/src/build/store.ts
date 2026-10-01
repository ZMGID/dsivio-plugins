import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionDefinition, Fact } from "../core/graph.ts";
import type { Json } from "../core/value.ts";
import { validateBuildId } from "./ids.ts";
import { DvError } from "../core/errors.ts";

export interface BuildRecord {
  id: string;
  definition: ExecutionDefinition;
  title: string | null;
  author: string;
  run: string;
  created: string;
  state: "staged" | "working" | "done";
  outcome: "open" | "complete" | "failed" | "cancelled";
  stopReason: string | null;
  cancelRequested: boolean;
}
export interface Operation {
  build: string;
  command: string;
  phase: "queued" | "submitting" | "submitted" | "done" | "failed";
  request: Json;
  summary: Record<string, Json>;
  backend: string | null;
  handle: Json | null;
  receipt: string | null;
  task: string | null;
  nextWake: number;
  progress: string | null;
  error: { code: string; message: string } | null;
}

export const WORKER_LEASE_MS = 15_000;
export interface WorkerOwner {
  token: string;
  pid: number;
  startedAt: string;
  heartbeatAt: number;
  stopRequested: boolean;
}

export class BuildStore {
  readonly db: DatabaseSync;
  constructor(stateDir: string) {
    mkdirSync(join(stateDir, "runtime"), { recursive: true });
    this.db = new DatabaseSync(join(stateDir, "runtime", "state.db"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS builds (
        id TEXT PRIMARY KEY, definition TEXT NOT NULL, title TEXT, author TEXT NOT NULL, run TEXT NOT NULL,
        created TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('staged','working','done')),
        outcome TEXT NOT NULL, stop_reason TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS facts (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, build TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
        command TEXT NOT NULL, fact TEXT NOT NULL, UNIQUE(build, command)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS operations (
        build TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE, command TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN ('queued','submitting','submitted','done','failed')),
        request TEXT NOT NULL, backend TEXT, handle TEXT, receipt TEXT, next_wake INTEGER NOT NULL,
        progress TEXT, error TEXT, task TEXT, summary TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(build, command)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS worker_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), token TEXT NOT NULL, pid INTEGER NOT NULL,
        started_at TEXT NOT NULL, heartbeat_at INTEGER NOT NULL, stop_requested INTEGER NOT NULL
      ) STRICT;`);
  }
  close(): void { this.db.close(); }

  insert(build: BuildRecord): void {
    validateBuildId(build.id);
    this.db.prepare(`INSERT INTO builds VALUES (?,?,?,?,?,?,?,?,?,?)`).run(build.id, JSON.stringify(build.definition), build.title, build.author, build.run, build.created, build.state, build.outcome, build.stopReason, Number(build.cancelRequested));
  }

  activate(id: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const owner = this.workerOwner();
      const ready = owner && owner.heartbeatAt >= Date.now() - WORKER_LEASE_MS && !owner.stopRequested;
      const activated = ready ? this.db.prepare("UPDATE builds SET state='working' WHERE id=? AND state='staged'").run(id).changes > 0 : false;
      this.db.exec("COMMIT");
      return activated;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  removeStaged(id: string): boolean {
    return this.db.prepare("DELETE FROM builds WHERE id=? AND state='staged'").run(id).changes > 0;
  }

  workerOwner(): WorkerOwner | undefined {
    const row = this.db.prepare("SELECT * FROM worker_owner WHERE singleton=1").get();
    return row ? { token: String(row.token), pid: Number(row.pid), startedAt: String(row.started_at), heartbeatAt: Number(row.heartbeat_at), stopRequested: row.stop_requested === 1 } : undefined;
  }

  acquireWorker(token: string, pid: number): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now(), owner = this.workerOwner();
      if (owner && owner.heartbeatAt >= now - WORKER_LEASE_MS) { this.db.exec("COMMIT"); return false; }
      this.db.prepare(`INSERT INTO worker_owner VALUES(1,?,?,?,?,0) ON CONFLICT(singleton) DO UPDATE SET
        token=excluded.token,pid=excluded.pid,started_at=excluded.started_at,heartbeat_at=excluded.heartbeat_at,stop_requested=0`).run(token, pid, new Date(now).toISOString(), now);
      this.db.exec("COMMIT");
      return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  ownsWorker(token: string): boolean {
    const owner = this.workerOwner();
    return owner?.token === token && owner.heartbeatAt >= Date.now() - WORKER_LEASE_MS;
  }

  heartbeatWorker(token: string): boolean {
    const now = Date.now();
    return this.db.prepare("UPDATE worker_owner SET heartbeat_at=? WHERE singleton=1 AND token=? AND stop_requested=0 AND heartbeat_at>=?").run(now, token, now - WORKER_LEASE_MS).changes > 0;
  }

  beginSubmission(op: Operation, token: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const owner = this.workerOwner(), build = this.read(op.build);
      const allowed = owner?.token === token && owner.heartbeatAt >= Date.now() - WORKER_LEASE_MS && !owner.stopRequested &&
        build?.state === "working" && build.outcome === "open" && !build.cancelRequested;
      if (allowed) this.saveOperation(op);
      this.db.exec("COMMIT");
      return allowed;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  releaseWorkerIfIdle(token: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.ownsWorker(token)) { this.db.exec("COMMIT"); return true; }
      if (this.db.prepare("SELECT 1 FROM builds WHERE state='working' LIMIT 1").get()) { this.db.exec("COMMIT"); return false; }
      this.db.prepare("DELETE FROM worker_owner WHERE singleton=1 AND token=?").run(token);
      this.db.exec("COMMIT");
      return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  requestWorkerStop(): boolean {
    return this.db.prepare("UPDATE worker_owner SET stop_requested=1 WHERE singleton=1 AND heartbeat_at>=?").run(Date.now() - WORKER_LEASE_MS).changes > 0;
  }

  releaseWorker(token: string): void {
    this.db.prepare("DELETE FROM worker_owner WHERE singleton=1 AND token=?").run(token);
  }

  read(id: string): BuildRecord | undefined {
    validateBuildId(id);
    const row = this.db.prepare("SELECT * FROM builds WHERE id=?").get(id);
    if (!row) return undefined;
    return {
      id: String(row.id), definition: JSON.parse(String(row.definition)) as ExecutionDefinition,
      title: row.title === null ? null : String(row.title), author: String(row.author), run: String(row.run),
      created: String(row.created), state: String(row.state) as BuildRecord["state"],
      outcome: String(row.outcome) as BuildRecord["outcome"], stopReason: row.stop_reason === null ? null : String(row.stop_reason),
      cancelRequested: row.cancel_requested === 1,
    };
  }

  working(): BuildRecord[] {
    return this.db.prepare("SELECT id FROM builds WHERE state='working' ORDER BY created,id").all().map((row) => this.read(String(row.id))!);
  }

  /** Stable Build identity cursor, including staged and result-save-pending work. */
  list(options: { before?: string; limit?: number } = {}): BuildRecord[] {
    if (options.before !== undefined) validateBuildId(options.before);
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new DvError("BUILD_LIST_INVALID", "Build limit must be a positive safe integer.");
    const rows = options.before === undefined
      ? this.db.prepare("SELECT id FROM builds ORDER BY id DESC LIMIT ?").all(limit)
      : this.db.prepare("SELECT id FROM builds WHERE id < ? ORDER BY id DESC LIMIT ?").all(options.before, limit);
    return rows.map((row) => this.read(String(row.id))!);
  }

  facts(id: string): Fact[] {
    return this.db.prepare("SELECT fact FROM facts WHERE build=? ORDER BY seq").all(id).map((row) => JSON.parse(String(row.fact)) as Fact);
  }

  commitFact(id: string, fact: Fact, operation?: Operation, ownerToken?: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (ownerToken && !this.ownsWorker(ownerToken)) throw new DvError("WORKER_OWNERSHIP_LOST", "The worker no longer owns the execution lease");
      this.db.prepare("INSERT INTO facts(build,command,fact) VALUES(?,?,?)").run(id, fact.command, JSON.stringify(fact));
      if (operation) this.saveOperation(operation);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  operations(id: string): Operation[] {
    return this.db.prepare("SELECT * FROM operations WHERE build=? ORDER BY command").all(id).map((row) => ({
      build: String(row.build), command: String(row.command), phase: String(row.phase) as Operation["phase"],
      request: JSON.parse(String(row.request)) as Json, backend: row.backend === null ? null : String(row.backend),
      handle: row.handle === null ? null : JSON.parse(String(row.handle)) as Json,
      task: row.task === null ? null : String(row.task), summary: JSON.parse(String(row.summary)) as Record<string, Json>,
      receipt: row.receipt === null ? null : String(row.receipt), nextWake: Number(row.next_wake),
      progress: row.progress === null ? null : String(row.progress),
      error: row.error === null ? null : JSON.parse(String(row.error)) as Operation["error"],
    }));
  }

  saveOperation(op: Operation, ownerToken?: string): boolean {
    if (ownerToken) this.db.exec("BEGIN IMMEDIATE");
    try {
      if (ownerToken && !this.ownsWorker(ownerToken)) { this.db.exec("COMMIT"); return false; }
      this.db.prepare(`INSERT INTO operations(build,command,phase,request,backend,handle,receipt,next_wake,progress,error,task,summary) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(build,command) DO UPDATE SET
        phase=excluded.phase,request=excluded.request,backend=excluded.backend,handle=excluded.handle,
        receipt=excluded.receipt,next_wake=excluded.next_wake,progress=excluded.progress,error=excluded.error,
        task=excluded.task,summary=excluded.summary`).run(
        op.build, op.command, op.phase, JSON.stringify(op.request), op.backend, op.handle === null ? null : JSON.stringify(op.handle),
        op.receipt, op.nextWake, op.progress, op.error === null ? null : JSON.stringify(op.error), op.task, JSON.stringify(op.summary));
      if (ownerToken) this.db.exec("COMMIT");
      return true;
    } catch (error) {
      if (ownerToken) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  cancel(id: string, reason: string): boolean {
    return this.db.prepare("UPDATE builds SET cancel_requested=1,stop_reason=? WHERE id=? AND state='working' AND outcome='open'").run(reason, id).changes > 0;
  }
  decide(id: string, outcome: BuildRecord["outcome"], reason: string | null): void {
    this.db.prepare("UPDATE builds SET outcome=?,stop_reason=? WHERE id=? AND outcome='open'").run(outcome, reason, id);
  }
  finish(id: string, outcome: BuildRecord["outcome"], reason: string | null): void {
    this.db.prepare("UPDATE builds SET state='done',outcome=?,stop_reason=? WHERE id=?").run(outcome, reason, id);
  }
}
