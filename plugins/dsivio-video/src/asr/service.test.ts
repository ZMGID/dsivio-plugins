import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, WHISPERX_VERSION, asrSources } from "./install.ts";

const serviceUrl = new URL("./service.ts", import.meta.url).href;
const posix = { skip: process.platform === "win32", timeout: 15_000 };
// An actual child HTTP server, not replacements of the supervisor's methods.
// These tests cover ownership/lifecycle; real WhisperX inference is a separate smoke.
const childProtocol = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const tokenPath = flag('--token-file');
const token = fs.readFileSync(tokenPath, 'utf8').trim();
const root = fs.realpathSync(flag('--allow-root'));
const options = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'fixture.json'), 'utf8'));
let activeTaskId = null;
let stopping = false;
const activeWaiters = [];
const stop = () => { if (stopping) return; stopping = true; server.closeAllConnections(); server.close(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.stdin.resume();
process.stdin.on('end', stop);
const reply = (response, status, value) => { response.writeHead(status, {'Content-Type':'application/json'}); response.end(JSON.stringify(value)); };
const server = http.createServer((request, response) => {
 if (request.headers.authorization !== 'Bearer ' + token) { reply(response, 401, {error:{code:'UNAUTHORIZED',message:'Wrong session nonce'}}); return; }
 if (request.headers.origin || request.headers.host !== '127.0.0.1:' + server.address().port) { reply(response, 403, {error:{code:'FORBIDDEN',message:'Not a local supervisor request'}}); return; }
 if (request.url.startsWith('/fixture-active?')) {
  const id = new URL(request.url, 'http://localhost').searchParams.get('id');
  if (activeTaskId === id) reply(response, 200, {activeTaskId});
  else activeWaiters.push({id,response});
  return;
 }
 if (request.url === '/health') {
  reply(response, 200, {ok:true,protocol:${JSON.stringify(ASR_PROTOCOL)},serviceVersion:options.healthVersion ?? ${JSON.stringify(ASR_SERVICE_VERSION)},whisperxVersion:${JSON.stringify(WHISPERX_VERSION)},model:flag('--model'),device:flag('--device'),compute:flag('--compute'),batchSize:Number(flag('--batch-size')),busy:activeTaskId !== null,activeTaskId}); return;
 }
 let body = '';
 request.setEncoding('utf8');
 request.on('data', chunk => body += chunk);
 request.on('end', () => {
  const input = JSON.parse(body);
  if (request.url === '/shutdown') {
   if (activeTaskId) { reply(response, 409, {error:{code:'ASR_BUSY',message:'Inference active'}}); return; }
   if (options.shutdownModel) {
    const configPath = path.join(process.env.HOME,'.dsivio-video/asr',${JSON.stringify(ASR_SERVICE_VERSION)},'config.json');
    const config = JSON.parse(fs.readFileSync(configPath,'utf8'));
    config.model = options.shutdownModel;
    fs.writeFileSync(configPath,JSON.stringify(config));
   }
   response.once('finish', stop); reply(response, 200, {ok:true}); return;
  }
  if (request.url === '/cancel') {
   if (input.task_id !== activeTaskId) { reply(response, 200, {outcome:'too-late',taskId:input.task_id}); return; }
   response.once('finish', stop); reply(response, 200, {outcome:'requested',taskId:input.task_id}); return;
  }
  if (request.url !== '/transcribe') { reply(response, 404, {error:{code:'NOT_FOUND',message:'Unknown endpoint'}}); return; }
  if (activeTaskId) { reply(response, 409, {error:{code:'ASR_BUSY',message:'Inference active'}}); return; }
  const audio = fs.realpathSync(input.audio_path);
  if (path.dirname(audio) !== root) { reply(response, 400, {error:{code:'INVALID_AUDIO_PATH',message:'Outside owned evidence root'}}); return; }
  const wav = fs.readFileSync(audio);
  const frames = wav.readUInt32LE(40) / 2;
  if (wav.toString('ascii',0,4) !== 'RIFF' || wav.readUInt32LE(24) !== 16000 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16 || frames !== (wav.length - 44)/2 || input.sample_frames !== frames) { reply(response, 400, {error:{code:'INVALID_INPUT',message:'Invalid standard WAV evidence'}}); return; }
  fs.writeFileSync(path.join(process.env.HOME,'inference-started.json'),JSON.stringify({model:flag('--model')}));
  activeTaskId = input.task_id;
  for (const waiter of activeWaiters) if (waiter.id === activeTaskId) reply(waiter.response, 200, {activeTaskId});
  response.on('close', () => { if (activeTaskId === input.task_id && !response.writableEnded) stop(); });
  if (!options.holdInference) queueMicrotask(() => {
   if (stopping) return;
   activeTaskId = null;
   reply(response, 200, {schema:'dsivio.media.transcript/1',sampleRate:16000,sampleFrames:frames,engine:{backend:'local',model:options.replyModel ?? flag('--model'),protocol:${JSON.stringify(ASR_PROTOCOL)},serviceVersion:${JSON.stringify(ASR_SERVICE_VERSION)},whisperxVersion:${JSON.stringify(WHISPERX_VERSION)}},language:input.language,segments:[]});
  });
 });
});
server.listen(Number(flag('--port')), '127.0.0.1', () => {
 fs.writeFileSync(path.join(process.env.HOME,'last-child.json'), JSON.stringify({pid:process.pid}));
 console.log(JSON.stringify({pid:process.pid,port:server.address().port,protocol:${JSON.stringify(ASR_PROTOCOL)},serviceVersion:${JSON.stringify(ASR_SERVICE_VERSION)}}));
});
`;

async function execute(root: string, source: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { env: { ...process.env, HOME: root } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer) => { stdout += data; });
  child.stderr.on("data", (data: Buffer) => { stderr += data; });
  const done = Promise.withResolvers<{ code: number; stdout: string; stderr: string }>();
  // Safety deadline for an external process, never a guessed state-transition wait.
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  child.once("error", done.reject);
  child.once("close", (code) => { clearTimeout(timer); done.resolve({ code: code ?? -1, stdout, stderr }); });
  return done.promise;
}
async function fixture(run: (root: string) => Promise<void>, options: { holdInference?: boolean; healthVersion?: string; model?: string; shutdownModel?: string; replyModel?: string } = {}): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dv-asr-owned-"));
  try {
    const installation = join(root, ".dsivio-video/asr", ASR_SERVICE_VERSION);
    await mkdir(installation, { recursive: true });
    const python = join(root, "python.cjs");
    await writeFile(python, childProtocol, { mode: 0o755 });
    await writeFile(join(root, "fixture.json"), JSON.stringify(options));
    const hash = createHash("sha256");
    for (const name of ["server.py", "prepare.py", "requirements.txt"]) { hash.update(name); hash.update(await readFile(join(asrSources, name))); }
    await writeFile(join(installation, "config.json"), JSON.stringify({ model: options.model ?? "small", languages: ["en", "zh"], device: "cpu", compute: "int8", batchSize: 8, cache: join(installation, "cache"), python, serviceVersion: ASR_SERVICE_VERSION, sourceRevision: `sha256:${hash.digest("hex")}` }));
    const wav = Buffer.alloc(364);
    wav.write("RIFF", 0); wav.writeUInt32LE(356, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(320, 40);
    await writeFile(join(root, "audio.wav"), wav);
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const imports = `import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {startAsr,stopAsr,asrRuntime,cancelLocalAsr,transcribeLocal} from ${JSON.stringify(serviceUrl)};const root=process.env.HOME;const absent=pid=>assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');`;
const waitActive = `async function waitActive(session,id){const response=await fetch('http://127.0.0.1:'+session.port+'/fixture-active?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+session.token},signal:AbortSignal.timeout(3000)});assert.equal(response.status,200);assert.equal((await response.json()).activeTaskId,id);}`;

// A disk record cannot grant authority over this independently owned live process.
test("nonce-owned service never adopts or stops a live disk-recorded process", posix, async () => {
  await fixture(async (root) => {
    const sentinel = spawn(process.execPath, ["--input-type=module", "-e", `import http from 'node:http';import {writeFileSync} from 'node:fs';const server=http.createServer((request,response)=>{writeFileSync(${JSON.stringify(join(root, "unowned-contact"))},request.url);response.end('{}');});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,port:server.address().port})));`]);
    const ready = Promise.withResolvers<string>();
    sentinel.once("error", ready.reject);
    sentinel.stdout.once("data", (chunk: Buffer) => ready.resolve(chunk.toString("utf8")));
    try {
      const unowned = JSON.parse(await ready.promise) as { pid: number; port: number };
      await writeFile(join(root, ".dsivio-video/asr/run.json"), JSON.stringify(unowned));
      const result = await execute(root, `${imports}const session=await startAsr();const pid=asrRuntime().pid;assert.notEqual(pid,${unowned.pid});assert.notEqual(session.port,${unowned.port});const response=await fetch('http://127.0.0.1:'+session.port+'/health');assert.equal(response.status,401);await stopAsr();absent(pid);console.log(JSON.stringify({state:asrRuntime().state}));`);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).state, "stopped");
      assert.equal(sentinel.exitCode, null);
      await assert.rejects(readFile(join(root, "unowned-contact")), { code: "ENOENT" });
      assert.deepEqual(JSON.parse(await readFile(join(root, ".dsivio-video/asr/run.json"), "utf8")), unowned);
    } finally {
      const exited = Promise.withResolvers<void>();
      sentinel.once("close", () => exited.resolve());
      sentinel.kill("SIGTERM");
      await exited.promise;
    }
  });
});

