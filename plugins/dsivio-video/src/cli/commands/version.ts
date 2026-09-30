import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CliOptions } from "../options.ts";
import { result } from "../output.ts";

export async function versionCommand(options: CliOptions): Promise<number> {
  const packageFile = new URL("../../../package.json", import.meta.url);
  const info: { name: string; version: string } = JSON.parse(await readFile(packageFile, "utf8"));
  const data = { schema: "dsivio-video.version/1", packageName: info.name, installedVersion: info.version, distributionPath: fileURLToPath(new URL("../../../", import.meta.url)), launcherPath: fileURLToPath(new URL("../../../bin/dsivio-video.mjs", import.meta.url)), releasePage: "https://github.com/ZMGID/dsivio-plugins/releases", latestQuery: null as null | { url: string; version?: string; matches?: boolean; error?: string } };
  const lines = [info.version];
  let exit = 0;
  if (options.values.check) {
    const url = "https://api.github.com/repos/ZMGID/dsivio-plugins/releases/latest";
    try {
      const reply = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/vnd.github+json", "User-Agent": "dsivio-video" } });
      if (!reply.ok) throw new Error(`Release query returned HTTP ${reply.status}.`);
      const release: unknown = await reply.json();
      if (release === null || typeof release !== "object" || !("tag_name" in release) || typeof release.tag_name !== "string") throw new Error("Latest release has no tag_name.");
      const version = release.tag_name.replace(/^v/, "");
      data.latestQuery = { url, version, matches: version === info.version };
      lines.push(`Latest: ${version} (${version === info.version ? "matches installed" : "different from installed"})`, `Releases: ${data.releasePage}`);
    } catch (error) {
      data.latestQuery = { url, error: error instanceof Error ? error.message : String(error) };
      lines.push(`Latest: unknown (${data.latestQuery.error})`);
      exit = 1;
    }
  }
  result(options, data, lines);
  return exit;
}
