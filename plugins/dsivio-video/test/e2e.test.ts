import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ResultsRepository } from "../src/build/results.ts";

const launcher = fileURLToPath(new URL("../bin/dsivio-video.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/fake-dsivio.mjs", import.meta.url));
const example = fileURLToPath(new URL("../examples/first-light", import.meta.url));
interface CommandReply { code: number | null; stdout: string; stderr: string }
interface PlanReply {
  valid: boolean;
  paidNeedTotal: number;
  overrideTotal: number;
  requestRows: { model?: string; code?: string; reason?: string; futureInputs?: { role: string; output: string }[] }[];
}
interface BuildReply { buildView: { id: string; work: { outcome: string; steps: { done: number; total: number } }; result: { state: string } } }
interface ErrorReply { ok: false; error: { code: string; message: string; source: unknown; hint: string }; help?: string }

async function run(cwd: string, env: NodeJS.ProcessEnv, args: string[]): Promise<CommandReply> {
  const child = spawn(process.execPath, [launcher, ...args], { cwd, env, timeout: 20_000 });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, "close");
  return { code: typeof code === "number" ? code : null, stdout, stderr };
}
function json<T>(reply: CommandReply, expectedCode = 0): T {
  assert.equal(reply.code, expectedCode, `${reply.stdout}\n${reply.stderr}`);
  return JSON.parse(reply.stdout) as T;
}