test("cancel confirms owned child exit, rejects idle stop while busy, then restarts", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}${waitActive}const session=await startAsr();const first=asrRuntime().pid;const task=transcribeLocal(join(root,'audio.wav'),'zh',undefined,{taskId:'active',sampleFrames:160}).catch(error=>error.code);await waitActive(session,'active');await assert.rejects(stopAsr(),error=>error.code==='ASR_BUSY');assert.equal((await cancelLocalAsr('other')).outcome,'too-late');assert.equal(asrRuntime().activeTaskId,'active');const cancel=await cancelLocalAsr('active');assert.equal(cancel.outcome,'confirmed');absent(first);assert.equal(await task,'ASR_UNAVAILABLE');assert.equal(asrRuntime().state,'stopped');await writeFile(join(root,'fixture.json'),JSON.stringify({holdInference:false}));await transcribeLocal(join(root,'audio.wav'),'en',undefined,{taskId:'next',sampleFrames:160});const second=asrRuntime().pid;assert.notEqual(second,first);assert.equal(asrRuntime().state,'ready');assert.equal(asrRuntime().activeTaskId,null);await stopAsr();absent(second);console.log(JSON.stringify({cancel:cancel.outcome,restarted:true}));`);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { cancel: "confirmed", restarted: true });
  }, { holdInference: true });
});

test("caller abort reports ABORTED only after its inference child exits", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}${waitActive}const session=await startAsr();const pid=asrRuntime().pid;const controller=new AbortController();const task=transcribeLocal(join(root,'audio.wav'),'en',controller.signal,{taskId:'abort',sampleFrames:160}).catch(error=>error.code);await waitActive(session,'abort');controller.abort();assert.equal(await task,'ABORTED');absent(pid);assert.equal(asrRuntime().state,'stopped');console.log(JSON.stringify({aborted:true}));`);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { aborted: true });
  }, { holdInference: true });
});

