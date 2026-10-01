#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { legacyDescription, withFactsRevision, validateAndResolve } from "../../src/gateway/description.ts";
import { probeProviderMedia, signatureMime } from "../../src/gateway/providers/artifacts.ts";

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
const promptFile = one("--prompt-file"), optionsFile = one("--options-file");
const submittedArgs = optionsFile ? JSON.parse(readFileSync(optionsFile, "utf8")) : {};
appendFileSync(join(dir, "calls.jsonl"), JSON.stringify({ args, ...(promptFile ? { prompt: readFileSync(promptFile, "utf8") } : {}), ...(optionsFile ? { arguments: submittedArgs } : {}) }) + "\n");
if (args[0] !== "media") { console.error("Expected media"); process.exit(2); }
if (config.exit6 === true || (Array.isArray(config.exit6) && config.exit6.includes(command))) { console.error("Dsivio is closed"); process.exit(6); }
const save = () => writeFileSync(stateFile, JSON.stringify(state));
const print = (data) => console.log(JSON.stringify(data));
const imageCaps = { maxReferenceImages: 16, sizes: ["1K", "2K", "4K"], ratios: ["1:1", "16:9", "9:16"], qualities: ["auto", "high"], maxCount: 4, customPixelSize: true };
const videoCaps = { modes: ["text", "image", "frames", "reference"], durations: [5, 8], resolutions: ["720p", "1080p"], ratios: ["16:9", "9:16"], audioToggle: true, firstFrame: true, lastFrame: true, lastFrameNeedsFirst: true, maxReferenceImages: 3, maxReferenceVideos: 2, maxReferenceAudios: 2, referenceAudioNeedsVisual: true, framesExcludeReferences: true, localReferenceMedia: true, maxPromptLength: 1000, defaults: { duration: 5, resolution: "720p", ratio: "9:16" } };
const media = (mime, maxCount) => ({ dataType: "mediaList", mimePatterns: [mime], maxCount, locations: ["local", "https"], transport: { encoding: "options-json" } });
const description = (identity, operation) => withFactsRevision({ descriptionVersion: 1, identity, operation, factsComplete: true, arguments: operation === "image" ? {
  prompt: { dataType: "string", required: true, minLength: 1 }, images: media("image/*", 16), aspectRatio: { dataType: "string", allowed: ["1:1", "16:9", "9:16"] }, size: { dataType: "string", allowed: ["1K", "2K", "4K"], pixelDimensions: true }, quality: { dataType: "string", allowed: ["auto", "high"] }, n: { dataType: "integer", minimum: 1, maximum: 4 },
} : { prompt: { dataType: "string", required: true, minLength: 1, maxLength: 1000 }, duration: { dataType: "integer", allowed: [5, 8], defaultValue: 5 }, resolution: { dataType: "string", allowed: ["720p", "1080p"], defaultValue: "720p" }, ratio: { ...{ dataType: "string", allowed: ["16:9", "9:16"], defaultValue: "9:16" }, transport: { optionKey: "ratio", encoding: "options-json" } }, generateAudio: { dataType: "boolean" }, firstFrame: media("image/*", 1), lastFrame: { ...media("image/*", 1), transport: { optionKey: "lastFrame", encoding: "options-json" } }, referenceImages: { ...media("image/*", 3), transport: { optionKey: "referenceImages", encoding: "options-json" } }, referenceVideos: media("video/*", 2), referenceAudios: media("audio/*", 2) },
  constraints: operation === "image" ? [] : [{ ruleId: "last-needs-first", when: { provided: "lastFrame" }, check: "require", arguments: ["firstFrame"] }], products: { mediaKind: operation, ordered: true, minCount: 1, maxCount: 4 }, lifecycle: { submission: "asynchronous", remoteCancel: "unsupported" }, billingInfo: null });
