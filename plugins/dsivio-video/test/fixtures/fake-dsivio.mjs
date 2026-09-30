#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// FAKE_DSIVIO_DIR/config.json controls this real subprocess. Fields:
// models: live model entries; runningStatuses: pending polls before terminal status;
// finalStatus: succeeded|failed; error, canResume, remoteId, submissionState;
// submitExit: exit without JSON unless submitReply:true emits a recoverable task;
// submitDelayMs: pause after accepting/persisting a task, before returning its id.
// exit6: true or an array of commands (models,image,video,status); statusExit;
// outputs: optional explicit output list. calls.jsonl records args and prompt text;
// state.json persists tasks, idempotency keys and per-task poll counts.
const dir = process.env.FAKE_DSIVIO_DIR;
if (!dir) { console.error("FAKE_DSIVIO_DIR is required"); process.exit(2); }
mkdirSync(dir, { recursive: true });
const configFile = join(dir, "config.json");
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
const stateFile = join(dir, "state.json");
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { tasks: {}, keys: {}, next: 1 };
const args = process.argv.slice(2);
const command = args[1];
const one = (flag) => { const index = args.indexOf(flag); return index === -1 ? undefined : args[index + 1]; };
const promptFile = one("--prompt-file");
appendFileSync(join(dir, "calls.jsonl"), JSON.stringify({ args, ...(promptFile ? { prompt: readFileSync(promptFile, "utf8") } : {}) }) + "\n");
if (args[0] !== "media") { console.error("Expected media"); process.exit(2); }
if (config.exit6 === true || (Array.isArray(config.exit6) && config.exit6.includes(command))) { console.error("Dsivio is closed"); process.exit(6); }
const save = () => writeFileSync(stateFile, JSON.stringify(state));
const print = (data) => console.log(JSON.stringify(data));
const imageCaps = { maxReferenceImages: 16, sizes: ["1K", "2K", "4K"], ratios: ["1:1", "16:9", "9:16"], qualities: ["auto", "high"], maxCount: 4, customPixelSize: true };
const videoCaps = { modes: ["text", "image", "frames", "reference"], durations: [5, 8], resolutions: ["720p", "1080p"], ratios: ["16:9", "9:16"], audioToggle: true, firstFrame: true, lastFrame: true, lastFrameNeedsFirst: true, maxReferenceImages: 3, maxReferenceVideos: 2, maxReferenceAudios: 2, referenceAudioNeedsVisual: true, framesExcludeReferences: true, localReferenceMedia: true, maxPromptLength: 1000, defaults: { duration: 5, resolution: "720p", ratio: "9:16" } };
if (command === "models") {
  const models = config.models ?? [
    { id: "openai/gpt-image-2", kind: "image", known: true, capabilities: imageCaps },
    { id: "volcengine/doubao-seedance-2-5", kind: "video", known: true, capabilities: videoCaps },
  ];
  print(models.filter((model) => !one("--kind") || model.kind === one("--kind")));
} else if (command === "image" || command === "video") {
  if (config.submitExit && !config.submitReply) { console.error(config.error ?? "Scripted submission failure"); process.exit(config.submitExit); }
  const key = one("--idempotency-key");
  if (!key || !one("--model") || !promptFile || !args.includes("--no-wait") || one("--source") !== "dsivio-video") { console.error("Missing required submission flag"); process.exit(2); }
  let id = state.keys[key];
  if (!id) {
    id = `task-${state.next++}`;
    state.keys[key] = id;
    state.tasks[id] = { id, kind: command, status: "running", model: one("--model"), remoteId: config.remoteId === undefined ? `remote-${id}` : config.remoteId, outputs: [], error: null, canResume: false, polls: 0 };
    save();
  }
  if (config.submitDelayMs) await delay(config.submitDelayMs);
  const { polls, ...task } = state.tasks[id];
  print(task);
  if (config.submitExit) process.exit(config.submitExit);
} else if (command === "status") {
  const id = args[2];
  const task = state.tasks[id];
  if (!task) { console.error("Unknown task"); process.exit(2); }
  task.polls++;
  if (task.polls > (config.runningStatuses ?? 0)) {
    task.status = config.finalStatus ?? "succeeded";
    task.error = task.status === "failed" ? config.error ?? "Scripted generation failure" : null;
    task.canResume = config.canResume ?? false;
    task.submissionState = config.submissionState ?? null;
    if (config.remoteId !== undefined) task.remoteId = config.remoteId;
    if (task.status === "succeeded") {
      const path = join(dir, `${id}.${task.kind === "image" ? "png" : "mp4"}`);
      const bytes = task.kind === "image" ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII=", "base64") : Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]);
      writeFileSync(path, bytes);
      task.outputs = config.outputs ?? [{ path, mime: task.kind === "image" ? "image/png" : "video/mp4" }];
    }
  }
  save();
  const { polls, ...reply } = task;
  print(reply);
  if (config.statusExit) process.exit(config.statusExit);
  if (task.status === "failed") process.exit(task.submissionState === "rejected" ? 3 : task.remoteId ? 4 : 5);
} else { console.error("Unknown media command"); process.exit(2); }