test("mismatched service health is rejected and the startup child exits", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}await assert.rejects(startAsr(),error=>error.code==='ASR_CONFIG_MISMATCH');const child=JSON.parse(await readFile(join(root,'last-child.json'),'utf8'));absent(child.pid);assert.equal(asrRuntime().state,'stopped');console.log(JSON.stringify({rejected:true}));`);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { rejected: true });
  }, { healthVersion: "incompatible" });
});

test("owner completion closes its service rather than leaving a detached process", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}await startAsr();console.log(JSON.stringify({pid:asrRuntime().pid}));`);
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout) as { pid: number };
    assert.throws(() => process.kill(output.pid, 0), (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH");
  });
});

test("an installation switch replaces only the owned idle session before frozen-model inference", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}const old=await startAsr();assert.equal(old.health.model,'base');const first=asrRuntime().pid;const path=join(root,'.dsivio-video/asr',${JSON.stringify(ASR_SERVICE_VERSION)},'config.json');const config=JSON.parse(await readFile(path,'utf8'));config.model='small';await writeFile(path,JSON.stringify(config));const result=await transcribeLocal(join(root,'audio.wav'),'en',undefined,{model:'small',autoInstall:false,sampleFrames:160});const second=asrRuntime().pid;assert.notEqual(second,first);absent(first);assert.equal(result.health.model,'small');assert.equal(result.reply.engine.model,'small');await stopAsr();absent(second);console.log(JSON.stringify({replaced:true}));`);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { replaced: true });
  }, { model: "base" });
});

test("an installation switch cannot stop or replace an owned active inference", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}${waitActive}const session=await startAsr();const pid=asrRuntime().pid;const pending=transcribeLocal(join(root,'audio.wav'),'en',undefined,{model:'base',autoInstall:false,sampleFrames:160,taskId:'busy-switch'}).catch(error=>error.code);await waitActive(session,'busy-switch');const path=join(root,'.dsivio-video/asr',${JSON.stringify(ASR_SERVICE_VERSION)},'config.json');const config=JSON.parse(await readFile(path,'utf8'));config.model='small';await writeFile(path,JSON.stringify(config));await assert.rejects(startAsr(),error=>error.code==='ASR_BUSY');assert.equal(asrRuntime().pid,pid);assert.equal(asrRuntime().activeTaskId,'busy-switch');assert.equal((await cancelLocalAsr('busy-switch')).outcome,'confirmed');assert.equal(await pending,'ASR_UNAVAILABLE');absent(pid);console.log(JSON.stringify({activePreserved:true}));`);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { activePreserved: true });
  }, { model: "base", holdInference: true });
});

