import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locateBrowser } from "../render/browser.ts";
import { createCaptureSession } from "./session.ts";
import { navigateCapture } from "./screenshot.ts";

let prepared = false;
try { await locateBrowser("capture"); prepared = true; }
catch (cause) { if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "BROWSER_NOT_PREPARED") throw cause; }

test("capture screenshot respects selector size, fails HTTP errors and never overwrites", { skip: !prepared && "Run setup browser --kind capture for real browser tests" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dv-capture-test-"));
  const server = createServer((request, response) => {
    response.statusCode = request.url === "/missing" ? 404 : 200;
    response.end('<html><body style="margin:0;background:#102030"><div id="target" style="width:180px;height:120px;background:#fa5533"></div></body></html>');
  });
  const ready = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", ready.resolve);
  await ready.promise;
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const session = await createCaptureSession({ viewport: { width: 320, height: 240 } });
  try {
    const url = `http://127.0.0.1:${address.port}/`;
    await navigateCapture(session.page, url);
    const output = await session.screenshot({ to: join(directory, "selector.png"), selector: "#target" });
    assert.equal(output.width, 180); assert.equal(output.height, 120); assert.equal(output.url, url);
    await assert.rejects(session.screenshot({ to: output.path }), { code: "MEDIA_OUTPUT_EXISTS" });
    await assert.rejects(session.screenshot({ to: join(directory, "conflict.png"), fullPage: true, selector: "#target" }), { code: "CAPTURE_OPTIONS_INVALID" });
    await assert.rejects(navigateCapture(session.page, `${url}missing`), { code: "CAPTURE_HTTP_FAILED" });
    assert.deepEqual(await readdir(directory), ["selector.png"]);
  } finally {
    await session.close();
    const closed = Promise.withResolvers<void>(); server.close(() => closed.resolve()); await closed.promise;
    await rm(directory, { recursive: true, force: true });
  }
});
test("native CDP recording supports idempotent stop, audio opt-in and cancellation cleanup", { skip: !prepared && "Run setup browser --kind capture for real browser tests" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dv-record-test-"));
  const session = await createCaptureSession({ viewport: { width: 320, height: 240 } });
  let closed = false;
  try {
    await session.page.setContent('<html><body style="background:#224466"><div style="width:60px;height:60px;background:#ff4400;animation:move 1s infinite alternate"></div><style>@keyframes move{to{transform:translateX(100px)}}</style></body></html>');
    const silent = await session.record({ to: join(directory, "silent.mp4") });
    // CDP captures the real platform compositor/audio clock; fake timers cannot advance native recording.
    await setTimeout(400);
    const a = silent.stop(), b = silent.stop();
    assert.equal(a, b);
    const video = await a;
    assert.equal(video.width, 320); assert.equal(video.height, 240); assert.equal(video.audioPresent, false);
    await session.page.evaluate(() => { const audio = new AudioContext(); const tone = audio.createOscillator(); tone.connect(audio.destination); tone.start(); });
    const sound = await session.record({ to: join(directory, "sound.mp4"), audio: true });
    await setTimeout(400);
    assert.equal((await sound.stop()).audioPresent, true);
    const abort = new AbortController();
    const cancelled = await session.record({ to: join(directory, "cancel.mp4"), signal: abort.signal });
    await setTimeout(200); abort.abort();
    await assert.rejects(cancelled.stop(), { code: "ABORTED" });
    await assert.rejects(access(join(directory, "cancel.mp4")), { code: "ENOENT" });
    assert.deepEqual((await readdir(directory)).sort(), ["silent.mp4", "sound.mp4"]);
    await assert.rejects(session.close(), { code: "CAPTURE_FINALIZATION_FAILED" });
    closed = true;
  } finally {
    try { if (!closed) await session.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("capture CLI interrupts native recording, retains completed images and removes unfinished output", { skip: !prepared && "Run setup browser --kind capture for real browser tests", timeout: 15_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "dv-capture-interrupt-test-"));
  const script = join(directory, "task.mjs");
  await writeFile(script, `export default async ({page,screenshot,record,args,log}) => {
    await page.setContent('<html><body style="background:#ff4400">Before cancellation</body></html>');
    await screenshot({to:args[0]+'/before.png'});
    await record({to:args[0]+'/unfinished.mp4'});
    log('recording-ready');
    await new Promise(()=>{});
  };`);
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../bin/dsivio-video.mjs", import.meta.url)), "capture", "run", script, "--viewport", "160x120", "--json", "--", directory]);
  let stdout = "", stderr = "", interrupted = false;
  const cancelChild = () => child.kill("SIGKILL");
  t.signal.addEventListener("abort", cancelChild, { once: true });
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => {
    stderr += chunk;
    if (!interrupted && stderr.includes("recording-ready")) { interrupted = true; child.kill("SIGINT"); }
  });
  const exited = Promise.withResolvers<number | null>();
  child.once("error", exited.reject);
  child.once("close", code => exited.resolve(code));
  try {
    assert.equal(await exited.promise, 1, stderr);
    assert.equal(JSON.parse(stdout).error.code, "ABORTED");
    assert.deepEqual((await readdir(directory)).sort(), ["before.png", "task.mjs"]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited.promise; }
    t.signal.removeEventListener("abort", cancelChild);
    await rm(directory, { recursive: true, force: true });
  }
});
