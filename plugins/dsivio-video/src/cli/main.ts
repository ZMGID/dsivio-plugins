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

interface Command extends CommandSpec { run: (options: CliOptions) => Promise<number> }
const commands: Record<string, Command> = {
  version: { usage: "version [--check]", min: 0, max: 0, options: { check: "boolean" }, run: versionCommand },
  paths: { usage: "paths", min: 0, max: 0, run: pathsCommand },
  check: { usage: "check <source.dvml|source.dvrun>", min: 1, max: 1, run: checkCommand },
  vocabulary: { usage: "vocabulary [module...] [--tag <tag>] | --models [--kind image|video]", min: 0, max: Number.MAX_SAFE_INTEGER, options: { tag: "multiple", models: "boolean", kind: "string" }, run: vocabularyCommand },
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
  _worker: { usage: "_worker --workspace <project>", min: 0, max: 0, run: workerCommand },
};
const commonHelp = "Common options: --json --verbose --color auto|always|never --no-color --debug --workspace <path> --asset-root <path> (repeatable) --limit <n> (default 20) --help";
export async function main(argv: string[]): Promise<number> {
  let help = "Help: dsivio-video --help";
  let options: CliOptions | undefined;
  try {
    const name = argv[0] === "--version" ? "version" : argv[0];
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
    options = parseOptions(argv.slice(1), command);
    if (options.values.help) {
      result(options, { schema: "dsivio-video.help/1", command: name, usage: `dsivio-video ${command.usage}`, commonOptions: commonHelp }, [`Usage: dsivio-video ${command.usage}`, commonHelp]);
      return 0;
    }
    return await command.run(options);
  } catch (error) {
    return failure(error, options ?? { json: argv.includes("--json"), debug: argv.includes("--debug"), color: argv.includes("--no-color") ? "never" : "auto" }, help);
  }
}
