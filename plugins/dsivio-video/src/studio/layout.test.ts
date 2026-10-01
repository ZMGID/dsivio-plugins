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

test("timeline exposes its fitting lanes and remembers a dragged boundary without squeezing the stage away", { skip: !executable && "Run setup browser --kind render for layout interaction proof" }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dv-studio-layout-")));
  try {
    const tracks = Array.from({ length: 5 }, (_, i) => `<overlay:Track id="track-${i}" canvas={canvas} timeline={timeline}><overlay:ColorWash id="wash-${i}" z="${i}" during="program" color="#336699" opacity="0.1"/></overlay:Track>`).join("\n");
    const inputs = Array.from({ length: 5 }, (_, i) => `<film:Track source={track-${i}.track}/>`).join("\n");
    await writeFile(join(root, "main.dvml"), `<?dvml using="dsivio-video/markup@1"?>
<dvml>
  <import as="space" from="dsivio-video/space@1"/>
  <import as="time" from="dsivio-video/time@1"/>
  <import as="overlay" from="dsivio-video/screen-overlay@1"/>
  <import as="film" from="dsivio-video/film@1"/>
  <import as="look" source="./look.dvs"/>
  <space:Canvas id="canvas" width="160" height="120"/>
  <time:Timeline id="timeline" frame-rate="30" end="30f"/>
  ${tracks}
  <film:Film id="film" canvas={canvas} timeline={timeline} appearance={look.film.base}>${inputs}</film:Film>
</dvml>`);
    await writeFile(join(root, "look.dvs"), '<?dvml using="dsivio-video/dvs@1"?>\n<sheet version="1">\nfilm.base { background: "#000000"; }\n</sheet>');
    await writeFile(join(root, "main.dvrun"), '<?dvml using="dsivio-video/run@1"?>\n<dvrun version="1"><author source="./main.dvml"/><target output="film.composition"/></dvrun>');
    const host = await startStudioServer(new StudioSession(Workspace.open({ cwd: root, workspace: root }), join(root, "main.dvrun")), 35103);
    const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 960 });
      await page.goto(host.url);
      await page.waitForSelector("[data-studio-ready]", { timeout: 30_000 });
      const initial = await page.evaluate(() => {
        const timeline = document.querySelector(".timeline-host"), stage = document.querySelector(".stage-panel"), tracks = document.querySelector(".timeline-tracks");
        if (!timeline || !stage || !tracks) throw new Error("Missing Studio layout surface");
        return { timeline: timeline.getBoundingClientRect().height, stage: stage.getBoundingClientRect().height, visible: tracks.clientHeight, required: tracks.scrollHeight };
      });
      assert.ok(initial.visible >= initial.required, `Lanes clipped: ${initial.visible}/${initial.required}`);
      const handle = await page.$(".timeline-resize"); assert(handle);
      const bounds = await handle.boundingBox(); assert(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 80, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(height => (document.querySelector(".timeline-host")?.getBoundingClientRect().height ?? 0) > height, {}, initial.timeline);
      const dragged = await page.evaluate(() => ({ timeline: document.querySelector(".timeline-host")!.getBoundingClientRect().height, stage: document.querySelector(".stage-panel")!.getBoundingClientRect().height }));
      assert.ok(Math.abs(dragged.timeline - initial.timeline - 80) < 1);
      assert.ok(Math.abs(initial.stage - dragged.stage - 80) < 1);
      await page.reload();
      await page.waitForSelector("[data-studio-ready]", { timeout: 30_000 });
      assert.equal(await page.$eval(".timeline-host", element => element.getBoundingClientRect().height), dragged.timeline);
      await page.setViewport({ width: 1440, height: 460 });
      await page.waitForFunction(() => (document.querySelector(".timeline-host")?.getBoundingClientRect().bottom ?? Infinity) <= innerHeight);
      assert.ok(await page.$eval(".stage-panel", element => element.getBoundingClientRect().height) >= 160);
    } finally { await browser.close(); await host.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
