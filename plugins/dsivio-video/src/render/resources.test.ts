import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ProjectStore } from "../build/resources.ts";
import { runTool } from "../tools/index.ts";
import { localizeHtml, prepareProject } from "./resources.ts";
import type { ExecuteContext } from "../core/capability.ts";
import type { ResourceRef } from "../core/value.ts";

function html(body: string): string {
  return `<!doctype html><html><body><div data-composition-id="proof" data-dv-fps-numerator="3" data-dv-fps-denominator="1" data-dv-total-frames="3" data-width="16" data-height="16">${body}</div></body></html>`;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dv-localize-"));
  const ctx: ExecuteContext = { buildId: "test", commandKey: "test", idempotencyKey: "test", projectRoot: root, workDir: join(root, "work"), store: new ProjectStore(root), signal: new AbortController().signal, log() {} };
  await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:s=16x16,format=rgb24", "-frames:v", "1", join(root, "a.png")]);
  await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=16x16,format=rgb24", "-frames:v", "1", join(root, "ba.png")]);
  return { root, ctx };
}
async function coloredResources(resources: ResourceRef[], ctx: ExecuteContext) {
  const colors = new Map<string,string>();
  for (const ref of resources) {
    const data = await sharp(ctx.store.pathOf(ref)).removeAlpha().raw().toBuffer();
    colors.set([...data.subarray(0,3)].join(","), `dv-resource://${encodeURIComponent(ref.$resource)}`);
  }
  assert.deepEqual([...colors.keys()].sort(), ["0,0,255", "255,0,0"]);
  return { red: colors.get("255,0,0")!, blue: colors.get("0,0,255")! };
}

test("Localization replaces complete resource values without rewriting suffix names or visible text", async () => {
  const { root, ctx } = await fixture();
  try {
    const body = `<p>plain a.png and ba.png</p><img src="a.png" data-label="src='a.png'"><img src=ba.png><video poster='a.png'></video><a href="ba.png">a.png</a><div style="background-image:url('ba.png')"></div><style>.image{background:url(a.png)}.label::after{content:"url(ba.png)"}/* url(a.png) */</style><script>const example='src="a.png"';</script><!-- <img src="a.png"> --><textarea><img src="a.png"></textarea>`;
    const path = join(root, "index.html");
    await writeFile(path, html(body));
    const project = await localizeHtml(path, ctx);
    const { red, blue } = await coloredResources(project.resources, ctx);
    assert.ok(project.html.includes(`<img src="${red}" data-label="src='a.png'">`));
    assert.ok(project.html.includes(`<img src=${blue}>`));
    assert.ok(project.html.includes(`<video poster='${red}'></video>`));
    assert.ok(project.html.includes(`<a href="${blue}">a.png</a>`));
    assert.ok(project.html.includes(`background-image:url('${blue}')`));
    assert.ok(project.html.includes(`.image{background:url(${red})}`));
    assert.ok(project.html.includes('<p>plain a.png and ba.png</p>'));
    assert.ok(project.html.includes('.label::after{content:"url(ba.png)"}/* url(a.png) */'));
    assert.ok(project.html.includes(`<script>const example='src="a.png"';</script>`));
    assert.ok(project.html.includes('<!-- <img src="a.png"> -->'));
    assert.ok(project.html.includes('<textarea><img src="a.png"></textarea>'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Redirected HTTP HTML resolves relative resources against the final response location", async () => {
  const { root, ctx } = await fixture();
  const png = await readFile(join(root, "a.png"));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url === "/entry") { response.writeHead(302, { location: "/nested/pages/index.html" }); response.end(); }
    else if (request.url === "/nested/pages/index.html") { response.writeHead(200, { "content-type": "text/html" }); response.end(html('<img src="../media/picture.png">')); }
    else if (request.url === "/nested/media/picture.png") { response.writeHead(200, { "content-type": "image/png" }); response.end(png); }
    else { response.writeHead(404); response.end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const project = await localizeHtml(`http://127.0.0.1:${address.port}/entry`, ctx);
    assert.deepEqual(requests, ["/entry", "/nested/pages/index.html", "/nested/media/picture.png"]);
    assert.equal(project.resources.length, 1);
    assert.deepEqual(await readFile(ctx.store.pathOf(project.resources[0]!)), png);
    assert.ok(project.html.includes(`src="dv-resource://${project.resources[0]!.$resource}"`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("Srcset localizes every candidate while preserving density and width descriptors and data URLs", async () => {
  const { root, ctx } = await fixture();
  try {
    const data = `data:image/png;base64,${(await readFile(join(root, "a.png"))).toString("base64")}`;
    const path = join(root, "index.html");
    await writeFile(path, html(`<picture><source srcset="a.png 320w,  ba.png 640w"><img src="${data}" srcset="${data} 1x, ba.png 2x"><img data-case="implicit" srcset="a.png, ba.png 2x"></picture>`));
    const project = await localizeHtml(path, ctx);
    const { red, blue } = await coloredResources(project.resources, ctx);
    assert.equal(project.resources.length, 2);
    assert.ok(project.html.includes(`srcset="${red} 320w,  ${blue} 640w"`));
    assert.ok(project.html.includes(`srcset="${data} 1x, ${blue} 2x"`));
    assert.ok(project.html.includes(`src="${data}"`));
    assert.ok(project.html.includes(`data-case="implicit" srcset="${red}, ${blue} 2x"`));
    const prepared = await prepareProject({ input: { kind: "html", project }, frames: [0] }, ctx);
    const candidate = /data-case="implicit" srcset="(\S+), (\S+) 2x"/.exec(prepared.html);
    assert.ok(candidate);
    assert.deepEqual(await readFile(join(prepared.projectDir,candidate[1]!)), await readFile(join(root,"a.png")));
    assert.deepEqual(await readFile(join(prepared.projectDir,candidate[2]!)), await readFile(join(root,"ba.png")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
