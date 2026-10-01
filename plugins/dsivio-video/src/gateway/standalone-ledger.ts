import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
import { assertPrivate, privateDirectory, secureNewPrivateFile } from "./standalone-config.ts";
import type { ProviderRequest } from "./providers/types.ts";
import type { SavedOutput } from "./providers/artifacts.ts";

export type LedgerRequest = Omit<ProviderRequest, "kind"> & { kind: ProviderRequest["kind"] | "transcribe" };
export interface StandaloneTask {
  id: string; providerId: string; idempotencyKey: string; requestHash: string; adapterVersion: string; request: LedgerRequest;
  state: "prepared" | "submitting" | "accepted" | "succeeded" | "rejected" | "uncertain" | "failed" | "cancelled";
  stage: string; stages: Record<string, Json>; createdAt: string; acceptedAt?: string; receipt?: string;
  outputs: SavedOutput[]; error?: { code: string; message: string }; ownerPid?: number; queryFailures: number; nextPollAt?: number;
  cancellation?: { requestedAt: string; outcome: "confirmed" | "unsupported" | "too-late"; scope: "local" | "none"; charged: "no" | "maybe" | "unknown" };
  usage?: Json; result?: Json; capabilitySnapshot?: Json; providedArguments?: string[];
  queryClaim?: { token: string; pid: number; startedAt: number };
}
export class StandaloneLedger {
  readonly db: DatabaseSync;
  readonly root: string;
  private constructor(root: string, db: DatabaseSync) { this.root = root; this.db = db; }
  static async open(root: string): Promise<StandaloneLedger> {
    await privateDirectory(root);
    const path = join(root, "tasks.sqlite");
    try { await assertPrivate(path); } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      let created = false;
      try { const file = await open(path, "wx", 0o600); await file.close(); created = true; }
      catch (cause) { if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "EEXIST")) throw cause; }
      if (created) await secureNewPrivateFile(path); else await assertPrivate(path);
    }
    // Keep the database's journal mode: switching it during another worker's transaction bypasses busy_timeout.
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, operation_key TEXT NOT NULL, request_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(provider_id,operation_key)); CREATE TABLE IF NOT EXISTS voices (provider_id TEXT NOT NULL, voice_id TEXT NOT NULL, task_id TEXT NOT NULL, authorization_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, used_at TEXT, PRIMARY KEY(provider_id,voice_id));");
    } catch (error) {
      db.close();
      throw error;
    }
    for (const suffix of ["", "-wal", "-shm"]) { try { await assertPrivate(path + suffix); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) { db.close(); throw error; } } }
    return new StandaloneLedger(root, db);
  }
  static async openExisting(root: string): Promise<StandaloneLedger | undefined> {
    try { await assertPrivate(root, true); await assertPrivate(join(root, "tasks.sqlite")); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
    const db = new DatabaseSync(join(root, "tasks.sqlite"), { readOnly: true }); db.exec("PRAGMA busy_timeout=5000;");
    return new StandaloneLedger(root, db);
  }
  close(): void { this.db.close(); }
  get(id: string): StandaloneTask {
    const row = this.db.prepare("SELECT body FROM tasks WHERE id=?").get(id);
    if (!row || typeof row.body !== "string") throw new DvError("GATEWAY_TASK_MISSING", "Standalone task was not found in the account ledger");
    return JSON.parse(row.body) as StandaloneTask;
  }
  find(providerId: string, key: string): StandaloneTask | undefined {
    const row = this.db.prepare("SELECT body FROM tasks WHERE provider_id=? AND operation_key=?").get(providerId, key);
    if (!row) return undefined;
    if (typeof row.body !== "string") throw new DvError("GATEWAY_LEDGER_INVALID", "Standalone task record is invalid");
    return JSON.parse(row.body) as StandaloneTask;
  }
  prepare(providerId: string, idempotencyKey: string, requestHash: string, adapterVersion: string, request: LedgerRequest): StandaloneTask {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT body, request_hash FROM tasks WHERE provider_id=? AND operation_key=?").get(providerId, idempotencyKey);
      if (existing) { if (existing.request_hash !== requestHash) throw new DvError("IDEMPOTENCY_CONFLICT", "The same provider/idempotency key was already used for a different immutable request"); const task = JSON.parse(String(existing.body)) as StandaloneTask; this.db.exec("COMMIT"); return task; }
      const task: StandaloneTask = { id: randomUUID(), providerId, idempotencyKey, requestHash, adapterVersion, request, state: "prepared", stage: "prepared", stages: {}, createdAt: new Date().toISOString(), outputs: [], queryFailures: 0 };
      this.db.prepare("INSERT INTO tasks(id,provider_id,operation_key,request_hash,body) VALUES(?,?,?,?,?)").run(task.id, providerId, idempotencyKey, requestHash, JSON.stringify(task)); this.db.exec("COMMIT"); return task;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  change(id: string, fn: (task: StandaloneTask) => void): StandaloneTask {
    this.db.exec("BEGIN IMMEDIATE");
    try { const task = this.get(id); fn(task); this.db.prepare("UPDATE tasks SET body=? WHERE id=?").run(JSON.stringify(task), id); this.db.exec("COMMIT"); return task; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  claimQuery(id: string): string | undefined {
    let token: string | undefined;
    this.change(id, task => {
      if (task.state !== "accepted" || (task.nextPollAt ?? 0) > Date.now()) return;
      if (task.queryClaim) {
        let alive = true; try { process.kill(task.queryClaim.pid, 0); } catch (error) { alive = !(error && typeof error === "object" && "code" in error && error.code === "ESRCH"); }
        if (alive && Date.now() - task.queryClaim.startedAt < 10 * 60_000) return;
      }
      token = randomUUID(); task.queryClaim = { token, pid: process.pid, startedAt: Date.now() }; task.nextPollAt = Date.now() + 10_000;
    });
    return token;
  }
  changeQuery(id: string, token: string, fn: (task: StandaloneTask) => void): boolean {
    let changed = false;
    this.change(id, task => {
      if (task.state !== "accepted" || task.queryClaim?.token !== token) return;
      fn(task); changed = true;
    });
    return changed;
  }
  claim(id: string): boolean {
    let claimed = false;
    this.change(id, task => {
      if (task.ownerPid) { let alive = true; try { process.kill(task.ownerPid, 0); } catch (error) { alive = !(error && typeof error === "object" && "code" in error && error.code === "ESRCH"); } if (alive) return; delete task.ownerPid;
        if (task.stage.endsWith("-submitting") || (task.state === "submitting" && task.stage === "prepared")) { task.state = "uncertain"; task.error = { code: "GATEWAY_UNCERTAIN", message: `Owner exited during ${task.stage}; manually verify with provider, never resubmit this operation` }; return; }
      }
      if (task.stage === "synthesized" && task.outputs.length) return;
      if (task.state === "submitting" && task.stage.endsWith("-accepted")) { task.state = "uncertain"; task.error = { code: "GATEWAY_UNCERTAIN", message: "Provider accepted synchronous operation but no durable artifact exists; preserve receipt for manual verification, never resubmit" }; return; }
      if (task.state !== "prepared" && task.state !== "submitting") return;
      task.ownerPid = process.pid; task.state = "submitting"; claimed = true;
    }); return claimed;
  }
  stage(id: string, name: string, receipt?: Json): void {
    this.change(id, task => {
      if (task.ownerPid !== process.pid || task.state !== "submitting") throw new DvError("GATEWAY_OWNER_LOST", "Submission owner lost its durable claim");
      task.stage = name; if (receipt !== undefined) task.stages[name] = receipt;
      if (name.endsWith("-accepted") && receipt && typeof receipt === "object" && !Array.isArray(receipt) && typeof receipt.remoteId === "string") {
        if (task.receipt && task.receipt !== receipt.remoteId) throw new DvError("GATEWAY_RECEIPT_CHANGED", "Submission returned another receipt");
        task.receipt = receipt.remoteId; task.acceptedAt ??= new Date().toISOString();
        if (name === "video-accepted") { task.state = "accepted"; task.nextPollAt = Date.now() + 10_000; delete task.ownerPid; }
      }
    });
  }
  voice(providerId: string, voiceId: string, taskId: string, authorizationHash: string, used = false): void {
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO voices(provider_id,voice_id,task_id,authorization_hash,created_at,expires_at,used_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider_id,voice_id) DO UPDATE SET used_at=excluded.used_at,expires_at=excluded.expires_at").run(providerId, voiceId, taskId, authorizationHash, now, used ? null : new Date(Date.now() + 7 * 86400_000).toISOString(), used ? now : null);
  }
  checkVoice(providerId: string, voiceId: string): void {
    const own = this.db.prepare("SELECT expires_at FROM voices WHERE provider_id=? AND voice_id=?").get(providerId, voiceId);
    const other = this.db.prepare("SELECT 1 FROM voices WHERE voice_id=? AND provider_id<>?").get(voiceId, providerId);
    if (other && !own) throw new DvError("GATEWAY_VOICE_ACCOUNT", "Clone voice belongs to a different provider connection");
    if (own && typeof own.expires_at === "string" && Date.parse(own.expires_at) <= Date.now()) throw new DvError("GATEWAY_VOICE_EXPIRED", "Unused temporary clone voice has expired; a new authorized operation is required");
  }
}
