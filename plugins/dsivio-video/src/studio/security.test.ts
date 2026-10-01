import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DvError } from "../core/errors.ts";
import { assertSourceWrite, assertStudioHost, assertStudioRequest, assertStudioWrite, createStudioToken } from "./security.ts";

function denied(action: () => void, code = "STUDIO_FORBIDDEN"): void {
  assert.throws(action, (error: unknown) => error instanceof DvError && error.code === code);
}

const token = createStudioToken();
function request(host = "127.0.0.1:5179") {
  return { method: "PUT", rawHeaders: ["Host", host, "Origin", `http://${host}`, "X-Studio-Token", token, "Content-Type", "application/json"] };
}

test("Host accepts only explicit current-port loopback authorities and rejects raw duplicates", () => {
  for (const host of ["localhost:5179", "127.0.0.1:5179", "[::1]:5179"]) assert.equal(assertStudioHost(request(host), 5179), host);
  for (const host of ["evil.test:5179", "localhost.evil.test:5179", "127.0.0.1.evil:5179", "evil@localhost:5179", "localhost", "localhost:80", "localhost:0", "localhost:65536", "localhost:05179", "localhost:+5179", "localhost:5179/path", "localhost:5179,evil:5179", " localhost:5179", "localhost:5179 "]) denied(() => assertStudioHost(request(host), 5179));
  denied(() => assertStudioHost({ rawHeaders: [] }, 5179));
  denied(() => assertStudioHost({ rawHeaders: ["Host", "localhost:5179", "hOsT", "localhost:5179"] }, 5179));
  for (const port of [0, 65536, 5179.1, NaN]) denied(() => assertStudioHost(request(), port));
});

test("writes enforce exact Host Origin, constant-size session secret, fetch site and JSON", () => {
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(createStudioToken(), token);
  for (const host of ["localhost:5179", "127.0.0.1:5179", "[::1]:5179"]) assertStudioWrite(request(host), 5179, token);
  const valid = request();
  valid.rawHeaders.push("Sec-Fetch-Site", "same-origin");
  valid.rawHeaders[7] = "application/json; charset=utf-8";
  assertStudioWrite(valid, 5179, token);
  for (const [name, value] of [
    ["Origin", "http://localhost:5179"], ["Origin", "https://127.0.0.1:5179"], ["Origin", "http://127.0.0.1:5179/"], ["Origin", "null"],
    ["X-Studio-Token", "0".repeat(64)], ["X-Studio-Token", "short"], ["X-Studio-Token", "g".repeat(64)],
    ["Content-Type", "application/x-www-form-urlencoded"], ["Content-Type", "text/plain"], ["Content-Type", "application/jsonp"],
    ["Sec-Fetch-Site", "cross-site"], ["Sec-Fetch-Site", "same-site"], ["Sec-Fetch-Site", "none"],
  ]) {
    const bad = request();
    const index = bad.rawHeaders.findIndex((header) => header === name);
    if (index === -1) bad.rawHeaders.push(name!, value!);
    else bad.rawHeaders[index + 1] = value!;
    denied(() => assertStudioWrite(bad, 5179, token));
  }
  for (const name of ["Origin", "X-Studio-Token", "Content-Type"]) {
    const missing = request();
    missing.rawHeaders.splice(missing.rawHeaders.indexOf(name), 2);
    denied(() => assertStudioWrite(missing, 5179, token));
    const duplicate = request();
    duplicate.rawHeaders.push(name.toLowerCase(), duplicate.rawHeaders[duplicate.rawHeaders.indexOf(name) + 1]!);
    denied(() => assertStudioWrite(duplicate, 5179, token));
  }
  const duplicateSite = request();
  duplicateSite.rawHeaders.push("Sec-Fetch-Site", "same-origin", "sec-fetch-site", "same-origin");
  denied(() => assertStudioWrite(duplicateSite, 5179, token));
});

test("read requests need Host but no write credentials, OPTIONS cannot pass", () => {
  assertStudioRequest({ method: "GET", rawHeaders: ["Host", "localhost:5179"] }, 5179, token);
  for (const method of ["PUT", "POST", "DELETE", "PATCH", "OPTIONS"]) denied(() => assertStudioRequest({ method, rawHeaders: ["Host", "localhost:5179"] }, 5179, token));
  denied(() => assertStudioWrite({ ...request(), method: "OPTIONS" }, 5179, token));
});

test("source writes recheck canonical closure, file kind and symlink parent containment", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "dv-studio-security-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, "project");
  const outside = join(temporary, "project-other");
  mkdirSync(root);
  mkdirSync(outside);
  const source = join(root, "main.dvml");
  const extra = join(root, "unloaded.dvml");
  const external = join(outside, "main.dvml");
  for (const file of [source, extra, external]) writeFileSync(file, "source");
  const loaded = [realpathSync(source)];
  assert.equal(assertSourceWrite(root, source, loaded), loaded[0]);
  denied(() => assertSourceWrite(root, extra, loaded), "STUDIO_SOURCE_FORBIDDEN");
  denied(() => assertSourceWrite(root, root, [...loaded, realpathSync(root)]), "STUDIO_SOURCE_FORBIDDEN");
  denied(() => assertSourceWrite(root, external, [...loaded, realpathSync(external)]), "STUDIO_SOURCE_FORBIDDEN");
  unlinkSync(source);
  symlinkSync(external, source);
  denied(() => assertSourceWrite(root, source, loaded), "STUDIO_SOURCE_FORBIDDEN");
  unlinkSync(source);
  symlinkSync(extra, source);
  denied(() => assertSourceWrite(root, source, loaded), "STUDIO_SOURCE_FORBIDDEN");
  symlinkSync(outside, join(root, "linked"));
  denied(() => assertSourceWrite(root, join(root, "linked", "main.dvml"), [realpathSync(external)]), "STUDIO_SOURCE_FORBIDDEN");
  denied(() => assertSourceWrite(root, join(root, "missing"), loaded), "STUDIO_SOURCE_IO");
});
