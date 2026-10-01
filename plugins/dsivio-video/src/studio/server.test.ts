import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { DvError } from "../core/errors.ts";
import { locateBrowser } from "../render/browser.ts";
import { Workspace } from "../source/workspace.ts";
import { StudioSession } from "./session.ts";
import { startStudioServer } from "./server.ts";

let executable: string | undefined;
try { executable = (await locateBrowser("render")).path; }
catch (error) { if (!(error instanceof DvError) || error.code !== "BROWSER_NOT_PREPARED") throw error; }

test("trusted Program preview is opaque and cannot read parent credentials or invoke writes", { skip: !executable && "Run setup browser --kind render for real preview security proof" }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dv-studio-security-")));
  const source = `<?dvml using="dsivio-video/markup@1"?>
<dvml>
  <import as="space" from="dsivio-video/space@1"/>
  <import as="time" from="dsivio-video/time@1"/>
  <import as="overlay" from="dsivio-video/screen-overlay@1"/>
  <import as="film" from="dsivio-video/film@1"/>
  <import as="look" source="./look.dvs"/>
  <space:Canvas id="canvas" width="160" height="120"/>
  <time:Timeline id="timeline" frame-rate="30" end="30f"/>
  <overlay:Track id="wash" canvas={canvas} timeline={timeline}>
    <overlay:ColorWash id="blue" z="1" during="program" color="#336699" opacity="0.5"/>
  </overlay:Track>
  <film:Film id="film" canvas={canvas} timeline={timeline} appearance={look.film.base}>
    <film:Track source={wash.track}/>
  </film:Film>
</dvml>`;
  await writeFile(join(root, "main.dvml"), source);
  await writeFile(join(root, "look.dvs"), '<?dvml using="dsivio-video/dvs@1"?>\n<sheet version="1">\nfilm.base { background: "#000000"; }\n</sheet>');
  await writeFile(join(root, "main.dvrun"), '<?dvml using="dsivio-video/run@1"?>\n<dvrun version="1"><author source="./main.dvml"/><target output="film.composition"/></dvrun>');
  const session = new StudioSession(Workspace.open({ cwd: root, workspace: root }), join(root, "main.dvrun"));
  const host = await startStudioServer(session, 35101);
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(host.url);
    await page.waitForSelector("[data-studio-ready]", { timeout: 30_000 });
    const iframe = await page.$("iframe");
    assert(iframe);
    assert.equal(await iframe.evaluate(element => element.getAttribute("sandbox")), "allow-scripts");
    const frame = await iframe.contentFrame(); assert(frame);
    const isolation = await frame.evaluate(async () => {
      let parentReadable = false; let bootstrapReadable = false;
      try { parentReadable = !!parent.document.querySelector("#app"); } catch (error) { if (!(error instanceof DOMException) || error.name !== "SecurityError") throw error; }
      try { const response = await fetch("/__studio/bootstrap"); await response.json(); bootstrapReadable = true; } catch (error) { if (!(error instanceof TypeError)) throw error; }
      return { origin: window.origin, parentReadable, bootstrapReadable };
    });
    assert.deepEqual(isolation, { origin: "null", parentReadable: false, bootstrapReadable: false });
    const token = await page.evaluate(async () => (await (await fetch("/__studio/bootstrap")).json()).token as string);
    const refused = page.waitForResponse(response => response.url().endsWith("/__studio/comments") && response.request().method() === "OPTIONS");
    const outcome = await frame.evaluate(async validToken => {
      try { await fetch("/__studio/comments", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Token": validToken }, body: JSON.stringify({ comment: { id: "blocked", at: 0, text: "must not be written" } }) }); return "accepted"; }
      catch (error) { if (!(error instanceof TypeError)) throw error; return "rejected"; }
    }, token);
    assert.equal(outcome, "rejected");
    assert.equal((await refused).status(), 403);
    const comments = await (await fetch(`${host.url}__studio/comments`)).json();
    assert.deepEqual(comments.comments, []);
    // The response sandbox also protects direct navigation, not only the UI's iframe attribute.
    const documentPage = await browser.newPage();
    await documentPage.goto(`${host.url}__studio/html`);
    const directIsolation = await documentPage.evaluate(async () => {
      let readable = false;
      try { await (await fetch("/__studio/bootstrap")).json(); readable = true; }
      catch (error) { if (!(error instanceof TypeError)) throw error; }
      return { origin: window.origin, readable };
    });
    assert.deepEqual(directIsolation, { origin: "null", readable: false });
  } finally { await browser.close(); await host.close(); await rm(root, { recursive: true, force: true }); }
});
