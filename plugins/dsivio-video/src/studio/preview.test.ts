import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { DvError } from "../core/errors.ts";
import { locateBrowser } from "../render/browser.ts";
import { runTool } from "../tools/index.ts";
import { Workspace } from "../source/workspace.ts";
import { StudioSession } from "./session.ts";
import { startStudioServer } from "./server.ts";

let executable: string | undefined;
try { executable = (await locateBrowser("render")).path; }
catch (error) { if (!(error instanceof DvError) || error.code !== "BROWSER_NOT_PREPARED") throw error; }

test("Sequence preview hides sampling gaps and restores the matching Member on bidirectional seeks", { skip: !executable && "Run setup browser --kind render for real video preview proof" }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dv-studio-sequence-")));
  try {
    await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x120:r=30:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(root, "shot.mp4")]);
    await writeFile(join(root, "main.dvml"), `<?dvml using="dsivio-video/markup@1"?>
<dvml>
  <import as="space" from="dsivio-video/space@1"/>
  <import as="program" from="dsivio-video/program@1"/>
  <import as="media" from="dsivio-video/media@1"/>
  <import as="pipeline" from="dsivio-video/pipeline@1"/>
  <import as="time" from="dsivio-video/time@1"/>
  <import as="gallery" from="dsivio-video/media-track@1"/>
  <import as="film" from="dsivio-video/film@1"/>
  <import as="look" source="./look.dvs"/>
  <space:Canvas id="canvas" width="160" height="120"/>
  <space:Frame id="picture" within={canvas} left="0%" top="0%" right="100%" bottom="100%"/>
  <program:Clock id="clock" frame-rate="30"/>
  <time:Timeline id="timeline" clock={clock} end="60f"/>
  <media:Video id="shot" src="./shot.mp4"/>
  <pipeline:Normalize id="normalized" source={shot} clock={clock} video="primary-moving" audio="none" span-authority="video"/>
  <gallery:Track id="gallery" timeline={timeline} canvas={canvas}>
    <gallery:Sequence id="sequence" frame={picture} appearance={look.media.base} until="60f">
      <gallery:Member id="first" media={normalized.media} at="0f"/>
      <gallery:Member id="next" media={normalized.media} at="30f"/>
      <gallery:Handoff id="cut" from="first" transition={look.media.cut}/>
    </gallery:Sequence>
  </gallery:Track>
  <film:Film id="film" canvas={canvas} timeline={timeline} appearance={look.film.base}>
    <film:Track source={gallery.visual}/>
  </film:Film>
</dvml>`);
    await writeFile(join(root, "look.dvs"), '<?dvml using="dsivio-video/dvs@1"?>\n<sheet version="1">\nfilm.base { background: "#000000"; }\nmedia.base { stack-order: 0; fit: cover; clip: frame; }\nmedia.cut { operator: cut; duration-frames: 0; audio: cut; }\n</sheet>');
    await writeFile(join(root, "main.dvrun"), '<?dvml using="dsivio-video/run@1"?>\n<dvrun version="1"><author source="./main.dvml"/><target output="film.composition"/></dvrun>');
    const session = new StudioSession(Workspace.open({ cwd: root, workspace: root }), join(root, "main.dvrun"));
    const host = await startStudioServer(session, 35102);
    const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.goto(host.url);
      await page.waitForFunction(() => document.querySelector("[data-studio-ready]") || document.querySelector(".compile-state.error"), { timeout: 30_000 });
      assert.equal(session.state.status, "ready", JSON.stringify(session.state.error));
      await page.waitForSelector("[data-studio-ready]", { timeout: 30_000 });
      const iframe = await page.$("iframe"); assert(iframe);
      const preview = await iframe.contentFrame(); assert(preview);
      for (const frame of [0, 29, 30, 59, 0]) {
        await page.evaluate(value => {
          const input = document.querySelector(".transport input[type=range]");
          if (!(input instanceof HTMLInputElement)) throw new Error("Missing frame scrubber");
          input.value = String(value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, frame);
        await page.waitForSelector("[data-studio-ready]", { timeout: 30_000 });
        const videos = await preview.evaluate(() => Array.from(document.querySelectorAll("video")).map(video => ({ visibility: getComputedStyle(video).visibility, paused: video.paused, muted: video.muted, time: video.currentTime, ready: video.readyState })));
        assert.equal(videos.length, 2);
        const active = frame < 30 ? 0 : 1;
        assert.equal(videos[active]?.visibility, "visible");
        assert.equal(videos[1 - active]?.visibility, "hidden");
        assert.ok(videos.every(video => video.paused && video.muted));
        assert.ok(videos[active]!.ready >= 2);
        assert.ok(Math.abs(videos[active]!.time - ((frame % 30) + 0.5) / 30) < 0.002);
      }
    } finally { await browser.close(); await host.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
