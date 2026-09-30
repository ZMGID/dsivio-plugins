#!/usr/bin/env node
// Launcher: Node runs the TypeScript sources directly (type stripping, Node >= 22.18).
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  process.stderr.write(`dsivio-video needs Node.js 22.18 or newer (found ${process.versions.node}).\n`);
  process.exit(1);
}
// Type stripping and node:sqlite announce themselves as experimental on some Node lines; that notice is noise here.
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
  if (type === "ExperimentalWarning") return;
  return emit.call(process, warning, ...rest);
};
const { main } = await import("../src/cli/main.ts");
process.exitCode = await main(process.argv.slice(2));