test("config drift between installation readiness and startup cannot infer a different frozen model", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}await startAsr();const first=asrRuntime().pid;const path=join(root,'.dsivio-video/asr',${JSON.stringify(ASR_SERVICE_VERSION)},'config.json');const config=JSON.parse(await readFile(path,'utf8'));config.model='small';await writeFile(path,JSON.stringify(config));await assert.rejects(transcribeLocal(join(root,'audio.wav'),'en',undefined,{model:'small',autoInstall:false,sampleFrames:160}),error=>error.code==='ASR_CONFIG_MISMATCH');absent(first);assert.notEqual(asrRuntime().pid,first);await assert.rejects(readFile(join(root,'inference-started.json')),{code:'ENOENT'});const second=asrRuntime().pid;await stopAsr();absent(second);console.log(JSON.stringify({driftRejectedBeforeInference:true}));`);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { driftRejectedBeforeInference: true });
  }, { model: "base", shutdownModel: "base" });
});

test("transcript engine evidence cannot change the frozen requested local model", posix, async () => {
  await fixture(async (root) => {
    const result = await execute(root, `${imports}await assert.rejects(transcribeLocal(join(root,'audio.wav'),'en',undefined,{model:'small',autoInstall:false,sampleFrames:160}),error=>error.code==='ASR_CONFIG_MISMATCH');const pid=asrRuntime().pid;assert.equal(asrRuntime().state,'ready');await stopAsr();absent(pid);console.log(JSON.stringify({wrongEngineRejected:true}));`);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { wrongEngineRejected: true });
  }, { replyModel: "base" });
});
