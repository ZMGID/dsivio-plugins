import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DvError } from "../core/errors.ts";
import { runTool } from "../tools/index.ts";
import { probeMedia } from "./probe.ts";
import { cutMedia } from "./cut.ts";
import { findBoundaries } from "./boundaries.ts";
import { fetchMedia } from "./fetch.ts";
import { prepareOutput, publishDirectory, publishFile } from "./publish.ts";

let directory: string;
let video: string;
let audio: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "dv-basic-test-"));
  video = join(directory, "source.mp4");
  audio = join(directory, "source.wav");
  await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=320x96:r=10:d=1", "-f", "lavfi", "-i", "color=white:s=320x96:r=10:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);
  await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audio]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test("probe reports actual video geometry/audio presence and audio-only fields", async () => {
  const facts = await probeMedia(video);
  assert.equal(facts.durationSec, 3);
  assert.equal(facts.hasAudio, true);
  assert.equal(facts.hasVideo, true);
  assert.equal(facts.width, 320);
  assert.equal(facts.height, 96);
  assert.equal(facts.fps, 10);
  const sound = await probeMedia(audio);
  assert.equal(sound.durationSec, 2);
  assert.equal(sound.hasVideo, false);
  assert.equal(sound.hasAudio, true);
  assert.equal("width" in sound, false);
  assert.equal("fps" in sound, false);
  const invalid = join(directory, "invalid.mp4");
  await writeFile(invalid, "not media");
  await assert.rejects(probeMedia(invalid), error => error instanceof DvError && error.code === "TOOL_FAILED");
  await assert.rejects(probeMedia(directory), error => error instanceof DvError && error.code === "MEDIA_INPUT_INVALID");
});

test("production single cut and keep join preserve duration and nominal mapping", async () => {
  const single = await cutMedia(video, join(directory, "single.mp4"), { startSec: 0.2, endSec: 0.9 });
  assert.equal(single.requestedDuration, 0.7);
  assert.ok(Math.abs(single.measuredDuration - 0.7) < 0.12);
  assert.equal(single.videoPresent, true);
  assert.equal(single.audioPresent, true);
  const joined = await cutMedia(video, join(directory, "joined.mp4"), { keep: [{ startSec: 0, endSec: 0.5 }, { startSec: 1, endSec: 1.5 }] });
  assert.equal(joined.requestedDuration, 1);
  assert.ok(Math.abs(joined.measuredDuration - 1) < 0.12);
  assert.deepEqual(joined.nominalMap, [{ inputStartSec: 0, inputEndSec: 0.5, outputStartSec: 0, outputEndSec: 0.5 }, { inputStartSec: 1, inputEndSec: 1.5, outputStartSec: 0.5, outputEndSec: 1 }]);
  const decoded = await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", joined.outputPath, "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
  assert.ok(decoded.stdout[0]! < 10);
  assert.ok(decoded.stdout[decoded.stdout.length - 1]! > 240);
});

test("audio-only cuts are real 24-bit PCM WAV", async () => {
  const report = await cutMedia(audio, join(directory, "sound.wav"), { startSec: 0.25, endSec: 1.25 });
  assert.equal(report.videoPresent, false);
  assert.equal(report.audioPresent, true);
  assert.equal(report.measuredDuration, 1);
  const metadata = await runTool("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,bits_per_sample", "-of", "json", report.outputPath]);
  assert.deepEqual(JSON.parse(metadata.stdout.toString()).streams, [{ codec_name: "pcm_s24le", bits_per_sample: 24 }]);
  await assert.rejects(cutMedia(audio, join(directory, "sound.mp4")), error => error instanceof DvError && error.code === "CLI_USAGE");
});

test("time evidence label is visibly overlaid at 8,8 and changes with source time", async () => {
  const output = join(directory, "label.mp4");
  const report = await cutMedia(video, output, { keep: [{ startSec: 0.2, endSec: 0.8 }], labelTime: true });
  assert.equal(report.timeLabelled, true);
  assert.ok(Math.abs(report.measuredDuration - 0.6) < 0.15);
  const decoded = await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", output, "-an", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
  const frameBytes = 320 * 96 * 3;
  const first = decoded.stdout.subarray(0, frameBytes);
  const later = decoded.stdout.subarray(frameBytes * 3, frameBytes * 4);
  let visible = 0;
  let changed = 0;
  for (let y = 8; y < 38; y++) for (let x = 8; x < 232; x++) {
    const index = (y * 320 + x) * 3;
    if (first[index]! > 180) visible++;
    if (Math.abs(first[index]! - later[index]!) > 100) changed++;
  }
  assert.ok(visible > 100, "bitmap digits must be visible");
  assert.ok(changed > 10, "time label must refresh");
  assert.ok(first[(60 * 320 + 250) * 3]! < 10, "outside label remains source black");
});