const defaultModels = [{ id: "openai/gpt-image-2", providerId: "openai", providerName: "OpenAI", model: "gpt-image-2", default: true, kind: "image", known: true, capabilities: imageCaps, description: description("openai/gpt-image-2", "image") }, { id: "volcengine/doubao-seedance-2-5", providerId: "volcengine", providerName: "Volcengine", model: "doubao-seedance-2-5", default: true, kind: "video", known: true, capabilities: videoCaps, description: description("volcengine/doubao-seedance-2-5", "video") }];
if (command === "models") {
  const models = config.models ?? defaultModels;
  print(models.filter((model) => !one("--kind") || model.kind === one("--kind")));
} else if (["image", "video", "speech", "transcribe"].includes(command)) {
  if (config.submitExit && !config.submitReply) { console.error(config.error ?? "Scripted submission failure"); process.exit(config.submitExit); }
  const key = one("--idempotency-key");
  if (!key || !one("--model") || !args.includes("--no-wait") || one("--source") !== "dsivio-video") { console.error("Missing required submission flag"); process.exit(2); }
  const model = (config.models ?? defaultModels).find(entry => entry.id === one("--model"));
  if (!model) { print({ code: "GEN_MODEL_NOT_ENABLED" }); process.exit(2); }
  const facts = model.description ?? legacyDescription(model);
  if (model.description && (!optionsFile || model.description.factsRevision !== one("--description-revision"))) { print({ code: "MODEL_DESCRIPTION_CHANGED" }); process.exit(2); }
  if (!model.description) for (const [name, descriptor] of Object.entries(facts.arguments)) {
    const flag = descriptor.transport?.flag, value = flag ? one(flag) : undefined;
    if (value === undefined) continue;
    submittedArgs[name] = descriptor.transport.encoding === "utf8-file" ? readFileSync(value, "utf8") : descriptor.dataType === "mediaList" ? args.flatMap((part, index) => part === flag ? [{ source: args[index + 1], attributes: {} }] : []) : ["integer", "number"].includes(descriptor.dataType) ? Number(value) : value;
  }
  try {
    if (model.description) for (const [name, descriptor] of Object.entries(facts.arguments)) if (descriptor.dataType === "mediaList" && !descriptor.opaqueSources) for (const entry of submittedArgs[name] ?? []) {
      const bytes = readFileSync(entry.source), mime = signatureMime(bytes);
      if (!mime) throw Object.assign(new Error("Unrecognized media signature"), { code: "MODEL_ARGUMENT_INVALID" });
      Object.assign(entry, { mime, bytes: bytes.length, ...await probeProviderMedia(entry.source, mime) });
    }
    validateAndResolve(facts, submittedArgs, { materialized: !!model.description });
  } catch (error) { print(error.detail ?? { code: error.code, message: error.message }); process.exit(2); }
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
    task.status = task.status === "cancelled" ? "cancelled" : config.finalStatus ?? "succeeded";
    task.error = task.status === "failed" ? config.error ?? "Scripted generation failure" : null;
    task.canResume = config.canResume ?? false;
    task.submissionState = config.submissionState ?? null;
    if (config.remoteId !== undefined) task.remoteId = config.remoteId;
    if (task.status === "succeeded") {
      if (task.kind === "transcribe") task.result = config.transcript;
      const path = join(dir, `${id}.${task.kind === "transcribe" ? "json" : task.kind === "image" ? "png" : "mp4"}`);
      const bytes = task.kind === "transcribe" ? Buffer.from(JSON.stringify(config.transcript ?? null)) : task.kind === "image" ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII=", "base64") : Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]);
      writeFileSync(path, bytes);
      task.outputs = config.outputs ?? [{ path, mime: task.kind === "transcribe" ? "application/json" : task.kind === "image" ? "image/png" : "video/mp4" }];
    }
  }
  save();
  const { polls, ...reply } = task;
  print(reply);
  if (config.statusExit) process.exit(config.statusExit);
  if (task.status === "failed") process.exit(task.submissionState === "rejected" ? 3 : task.remoteId ? 4 : 5);
  if (task.status === "cancelled") process.exit(7);
} else if (command === "cancel") {
  const task = state.tasks[args[2]];
  if (!task) process.exit(2);
  const outcome = task.status === "running" ? config.cancelOutcome ?? "confirmed" : task.status === "cancelled" ? "confirmed" : "too-late";
  if (outcome === "confirmed") { task.status = "cancelled"; task.outputs = []; task.cancellation = { requestedAt: new Date().toISOString(), scope: "local", outcome: "confirmed" }; save(); }
  print({ id: task.id, outcome, scope: outcome === "confirmed" ? "local" : "none", charged: outcome === "confirmed" ? "no" : "maybe", task });
} else if (command === "asr" && args[2] === "status") {
  print({ state: "ready", runtime: { state: "stopped", pid: null, activeTaskId: null } });
} else { console.error("Unknown media command"); process.exit(2); }
