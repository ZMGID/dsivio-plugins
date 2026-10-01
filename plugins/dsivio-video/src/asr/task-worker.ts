import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { StandaloneLedger } from "../gateway/standalone-ledger.ts";
import { transcribeLocal, stopAsr } from "./service.ts";
import { parseAsrReply } from "./client.ts";
import { DvError } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
const [root, id] = process.argv.slice(2);
if (!root || !id) throw new DvError("ASR_TASK_INVALID", "Local worker requires ledger root and task identity");
const ledger = await StandaloneLedger.open(root);
const abort = new AbortController();
let watcher: NodeJS.Timeout | undefined, stopped = false;
try {
  // Submission process owns evidence preparation, then transfers this exact spawned child identity.
  for (let tries = 0; ledger.get(id).ownerPid !== process.pid && tries < 100; tries++) await sleep(20);
  const task = ledger.get(id);
  if (task.ownerPid !== process.pid || task.state !== "submitting") throw new DvError("ASR_OWNER_LOST", "Local worker did not receive its submission claim");
  const args = task.request.arguments;
  if (typeof args.audioFile !== "string" || typeof args.language !== "string" || typeof args.sampleFrames !== "number") throw new DvError("ASR_TASK_INVALID", "Invalid local task evidence");
  const audioPath = task.stages.audioPath;
  if (typeof audioPath !== "string" || audioPath !== join(root, "outputs", id, "audio.wav")) throw new DvError("ASR_TASK_INVALID", "Task has no owned immutable audio snapshot");
  const config = task.stages.asrConfig;
  const asr = config !== null && typeof config === "object" && !Array.isArray(config) ? config : {};
  if (task.request.model !== "local/whisperx-small") throw new DvError("MODEL_DESCRIPTION_CHANGED", "Local ASR model identity changed; replan before execution");
  const inferenceModel = task.request.model.slice("local/whisperx-".length);
  ledger.change(id, current => { current.state = "accepted"; current.stage = "local-inference"; current.acceptedAt = new Date().toISOString(); });
  watcher = setInterval(() => { if (ledger.get(id).stages.cancelRequestedAt) abort.abort(new DvError("ABORTED", "Local task cancellation requested")); }, 100);
  if (task.stages.cancelRequestedAt) abort.abort(new DvError("ABORTED", "Local task cancelled before inference"));
  const result = await transcribeLocal(audioPath, args.language, abort.signal, { taskId: id, sampleFrames: args.sampleFrames, timestamps: args.timestamps === "segment" ? "segment" : "word", autoInstall: asr.autoInstall !== false, model: inferenceModel, languages: [args.language], onProgress: line => process.stderr.write(`${line}\n`) });
  const reply = parseAsrReply(result.reply);
  if (reply.schema !== "dsivio.media.transcript/1" || reply.sampleFrames !== args.sampleFrames || reply.language !== args.language) throw new DvError("ASR_RESPONSE_INVALID", "Local service evidence does not match task input");
  await stopAsr(); stopped = true;
  const contents = JSON.stringify(reply), output = join(root, "outputs", id, "transcript.json");
  await writeFile(output, contents, { mode: 0o600 });
  ledger.change(id, current => {
    if (current.stages.cancelRequestedAt || abort.signal.aborted) { current.state = "cancelled"; current.cancellation = { requestedAt: String(current.stages.cancelRequestedAt), outcome: "confirmed", scope: "local", charged: "no" }; current.outputs = []; delete current.ownerPid; return; }
    current.state = "succeeded"; current.stage = "completed"; current.result = reply as unknown as Json; current.outputs = [{ path: output, mime: "application/json", bytes: Buffer.byteLength(contents), sha256: createHash("sha256").update(contents).digest("hex"), metadata: { sampleRate: 16000, sampleFrames: args.sampleFrames! } }]; delete current.ownerPid;
  });
} catch (error) {
  try { await stopAsr(); stopped = true; } catch (stopError) { error = stopError; }
  ledger.change(id, task => { if (task.state === "cancelled" || task.state === "succeeded") return; if (abort.signal.aborted && stopped) { task.state = "cancelled"; task.outputs = []; task.cancellation = { requestedAt: String(task.stages.cancelRequestedAt ?? new Date().toISOString()), outcome: "confirmed", scope: "local", charged: "no" }; } else { task.state = "failed"; task.error = { code: error instanceof DvError ? error.code : "ASR_FAILED", message: error instanceof Error ? error.message : String(error) }; } delete task.ownerPid; });
} finally { clearInterval(watcher); try { if (!stopped) await stopAsr(); } finally { ledger.close(); } }