test("invalid intervals and label modes are rejected; cut never overwrites", async () => {
  for (const options of [{ startSec: -1 }, { startSec: 2, endSec: 1 }, { endSec: 3.01 }, { startSec: Number.NaN }, { keep: [{ startSec: 1, endSec: 2 }, { startSec: 0, endSec: 1 }] }, { keep: [{ startSec: 0, endSec: 1 }], startSec: 0 }, { keep: [{ startSec: 0, endSec: 1 }, { startSec: 1, endSec: 2 }], labelTime: true }]) {
    await assert.rejects(cutMedia(video, join(directory, "bad.mp4"), options), error => error instanceof DvError && error.code === "CLI_USAGE");
  }
  await assert.rejects(cutMedia(audio, join(directory, "bad.wav"), { labelTime: true }), error => error instanceof DvError && error.code === "CLI_USAGE");
  const existing = join(directory, "existing.mp4");
  await writeFile(existing, "user data");
  await assert.rejects(cutMedia(video, existing), error => error instanceof DvError && error.code === "MEDIA_OUTPUT_EXISTS");
  assert.equal(await readFile(existing, "utf8"), "user data");
});

test("boundaries detect normalized hard color cut, and threshold zero includes all adjacent samples", async () => {
  const report = await findBoundaries(video, { rate: 10, threshold: 0.5 });
  assert.deepEqual(report.events.map(event => event.observedAtSec), [1]);
  assert.ok(report.events[0]!.changeMagnitude > 0.98 && report.events[0]!.changeMagnitude <= 1);
  const all = await findBoundaries(video, { rate: 10, threshold: 0 });
  assert.deepEqual(all.events.map(event => event.observedAtSec), Array.from({ length: 29 }, (_, index) => (index + 1) / 10));
  assert.equal(all.events[0]!.changeMagnitude, 0);
  await assert.rejects(findBoundaries(audio), error => error instanceof DvError && error.code === "MEDIA_VIDEO_REQUIRED");
  await assert.rejects(findBoundaries(video, { rate: 0 }), error => error instanceof DvError && error.code === "CLI_USAGE");
  await assert.rejects(findBoundaries(video, { threshold: 1.1 }), error => error instanceof DvError && error.code === "CLI_USAGE");
});

test("publication refuses a target created after preparation, including empty directories", async () => {
  const source = join(directory, "publish-source");
  await writeFile(source, "new");
  const target = await prepareOutput(join(directory, "raced-file"));
  await writeFile(target, "old");
  await assert.rejects(publishFile(source, target), error => error instanceof DvError && error.code === "MEDIA_OUTPUT_EXISTS");
  assert.equal(await readFile(target, "utf8"), "old");
  const fromDirectory = join(directory, "publish-directory-source");
  await mkdir(fromDirectory);
  await writeFile(join(fromDirectory, "file"), "new");
  const toDirectory = await prepareOutput(join(directory, "raced-directory"));
  await mkdir(toDirectory);
  await assert.rejects(publishDirectory(fromDirectory, toDirectory), error => error instanceof DvError && error.code === "MEDIA_OUTPUT_EXISTS");
  const fresh = await prepareOutput(join(directory, "fresh-directory"));
  await publishDirectory(fromDirectory, fresh);
  assert.equal(await readFile(join(fresh, "file"), "utf8"), "new");
});

test("fetch validates URLs, allowed extensions, and preexisting paths without network", async () => {
  for (const url of ["not a URL", "file:///tmp/movie", "ftp://example.com/movie"]) await assert.rejects(fetchMedia(url, join(directory, "fetched.mp4")), error => error instanceof DvError && error.code === "CLI_USAGE");
  await assert.rejects(fetchMedia("https://example.com/video", join(directory, "movie.avi")), error => error instanceof DvError && error.code === "CLI_USAGE");
  await assert.rejects(fetchMedia("https://example.com/video", video), error => error instanceof DvError && error.code === "MEDIA_OUTPUT_EXISTS");
});