test("real CLI plans, builds, exports and explicitly reuses the first-light example", { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsivio-video-e2e-"));
  const project = join(directory, "project");
  const fake = join(directory, "fake");
  await cp(example, project, { recursive: true });
  await mkdir(fake);
  const env = { ...process.env, DSIVIO_VIDEO_DSIVIO: fixture, FAKE_DSIVIO_DIR: fake, DSIVIO_VIDEO_WORKER_IDLE_MS: "500" };
  await writeFile(join(fake, "config.json"), JSON.stringify({ runningStatuses: 0 }));
  try {
    const check = json<{ ok: boolean; sourceKind: string; outputCount: number }>(await run(project, env, ["check", "main.dvml", "--json"]));
    assert.equal(check.ok, true);
    assert.equal(check.sourceKind, "author");
    assert.equal(check.outputCount, 3);
    const plan = json<PlanReply>(await run(project, env, ["plan", "build.dvrun", "--json"]));
    assert.equal(plan.valid, true);
    assert.equal(plan.paidNeedTotal, 2);
    const video = plan.requestRows.find((row) => row.model === "volcengine/doubao-seedance-2-5");
    assert.deepEqual(video?.futureInputs, [{ role: "firstFrame", output: "hero.image" }]);
    const followed = await run(project, env, ["build", "build.dvrun", "--follow", "--max-wait-ms", "15000", "--json"]);
    const built = json<BuildReply>(followed);
    const progress = followed.stderr.trim().split("\n").map((line) => line.match(/steps (\d+)\/(\d+)$/));
    assert.ok(progress.every((match) => match !== null && Number(match[2]) === built.buildView.work.steps.total));
    assert.equal(built.buildView.work.steps.total, 3);
    assert.equal(built.buildView.work.steps.done, 3);
    assert.equal(built.buildView.work.outcome, "complete");
    assert.equal(built.buildView.result.state, "complete");
    const id = built.buildView.id;
    const inspected = json<{ resultView: { outcome: string; outputs: { name: string; nominalType: string; valueClass: string }[] } }>(await run(project, env, ["inspect", id, "--json"]));
    assert.equal(inspected.resultView.outcome, "complete");
    assert.deepEqual(inspected.resultView.outputs.map(({ name, nominalType, valueClass }) => ({ name, nominalType, valueClass })), [{ name: "shot.video", nominalType: "dsivio-video/media@1#Video", valueClass: "resource" }]);
    const exported = join(project, "out.mp4");
    const got = json<{ outputName: string; exportPath: string }>(await run(project, env, ["get", id, "--output", "shot.video", "--to", exported, "--json"]));
    assert.equal(got.outputName, "shot.video");
    assert.equal(got.exportPath, exported);
    assert.deepEqual(await readFile(exported), Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]));
    const overwrite = json<ErrorReply>(await run(project, env, ["get", id, "--output", "shot.video", "--to", exported, "--json"]), 1);
    assert.equal(overwrite.error.code, "EXPORT_EXISTS");
    await writeFile(join(project, "reuse.dvrun"), `<?dvml using="dsivio-video/run@1"?>\n<dvrun version="1">\n  <author source="./main.dvml"/>\n  <target output="shot.video"/>\n  <build-record id="old" build="${id}" output="hero.image"/>\n  <satisfy output="hero.image" candidate="old"/>\n</dvrun>\n`);
    const reused = json<PlanReply>(await run(project, env, ["plan", "reuse.dvrun", "--json"]));
    assert.equal(reused.paidNeedTotal, 1);
    assert.equal(reused.overrideTotal, 1);
    assert.deepEqual(reused.requestRows[0]?.futureInputs, []);
    const builds = json<{ buildRows: { id: string; outcome: string }[] }>(await run(project, env, ["builds", "--json"]));
    assert.deepEqual(builds.buildRows.map(({ id, outcome }) => ({ id, outcome })), [{ id, outcome: "complete" }]);
    const history = json<{ historyRows: { buildId: string; output: { name: string; nominalType: string } }[] }>(await run(project, env, ["history", "hero.image", "--json"]));
    assert.equal(history.historyRows[0]?.buildId, id);
    assert.equal(history.historyRows[0]?.output.nominalType, "dsivio-video/media@1#Image");
    const models = json<{ models: { id: string; capabilities: unknown }[] }>(await run(project, env, ["vocabulary", "--models", "--kind", "video", "--json"]));
    assert.deepEqual(models.models.map((model) => model.id), ["volcengine/doubao-seedance-2-5"]);
    assert.ok(models.models[0]?.capabilities);
    json(await run(project, env, ["runtime", "logs", "--lines", "5", "--json"]));
    const healthy = json<{ valid: boolean; modelCounts: Record<string, number> }>(await run(project, env, ["doctor", "--json"]));
    assert.equal(healthy.valid, true);
    assert.deepEqual(healthy.modelCounts, { image: 1, video: 1 });
    const authored = await readFile(join(project, "main.dvml"), "utf8");
    await writeFile(join(project, "rejected.dvml"), authored.replace("openai/gpt-image-2", "not/enabled"));
    await writeFile(join(project, "rejected.dvrun"), (await readFile(join(project, "build.dvrun"), "utf8")).replace("./main.dvml", "./rejected.dvml"));
    const rejected = json<PlanReply>(await run(project, env, ["plan", "rejected.dvrun", "--json"]), 1);
    assert.equal(rejected.valid, false);
    assert.ok(rejected.requestRows.some((row) => row.code === "GEN_MODEL_NOT_ENABLED"));
    const refused = json<ErrorReply>(await run(project, env, ["build", "rejected.dvrun", "--json"]), 1);
    assert.equal(refused.error.code, "GEN_MODEL_NOT_ENABLED");
    const stillOne = json<{ buildRows: { id: string }[] }>(await run(project, env, ["builds", "--json"]));
    assert.deepEqual(stillOne.buildRows.map((row) => row.id), [id]);
    const unresolvedRun = (await readFile(join(project, "reuse.dvrun"), "utf8")).replace(id, "bld_20261001T000000000Z_AAAAAAAAAA");
    await writeFile(join(project, "unresolved.dvrun"), unresolvedRun);
    const deferred = json<{ historicalOutputCount: number; unresolvedHistoricalOutputs: { output: string }[] }>(await run(project, env, ["check", "unresolved.dvrun", "--verbose", "--json"]));
    assert.equal(deferred.historicalOutputCount, 1);
    assert.equal(deferred.unresolvedHistoricalOutputs[0]?.output, "hero.image");
    await writeFile(join(project, "broken.dvml"), "<dvml/>");
    const broken = json<ErrorReply>(await run(project, env, ["check", "broken.dvml", "--debug", "--json"]), 1);
    assert.equal(broken.error.code, "SOURCE_HEADER_MISSING");
    assert.ok(broken.error.source !== null);
    const humanError = await run(project, env, ["check", "broken.dvml", "--no-color"]);
    assert.equal(humanError.code, 1);
    assert.equal(humanError.stdout, "");
    assert.match(humanError.stderr, /error SOURCE_HEADER_MISSING .*broken[.]dvml:1:1/);
    await rm(join(project, "main.dvml"));
    const oldSource = json<{ historyRows: { buildId: string }[] }>(await run(project, env, ["history", "hero.image", "--source", join(project, "main.dvml"), "--json"]));
    assert.equal(oldSource.historyRows[0]?.buildId, id);
    await writeFile(join(fake, "config.json"), JSON.stringify({ exit6: true }));
    const doctor = json<{ valid: boolean; diagnosticRows: { status: string; message: string }[] }>(await run(project, env, ["doctor", "--json"]), 1);
    assert.equal(doctor.valid, false);
    assert.ok(doctor.diagnosticRows.some((row) => row.status === "error" && /Open Dsivio/.test(row.message)));
  } finally {
    const stopped = await run(project, env, ["runtime", "down", "--json"]);
    try { assert.equal(stopped.code, 0, stopped.stdout + stopped.stderr); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("usage errors retain one JSON error document and help; command help needs no source", async () => {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  for (const args of [
    ["plan", "--unknown"], ["plan", "a", "b"], ["plan", "a", "--limit", "0"],
    ["plan", "a", "--workspace"], ["plan", "a", "--workspace", "--verbose"],
    ["plan", "a", "--json", "--json"], ["plan", "a", "--color", "sometimes"],
    ["plan", "a", "--color", "never", "--no-color"], ["build", "a", "--max-wait-ms", "1"],
    ["status", "x", "--watch", "--max-wait-ms", "-1"], ["activity", "--watch"],
    ["activity", "--jsonl"], ["runtime", "logs", "--lines", "0"], ["get", "x", "--output", "shot.video"],
  ]) {
    const reply = json<ErrorReply>(await run(cwd, process.env, [...args, "--json"]), 2);
    assert.equal(reply.error.code, "CLI_USAGE");
    assert.equal(reply.error.source, null);
    assert.match(reply.help ?? "", /--help/);
  }
  const help = await run(cwd, process.env, ["plan", "--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: dsivio-video plan/);
  const version = await run(cwd, process.env, ["--version"]);
  assert.equal(version.code, 0);
  const packageInfo: { version: string } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(version.stdout.trim(), packageInfo.version);
});

test("watch stops on terminal results without a worklist record or a spurious worker warning", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsivio-video-results-watch-"));
  const repository = new ResultsRepository(join(directory, ".dsivio-video"));
  try {
    const outcomes = ["complete", "failed", "cancelled"] as const;
    for (const [index, outcome] of outcomes.entries()) {
      const id = `bld_20261001T000000000Z_${String(index + 1).padStart(10, "0")}`;
      await repository.write({
        id, title: null, author: join(directory, "main.dvml"), run: join(directory, "build.dvrun"),
        targets: ["saved"], createdAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T00:00:01.000Z",
        outcome, failure: outcome === "failed" ? { code: "GEN_FAILED", message: "Generation failed" } : null,
        outputs: { saved: { type: "dsivio-video/text@1#Text", class: "scalar", value: "Saved output" } }, operations: [],
      });
      const reply = json<{ buildView: { work: { state: string }; result: { state: string }; attention: string[] } }>(
        await run(directory, process.env, ["status", id, "--watch", "--max-wait-ms", "10000", "--json"]),
        outcome === "complete" ? 0 : 1,
      );
      assert.equal(reply.buildView.work.state, "unknown");
      assert.equal(reply.buildView.result.state, outcome);
      assert.deepEqual(reply.buildView.attention, []);
    }
  } finally {
    await run(directory, process.env, ["runtime", "down", "--json"]);
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker controls use project ownership and leave an unrelated PID from legacy metadata alive", { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsivio-video-worker-ownership-"));
  const fake = join(directory, "fake");
  const runtime = join(directory, ".dsivio-video", "runtime");
  await mkdir(runtime, { recursive: true });
  await mkdir(fake);
  const env = { ...process.env, DSIVIO_VIDEO_DSIVIO: fixture, FAKE_DSIVIO_DIR: fake, DSIVIO_VIDEO_WORKER_IDLE_MS: "5000" };
  const unrelated = spawn(process.execPath, ["--eval", "process.stdin.resume()"], { cwd: directory, stdio: ["pipe", "ignore", "ignore"] });
  const unrelatedClosed = once(unrelated, "close");
  try {
    assert.ok(unrelated.pid);
    await writeFile(join(runtime, "worker.json"), JSON.stringify({ pid: unrelated.pid, startedAt: new Date().toISOString() }));
    const before = json<{ workerState: { running: boolean } }>(await run(directory, env, ["runtime", "status", "--json"]));
    assert.equal(before.workerState.running, false);
    const down = json<{ workerState: { running: boolean } }>(await run(directory, env, ["runtime", "down", "--json"]));
    assert.equal(down.workerState.running, false);
    assert.equal(unrelated.kill(0), true);
    assert.equal(unrelated.signalCode, null);
    const up = json<{ workerState: { running: boolean; pid: number } }>(await run(directory, env, ["runtime", "up", "--json"]));
    assert.equal(up.workerState.running, true);
    assert.notEqual(up.workerState.pid, unrelated.pid);
    const active = json<{ workerState: { running: boolean } }>(await run(directory, env, ["activity", "--json"]));
    assert.equal(active.workerState.running, true);
    const doctor = json<{ diagnosticRows: { name: string; status: string }[] }>(await run(directory, env, ["doctor", "--json"]));
    assert.equal(doctor.diagnosticRows.find((row) => row.name === "worker")?.status, "ok");
    const stopped = json<{ workerState: { running: boolean } }>(await run(directory, env, ["runtime", "down", "--json"]));
    assert.equal(stopped.workerState.running, false);
    assert.equal(unrelated.kill(0), true);
    assert.equal(unrelated.signalCode, null);
  } finally {
    await run(directory, env, ["runtime", "down", "--json"]);
    unrelated.kill("SIGTERM");
    await unrelatedClosed;
    await rm(directory, { recursive: true, force: true });
  }
});
