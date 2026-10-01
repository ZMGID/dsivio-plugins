import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import { locateTool, runTool, toolVersion } from "./index.ts";

const envKeys = ["PATH", "HOME", "USERPROFILE", "DSIVIO_VIDEO_DSIVIO", "DSIVIO_VIDEO_FFMPEG", "DSIVIO_VIDEO_FFPROBE", "DSIVIO_VIDEO_YT_DLP", "DSIVIO_VIDEO_PYTHON"];
async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dv-tools-"));
  const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) delete process.env[key];
    process.env.PATH = root;
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.DSIVIO_VIDEO_DSIVIO = join(root, "missing-dsivio");
    await run(root);
  } finally {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(root, { recursive: true, force: true });
  }
}
async function script(path: string, body: string): Promise<void> {
  await writeFile(path, `#!${process.execPath}\n${body}\n`);
  await chmod(path, 0o755);
}
function errorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof DvError && error.code === code;
}

const posixOnly = { skip: process.platform === "win32" };
test("environment override wins over bundled and PATH executables", posixOnly, async () => {
  await fixture(async (root) => {
    const override = join(root, "chosen");
    await script(override, "console.log('chosen')");
    await script(join(root, "ffmpeg"), "console.log('path')");
    const dsivio = join(root, "dsivio");
    await script(dsivio, `throw new Error('must not query Dsivio when overridden')`);
    process.env.DSIVIO_VIDEO_DSIVIO = dsivio;
    process.env.DSIVIO_VIDEO_FFMPEG = override;
    assert.deepEqual(await locateTool("ffmpeg"), { name: "ffmpeg", path: override, source: "env" });
  });
});
test("older Dsivio CLI falls through to PATH", posixOnly, async () => {
  await fixture(async (root) => {
    await script(join(root, "ffprobe"), "console.log('ffprobe fixture 1')");
    const dsivio = join(root, "dsivio");
    await script(dsivio, "console.error('unknown subcommand tools'); process.exit(2)");
    process.env.DSIVIO_VIDEO_DSIVIO = dsivio;
    assert.deepEqual(await locateTool("ffprobe"), { name: "ffprobe", path: join(root, "ffprobe"), source: "path" });
    assert.equal(await toolVersion("ffprobe"), "ffprobe fixture 1");
  });
});
test("Dsivio JSON paths precede PATH and query is cached across tools", posixOnly, async () => {
  await fixture(async (root) => {
    const media = join(root, "bundled-ffmpeg");
    const probe = join(root, "bundled-ffprobe");
    await script(media, "console.log('bundled')");
    await script(probe, "console.log('bundled')");
    await script(join(root, "ffmpeg"), "console.log('path')");
    const count = join(root, "queries");
    const dsivio = join(root, "dsivio");
    await script(dsivio, `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(count)}, 'query\\n'); if(process.argv.slice(2).join(' ') !== 'tools --json') process.exit(9); console.log(${JSON.stringify(JSON.stringify({ ffmpeg: media, ffprobe: probe }))});`);
    process.env.DSIVIO_VIDEO_DSIVIO = dsivio;
    assert.deepEqual(await locateTool("ffmpeg"), { name: "ffmpeg", path: media, source: "dsivio" });
    assert.deepEqual(await locateTool("ffprobe"), { name: "ffprobe", path: probe, source: "dsivio" });
    assert.equal(await readFile(count, "utf8"), "query\n");
  });
});
test("managed tools are used after PATH and missing tool has actionable hint", posixOnly, async () => {
  await fixture(async (root) => {
    const managed = join(root, ".dsivio-video", "tools");
    await mkdir(managed, { recursive: true });
    await script(join(managed, "yt-dlp"), "console.log('2026.1')");
    assert.deepEqual(await locateTool("yt-dlp"), { name: "yt-dlp", path: join(managed, "yt-dlp"), source: "managed" });
    await assert.rejects(locateTool("ffmpeg"), (error: unknown) => error instanceof DvError && error.code === "TOOL_NOT_FOUND" && !!error.hint?.includes("DSIVIO_VIDEO_FFMPEG") && (process.platform !== "darwin" || error.hint.includes("brew install ffmpeg yt-dlp")));
    process.env.DSIVIO_VIDEO_FFMPEG = join(root, "bad-override");
    await assert.rejects(locateTool("ffmpeg"), errorCode("TOOL_NOT_FOUND"));
  });
});
test("runTool preserves arguments and stdin, and does not inherit credentials", async () => {
  const key = "DSIVIO_VIDEO_TEST_SECRET";
  process.env[key] = "do-not-leak";
  try {
    const result = await runTool(process.execPath, ["-e", `let text='';process.stdin.on('data', c=>text+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({input:text,args:process.argv.slice(1),secret:process.env.${key},path:process.env.PATH})))`, "literal; $(not-a-command)", "two words"], { input: "hello\n" });
    assert.deepEqual(JSON.parse(result.stdout.toString()), { input: "hello\n", args: ["literal; $(not-a-command)", "two words"], path: process.env.PATH });
  } finally { delete process.env[key]; }
});
test("runTool kills a timed-out process even when it ignores SIGTERM", async () => {
  // Integration proof of the OS process deadline: fake timers cannot observe SIGKILL delivery.
  await assert.rejects(runTool(process.execPath, ["-e", "process.on('SIGTERM',()=>{});require('node:net').createServer().listen(0)"], { timeoutMs: 150 }), errorCode("TOOL_TIMEOUT"));
});
test("runTool limits stdout bytes including non-collected streams", async () => {
  await assert.rejects(runTool(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(4096));require('node:net').createServer().listen(0)"], { maxStdoutBytes: 100 }), errorCode("TOOL_OUTPUT_LIMIT"));
  await assert.rejects(runTool(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(4096))"], { collectStdout: false, maxStdoutBytes: 100 }), errorCode("TOOL_OUTPUT_LIMIT"));
});
test("runTool returns only the last 8000 stderr characters on failed exit", async () => {
  await assert.rejects(runTool(process.execPath, ["-e", "process.stderr.write('discard-this'+ 'x'.repeat(9000)+'final-diagnostic');process.exitCode=7" ]), (error: unknown) => error instanceof DvError && error.code === "TOOL_FAILED" && error.message.includes("exited 7") && !error.message.includes("discard-this") && error.message.endsWith("x".repeat(8000 - "final-diagnostic".length) + "final-diagnostic"));
});
test("runTool aborts running and already-aborted operations", async () => {
  const controller = new AbortController();
  await assert.rejects(runTool(process.execPath, ["-e", "process.on('SIGTERM',()=>{});require('node:net').createServer().listen(0,()=>console.error('ready'))"], { signal: controller.signal, onStderrLine: () => controller.abort("requested") }), errorCode("ABORTED"));
  await assert.rejects(runTool(process.execPath, ["-e", "process.exit(0)"], { signal: controller.signal }), errorCode("ABORTED"));
});
test("runTool streams binary stdout and complete stderr lines", async () => {
  const chunks: Buffer[] = [];
  const lines: string[] = [];
  const result = await runTool(process.execPath, ["-e", "process.stdout.write(Buffer.from([0,255,1]));process.stderr.write('first\\nsec',()=>process.stderr.write('ond\\nlast'))"], { collectStdout: false, onStdoutChunk: (chunk) => chunks.push(chunk), onStderrLine: (line) => lines.push(line) });
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 1]));
  assert.equal(result.stdout.length, 0);
  assert.deepEqual(lines, ["first", "second", "last"]);
  assert.equal(result.stderr, "first\nsecond\nlast");
});
test("runTool wraps missing executables and failing stream handlers", async () => {
  await assert.rejects(runTool(join(tmpdir(), "dv-no-such-executable"), []), errorCode("TOOL_FAILED"));
  await assert.rejects(runTool(process.execPath, ["-e", "process.stdout.write('bad');require('node:net').createServer().listen(0)"], { onStdoutChunk: () => { throw new Error("handler rejected data"); } }), (error: unknown) => error instanceof DvError && error.code === "TOOL_FAILED" && error.message.includes("handler rejected data"));
});
