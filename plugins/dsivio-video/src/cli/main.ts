import { DvError } from "../core/errors.ts";
import { parseOptions } from "./options.ts";
import type { CliOptions, CommandSpec } from "./options.ts";
import { failure, result } from "./output.ts";
import { versionCommand } from "./commands/version.ts";
import { pathsCommand } from "./commands/paths.ts";
import { checkCommand } from "./commands/check.ts";
import { vocabularyCommand } from "./commands/vocabulary.ts";
import { planCommand } from "./commands/plan.ts";
import { buildCommand } from "./commands/build.ts";
import { statusCommand } from "./commands/status.ts";
import { activityCommand } from "./commands/activity.ts";
import { buildsCommand } from "./commands/builds.ts";
import { historyCommand } from "./commands/history.ts";
import { inspectCommand } from "./commands/inspect.ts";
import { getCommand } from "./commands/get.ts";
import { cancelCommand } from "./commands/cancel.ts";
import { runtimeCommand } from "./commands/runtime.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { workerCommand } from "./commands/worker.ts";
import { mediaProbeCommand } from "./commands/media/probe.ts";
import { mediaCutCommand } from "./commands/media/cut.ts";
import { mediaFramesCommand } from "./commands/media/frames.ts";
import { mediaTileCommand, mediaTilesCommand } from "./commands/media/tile.ts";
import { mediaBoundariesCommand } from "./commands/media/boundaries.ts";
import { mediaFetchCommand, mediaPrepareFetchCommand } from "./commands/media/fetch.ts";
import { transcribeCommand } from "./commands/transcribe.ts";
import { setupCommand } from "./commands/setup.ts";
import { snapshotCommand } from "./commands/snapshot.ts";
import { captureInstallCommand, captureRunCommand, captureScreenshotCommand } from "./commands/capture.ts";
import { studioCommand, studioSpec } from "./commands/studio.ts";
import { commentsCommand, commentsSpec } from "./commands/comments.ts";

// Sampling options shared by `media frames`, `tile` and `tiles` (research 06 §2.4).
const sampling = { at: "string", start: "string", end: "string", every: "string", around: "string", occurrence: "string", padding: "string", transcript: "string" } as const;
const browserOptions = { viewport: "string", scale: "string", headed: "boolean", "timeout-ms": "string", browser: "string", channel: "string", "browser-version": "string", "browser-cache": "string", "browser-download-base-url": "string" } as const;

