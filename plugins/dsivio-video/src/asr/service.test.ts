import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ASR_PROTOCOL, ASR_SERVICE_VERSION, WHISPERX_VERSION } from "./install.ts";

const serviceUrl = new URL("./service.ts", import.meta.url).href;
const bin = fileURLToPath(new URL("../../bin/dsivio-video.mjs", import.meta.url));
async function execute(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, args, { env: { ...process.env, HOME: root, DSIVIO_VIDEO_PYTHON: join(root, "python") } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer) => { stdout += data; });
  child.stderr.on("data", (data: Buffer) => { stderr += data; });
  const done = Promise.withResolvers<{ code: number; stdout: string; stderr: string }>();
  child.once("error", done.reject);
  child.once("close", (code) => done.resolve({ code: code ?? -1, stdout, stderr }));
  return done.promise;
}
async function fixture(run: (root: string, installation: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dv-asr-lifecycle-"));
  const installation = join(root, ".dsivio-video/asr", ASR_SERVICE_VERSION);
  const python = join(installation, "venv/bin/python");
  await mkdir(dirname(python), { recursive: true });
  const fake = `#!${process.execPath}
const fs=require('node:fs'); const path=require('node:path'); const http=require('node:http');
const args=process.argv.slice(2), home=process.env.HOME;
if(args[0]==='-m') { if(args[1]==='venv') { const dest=path.join(args[2],'bin/python');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(__filename,dest);fs.chmodSync(dest,0o755); } process.exit(0); }
if(args[0].endsWith('prepare.py')) process.exit(0);
const model=args[args.indexOf('--model')+1];
const server=http.createServer((req,res)=>{
 if(req.url==='/health') {res.end(JSON.stringify({ok:true,protocol:${JSON.stringify(ASR_PROTOCOL)},serviceVersion:${JSON.stringify(ASR_SERVICE_VERSION)},whisperxVersion:${JSON.stringify(WHISPERX_VERSION)},model,device:'cpu',compute:'int8',batchSize:8}));return;}
 if(req.url==='/shutdown') {if(fs.existsSync(path.join(home,'busy'))) {res.statusCode=503;res.end(JSON.stringify({error:{code:'BUSY',message:'Inference is running'}}));return;} fs.writeFileSync(path.join(home,'shutdown'),model);res.end(JSON.stringify({ok:true}));server.close(()=>process.exit(0));return;}
 res.statusCode=404;res.end(JSON.stringify({error:{code:'NOT_FOUND',message:'Unknown endpoint'}}));
});
server.listen(Number(args[args.indexOf('--port')+1]),'127.0.0.1',()=>{fs.writeFileSync(path.join(home,'fixture-run.json'),JSON.stringify({pid:process.pid,port:server.address().port}));console.log(JSON.stringify({pid:process.pid,port:server.address().port}));});
`;
  await writeFile(python, fake, { mode: 0o755 });
  await writeFile(join(root, "python"), fake, { mode: 0o755 });
  await writeFile(join(installation, "config.json"), JSON.stringify({ model: "small", languages: ["en", "zh"], device: "cpu", compute: "int8", batchSize: 8, cache: join(installation, "cache"), serviceVersion: ASR_SERVICE_VERSION }));
  try { await run(root, installation); }
  finally {
    try {
      const child = JSON.parse(await readFile(join(root, "fixture-run.json"), "utf8"));
      try { process.kill(child.pid, "SIGTERM"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
    } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    await rm(root, { recursive: true, force: true });
  }
}
async function runningFixture(root: string, installation: string): Promise<void> {
  const child = spawn(join(installation, "venv/bin/python"), ["server.py", "--port", "0", "--model", "small"], { env: { ...process.env, HOME: root } });
  const ready = Promise.withResolvers<string>();
  child.once("error", ready.reject);
  child.stdout.once("data", (data: Buffer) => ready.resolve(data.toString("utf8")));
  const record = JSON.parse(await ready.promise);
  await writeFile(join(root, ".dsivio-video/asr/run.json"), JSON.stringify(record));
  child.unref();
}

test("startup reclaims a lock whose recorded owner no longer exists", async () => {
  await fixture(async (root) => {
    const lock = join(root, ".dsivio-video/asr/start.lock");
    await mkdir(lock);
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 1073741824, startedAt: new Date().toISOString() }));
    const started = await execute(root, ["--input-type=module", "-e", `import {startAsr} from ${JSON.stringify(serviceUrl)};const service=await startAsr();console.log(service.health.model);`]);
    assert.equal(started.code, 0, started.stderr);
    assert.equal(started.stdout.trim(), "small");
    await assert.rejects(readFile(join(lock, "owner.json")), { code: "ENOENT" });
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} during startup releases ownership for the next invocation`, { timeout: 10_000 }, async () => {
    await fixture(async (root) => {
      const published = Promise.withResolvers<void>();
      const watcher = watch(join(root, ".dsivio-video/asr"), (_event, name) => {
        if (name === "start.lock") published.resolve();
      });
      const child = spawn(process.execPath, ["--input-type=module", "-e", `import {startAsr} from ${JSON.stringify(serviceUrl)};await startAsr();`], { env: { ...process.env, HOME: root } });
      child.stdout.resume();
      child.stderr.resume();
      const exited = Promise.withResolvers<void>();
      child.once("error", exited.reject);
      child.once("close", () => exited.resolve());
      try {
        await published.promise;
        child.kill(signal);
        await exited.promise;
        await assert.rejects(readFile(join(root, ".dsivio-video/asr/start.lock")), { code: "ENOENT" });
        const retry = await execute(root, ["--input-type=module", "-e", `import {startAsr} from ${JSON.stringify(serviceUrl)};console.log((await startAsr()).health.model);`]);
        assert.equal(retry.code, 0, retry.stderr);
        assert.equal(retry.stdout.trim(), "small");
      } finally { watcher.close(); child.kill(); }
    });
  });
}

test("setup stops an idle old-model service before publishing the new model", async () => {
  await fixture(async (root, installation) => {
    await runningFixture(root, installation);
    const installed = await execute(root, [bin, "setup", "asr", "--model", "tiny", "--json"]);
    assert.equal(installed.code, 0, installed.stdout + installed.stderr);
    assert.equal(JSON.parse(await readFile(join(installation, "config.json"), "utf8")).model, "tiny");
    assert.equal(await readFile(join(root, "shutdown"), "utf8"), "small");
    await assert.rejects(readFile(join(root, ".dsivio-video/asr/run.json")), { code: "ENOENT" });
  });
});

test("setup refuses to change configuration while the old service is busy", async () => {
  await fixture(async (root, installation) => {
    await writeFile(join(root, "busy"), "inference");
    await runningFixture(root, installation);
    const installed = await execute(root, [bin, "setup", "asr", "--model", "tiny", "--json"]);
    assert.equal(installed.code, 1, installed.stdout + installed.stderr);
    assert.equal(JSON.parse(installed.stdout).error.code, "BUSY");
    assert.equal(JSON.parse(await readFile(join(installation, "config.json"), "utf8")).model, "small");
  });
});
