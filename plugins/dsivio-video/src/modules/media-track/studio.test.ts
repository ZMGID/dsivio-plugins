import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileAuthorDetailed } from "../../elaborate/compile.ts";
import { Workspace } from "../../source/workspace.ts";
import { assembleMediaProgram } from "../../components/media-track/program.ts";
import { lowerMediaVisual, lowerMediaAudio } from "../../components/media-track/lower.ts";
import { mediaTrackTypes } from "../../components/media-track/types.ts";
import type { MediaPlan } from "../../components/media-track/types.ts";
import type { Timeline, SynchronizedMedia } from "../../timeline/types.ts";
import type { Json, Value } from "../../core/value.ts";
import { renderTypes } from "../../render/ir.ts";
import type { CompanionInput } from "../../studio/companion.ts";
import { mediaTrackStudio } from "./studio.ts";

test("visual and audio projections keep distinct keys and Sequence gain writes target the authored Member", t => {
  const dir = mkdtempSync(join(tmpdir(), "dv-media-studio-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "video.mp4"), "compile-only source");
  writeFileSync(join(dir, "look.dvs"), '<?dvml using="dsivio-video/dvs@1"?><sheet version="1">media.base { stack-order: 4; } media.cut { operator: cut; duration-frames: 0; audio: cut; }</sheet>');
  const file = join(dir, "main.dvml");
  writeFileSync(file, `<?dvml using="dsivio-video/markup@1"?><dvml>
    <import as="media" from="dsivio-video/media@1"/><import as="pipeline" from="dsivio-video/pipeline@1"/>
    <import as="script" from="dsivio-video/script@1"/><import as="align" from="dsivio-video/align@1"/>
    <import as="time" from="dsivio-video/time@1"/><import as="program" from="dsivio-video/program@1"/>
    <import as="space" from="dsivio-video/space@1"/><import as="gallery" from="dsivio-video/media-track@1"/>
    <import as="look" source="./look.dvs"/>
    <script:Script id="story"><intro>first second</intro></script:Script>
    <program:Clock id="clock" frame-rate="30"/><space:Canvas id="canvas" width="320" height="180"/>
    <space:Frame id="frame" within={canvas} left="0%" top="0%" right="100%" bottom="100%"/>
    <media:Video id="raw" src="./video.mp4"/><pipeline:Normalize id="normalized" source={raw} clock={clock} video="primary-moving" audio="default" span-authority="video"/>
    <align:SemanticTake id="take" narrative={story} segment={story.segment.intro} media={normalized.media} language="en"/>
    <time:Timeline id="timeline" clock={clock}><time:Take source={take.take}/></time:Timeline>
    <gallery:Track id="gallery" timeline={timeline} canvas={canvas}>
      <gallery:Sequence id="sequence" frame={frame} appearance={look.media.base} until="60f">
        <gallery:Member id="first" media={normalized.media} at="0f" source-audio="content" audio-gain="0.5"/>
        <gallery:Member id="next" media={normalized.media} at="30f" source-audio="content" audio-gain="0.75"/>
        <gallery:Handoff id="cut" from="first" transition={look.media.cut}/>
      </gallery:Sequence>
    </gallery:Track>
  </dvml>`);
  const { graph, authoring } = compileAuthorDetailed(file, Workspace.open({ cwd: dir }));
  const planValue = [...graph.records.values()].map(record => record.value).find(value => value.type === mediaTrackTypes.plan)!;
  const plan = planValue.data as unknown as MediaPlan;
  const timeline: Timeline = { axisKey: "media-axis", clock: { fps: { numerator: 30, denominator: 1 } }, totalFrames: 90, placements: [] };
  const canvas = { canvasKey: "canvas", extent: { widthPx: 320, heightPx: 180 } };
  const frame = { canvasKey: "canvas", rect: { xPx: 0, yPx: 0, widthPx: 320, heightPx: 180 } };
  const media: SynchronizedMedia = { clock: timeline.clock, totalFrames: 90, picture: { resource: { $resource: "picture", bytes: 100, mime: "video/mp4" }, extent: canvas.extent, alpha: "opaque" }, sound: { resource: { $resource: "sound", bytes: 100, mime: "audio/wav" }, totalSamples: 144000 } };
  const program = assembleMediaProgram(timeline, canvas, plan, { frames: [frame], images: [], media: [media, media], surfaces: [], extents: [], clips: [], windows: [] });
  const authorKey = "main.dvml#gallery";
  function input(value: Value, type: string): CompanionInput {
    return { value, type, moduleId: "dsivio-video/media-track@1", surface: "Track", output: type === renderTypes.visual ? "visual" : "audio", outputKey: "output-test", authorKey, authorGraph: graph, authoring, provenance: { kind: "author" }, inputs: {}, executionEdges: [], supports: { program: { type: mediaTrackTypes.program, data: program as unknown as Json } }, timeline, document: { version: "dsivio-video.visual/1", compositionKey: "composition-test", domain: { axisKey: timeline.axisKey, clock: timeline.clock, totalFrames: 90, totalSamples48k: 144000 }, extent: canvas.extent, resources: [], surfaces: [], html: "" }, fallback() { throw new Error("Unexpected fallback"); } };
  }
  const visual = mediaTrackStudio.project(input({ type: renderTypes.visual, data: lowerMediaVisual(program) as unknown as Json }, renderTypes.visual));
  const audio = mediaTrackStudio.project(input({ type: renderTypes.audio, data: lowerMediaAudio(program) as unknown as Json }, renderTypes.audio));
  assert.notEqual(visual.entities[0]!.editorKey, audio.entities[0]!.editorKey);
  assert.notEqual(visual.materials[0]!.key, audio.materials[0]!.key);
  assert.equal(visual.materials[0]!.kind, "video"); assert.equal(audio.materials[0]!.kind, "audio");
  assert.equal(visual.entities[0]!.selectionGroup, audio.entities[0]!.selectionGroup);
  assert.equal(visual.entities[0]!.title, "Sequence");
  assert.deepEqual(audio.fieldGroups.filter(group => group.sectionKey === "Audio Gain").map(group => ({ owner: group.ownerKey, value: group.fields[0]!.authorValue })), [{ owner: "main.dvml#gallery/sequence/first", value: 0.5 }, { owner: "main.dvml#gallery/sequence/next", value: 0.75 }]);
  assert.equal(audio.fieldGroups.some(group => group.sectionKey === "Playback" || group.domain === "Where"), false);
});