interface Command extends CommandSpec { run: (options: CliOptions) => Promise<number> }
const commands: Record<string, Command> = {
  version: { usage: "version [--check]", min: 0, max: 0, options: { check: "boolean" }, run: versionCommand },
  paths: { usage: "paths", min: 0, max: 0, run: pathsCommand },
  check: { usage: "check <source.dvml|source.dvrun>", min: 1, max: 1, run: checkCommand },
  vocabulary: { usage: "vocabulary [module...] [--tag <tag>] | --models [--kind image|video|speech|transcribe|matting]", min: 0, max: Number.MAX_SAFE_INTEGER, options: { tag: "multiple", models: "boolean", kind: "string" }, run: vocabularyCommand },
  plan: { usage: "plan <run.dvrun>", min: 1, max: 1, run: planCommand },
  build: { usage: "build <run.dvrun> [--title <title>] [--follow] [--max-wait-ms <ms>]", min: 1, max: 1, options: { title: "string", follow: "boolean", "max-wait-ms": "string" }, run: buildCommand },
  status: { usage: "status <id> [--watch] [--max-wait-ms <ms>]", min: 1, max: 1, options: { watch: "boolean", "max-wait-ms": "string" }, run: statusCommand },
  activity: { usage: "activity [--watch] [--jsonl]", min: 0, max: 0, options: { watch: "boolean", jsonl: "boolean" }, run: activityCommand },
  builds: { usage: "builds [--before <id>]", min: 0, max: 0, options: { before: "string" }, run: buildsCommand },
  history: { usage: "history <output> [--source <author.dvml>] [--before <id>]", min: 1, max: 1, options: { source: "string", before: "string" }, run: historyCommand },
  inspect: { usage: "inspect <id> [--output <name>]", min: 1, max: 1, options: { output: "string" }, run: inspectCommand },
  get: { usage: "get <id> --output <name> --to <path>", min: 1, max: 1, options: { output: "string", to: "string" }, run: getCommand },
  cancel: { usage: "cancel <id> [--reason <reason>]", min: 1, max: 1, options: { reason: "string" }, run: cancelCommand },
  runtime: { usage: "runtime up|down|status|logs [--lines <n>]", min: 1, max: 1, options: { lines: "string" }, run: runtimeCommand },
  doctor: { usage: "doctor", min: 0, max: 0, run: doctorCommand },
  "media probe": { usage: "media probe <file>", min: 1, max: 1, run: mediaProbeCommand },
  "media cut": { usage: "media cut <file> [--start <s> --end <s> | --keep <start:end>...] [--label-time] --to <file>", min: 1, max: 1, options: { start: "string", end: "string", keep: "multiple", "label-time": "boolean", to: "string" }, run: mediaCutCommand },
  "media frames": { usage: "media frames <file> (--at <s,...> | --every <s> | --every-frame) [--start --end | --around <phrase> --transcript <file>] [--label-time] --to <dir>", min: 1, max: 1, options: { ...sampling, "every-frame": "boolean", "label-time": "boolean", to: "string" }, run: mediaFramesCommand },
  "media tile": { usage: "media tile <file> [sampling] [--frames <n>] [--cell <px>] [--columns <n>] --to <image>", min: 1, max: 1, options: { ...sampling, frames: "string", cell: "string", columns: "string", to: "string" }, run: mediaTileCommand },
  "media tiles": { usage: "media tiles <file> [sampling | --ranges <json>] [--frames <n> | --every <s> | --every-frame] [--cell <px>] [--columns <n>] [--rows <n>] --to <dir>", min: 1, max: 1, options: { ...sampling, ranges: "string", frames: "string", "every-frame": "boolean", cell: "string", columns: "string", rows: "string", to: "string" }, run: mediaTilesCommand },
  "media boundaries": { usage: "media boundaries <file> [--rate <samples/s>] [--threshold <0..1>]", min: 1, max: 1, options: { rate: "string", threshold: "string" }, run: mediaBoundariesCommand },
  "media fetch": { usage: "media fetch <http(s)-url> --to <video>", min: 1, max: 1, options: { to: "string" }, run: mediaFetchCommand },
  "media prepare-fetch": { usage: "media prepare-fetch", min: 0, max: 0, run: mediaPrepareFetchCommand },
  transcribe: { usage: "transcribe <audio|video> --language <code> --to <transcript.json> [--model local/whisperx-small|provider/model]", min: 1, max: 1, options: { language: "string", to: "string", model: "string" }, run: transcribeCommand },
  setup: { usage: "setup asr|browser|fonts|raster|status [--model <name>] [--kind render|capture|all]", min: 1, max: 1, options: { model: "string", kind: "string", "browser-download-base-url": "string" }, run: setupCommand },
  snapshot: { usage: "snapshot [compiled.html|HTTP(S)-URL | --studio <base-URL>] (--at-frame <n,...> | --start-frame <n> --end-frame-exclusive <n> [--step-frames <n>]) --to <new-dir> [--grid CxR --cell <px>]", min: 0, max: 1, options: { studio: "string", "at-frame": "string", "start-frame": "string", "end-frame-exclusive": "string", "step-frames": "string", to: "string", grid: "string", cell: "string" }, run: snapshotCommand },
  "capture screenshot": { usage: "capture screenshot <URL|local-HTML> --to <image> [--full-page | --selector <selector> | --clip x,y,w,h]", min: 1, max: 1, options: { ...browserOptions, to: "string", "full-page": "boolean", selector: "string", clip: "string", transparent: "boolean", "wait-for": "string", "wait-ms": "string" }, run: captureScreenshotCommand },
  "capture run": { usage: "capture run <script.mjs> [browser options] -- [script arguments]", min: 1, max: 1, options: browserOptions, run: captureRunCommand },
  "capture install-browser": { usage: "capture install-browser [--browser-version <exact-version>] [--browser-cache <directory>] [--browser-download-base-url <URL>]", min: 0, max: 0, options: { "browser-version": "string", "browser-cache": "string", "browser-download-base-url": "string" }, run: captureInstallCommand },
  studio: { ...studioSpec, run: studioCommand },
  comments: { ...commentsSpec, run: commentsCommand },
  _worker: { usage: "_worker --workspace <project>", min: 0, max: 0, run: workerCommand },
};
const commonHelp = "Common options: --json --verbose --color auto|always|never --no-color --debug --workspace <path> --asset-root <path> (repeatable) --limit <n> (default 20) --help";
export async function main(argv: string[]): Promise<number> {
  let help = "Help: dsivio-video --help";
  let options: CliOptions | undefined;
  try {
    const grouped = argv[0] === "media" || argv[0] === "capture";
    const name = argv[0] === "--version" ? "version" : grouped && argv[1] && !argv[1].startsWith("-") ? `${argv[0]} ${argv[1]}` : argv[0];
    const rest = grouped && name?.includes(" ") ? argv.slice(2) : argv.slice(1);
    if (!name || name === "--help" || name === "help") {
      const args = name === "help" && argv[1] && commands[argv[1]] ? [argv[1], "--help", ...argv.slice(2)] : null;
      if (args) return await main(args);
      const parsed = parseOptions(name ? argv.slice(1) : [], { usage: "--help", min: 0, max: 0 });
      result(parsed, { schema: "dsivio-video.help/1", commands: Object.entries(commands).filter(([command]) => !command.startsWith("_")).map(([, command]) => command.usage), commonOptions: commonHelp }, ["Usage: dsivio-video <command> [options]", ...Object.entries(commands).filter(([command]) => !command.startsWith("_")).map(([, command]) => `  ${command.usage}`), commonHelp]);
      return 0;
    }
    const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (!command) throw new DvError("CLI_USAGE", `Unknown command ${name}.`);
    help = `Help: dsivio-video ${name} --help`;
    const separator = name === "capture run" ? rest.indexOf("--") : -1;
    options = parseOptions(separator >= 0 ? rest.slice(0, separator) : rest, command);
    if (separator >= 0) options.positionals.push(...rest.slice(separator + 1));
    if (options.values.help) {
      result(options, { schema: "dsivio-video.help/1", command: name, usage: `dsivio-video ${command.usage}`, commonOptions: commonHelp }, [`Usage: dsivio-video ${command.usage}`, commonHelp]);
      return 0;
    }
    return await command.run(options);
  } catch (error) {
    return failure(error, options ?? { json: argv.includes("--json"), debug: argv.includes("--debug"), color: argv.includes("--no-color") ? "never" : "auto" }, help);
  }
}
