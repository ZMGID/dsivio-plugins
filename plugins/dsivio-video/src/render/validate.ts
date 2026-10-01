import { DvError } from "../core/errors.ts";
import { canonicalJson, isResourceRef } from "../core/value.ts";
import { frameToSample48k, validateClock } from "../timeline/math.ts";
import type { Bounds, Clock, Rational } from "../timeline/types.ts";
import { BROWSER_PROGRAM_VERSION, STYLE_PROPERTIES, VISUAL_IR_VERSION } from "./ir.ts";
import type { AudioTrack, ProgramDomain, RenderDocument, Surface, VideoSamplingMap, VisualTrack } from "./ir.ts";
import { validatePathTextFlow, validateTextFlow, validateTextFormat } from "./text-runtime.ts";

export function invalid(message: string): never { throw new DvError("TYPE_INVALID", message); }
export function object(data: unknown): Record<string, unknown> { if (!data || typeof data !== "object" || Array.isArray(data)) invalid("Expected an object"); return data as Record<string, unknown>; }
export function integer(data: unknown, minimum = 0): asserts data is number { if (typeof data !== "number" || !Number.isSafeInteger(data) || data < minimum) invalid(`Expected a safe integer >= ${minimum}`); }
export function text(data: unknown): asserts data is string { if (typeof data !== "string" || !data) invalid("Expected nonempty text"); }
export function finite(data: unknown): asserts data is number { if (typeof data !== "number" || !Number.isFinite(data)) invalid("Expected finite number"); }
export function array(data: unknown): unknown[] { if (!Array.isArray(data)) invalid("Expected array"); return data; }
export function resource(data: unknown): void { if (!isResourceRef(data) || !data.$resource || !Number.isSafeInteger(data.bytes) || data.bytes < 0 || typeof data.mime !== "string" || !data.mime) invalid("Invalid resource reference"); }
export function bounds(data: unknown, max = Number.MAX_SAFE_INTEGER): asserts data is Bounds { const b = object(data); integer(b.start); integer(b.end, 1); if (b.end <= b.start || b.end > max) invalid("Invalid half-open interval"); }
export function clock(data: unknown): asserts data is Clock { const c = object(data); const f = object(c.fps); integer(f.numerator, 1); integer(f.denominator, 1); validateClock(data as Clock); }
export function rational(data: unknown): asserts data is Rational { const r = object(data); integer(r.numerator); integer(r.denominator, 1); }
export function validateDomain(data: unknown): asserts data is ProgramDomain { const d = object(data); text(d.axisKey); clock(d.clock); integer(d.totalFrames, 1); integer(d.totalSamples48k, 1); if (d.totalSamples48k !== frameToSample48k(d.totalFrames, d.clock)) invalid("Program sample/frame domains disagree"); }
export function extent(data: unknown): void { const e = object(data); integer(e.widthPx, 1); integer(e.heightPx, 1); }
export function validateStyle(data: unknown, animated = false): void {
  const seen = new Set<string>();
  for (const raw of array(data)) { const d = object(raw); text(d.property); text(d.value);
    if (!(animated ? ["opacity", "transform", "filter", "backdrop-filter", "clip-path"] : STYLE_PROPERTIES).includes(d.property as never) || seen.has(d.property)) invalid("Unknown or duplicate style property");
    if (/[;{}\u0000-\u001f\u007f]|!\s*important|(?:var|env|attr|url|image-set)\s*\(/i.test(d.value) || /\\|\/\*/.test(d.value)) invalid("Unsafe style value"); seen.add(d.property);
  }
}
export function sampleFrame(map: VideoSamplingMap, localFrame: number): number | null {
  const piece = map.pieces.find(p => localFrame >= p.target.start && localFrame < p.target.end); if (!piece) return null;
  const denominator = BigInt(piece.sourceStart.denominator) * BigInt(piece.sourceStep.denominator);
  let numerator = BigInt(piece.sourceStart.numerator) * BigInt(piece.sourceStep.denominator) + BigInt(localFrame - piece.target.start) * BigInt(piece.sourceStep.numerator) * BigInt(piece.sourceStart.denominator);
  if (piece.loop) { const start = BigInt(piece.loop.sourceFrames.start) * denominator; const span = BigInt(piece.loop.sourceFrames.end - piece.loop.sourceFrames.start) * denominator; numerator = start + ((numerator - start) % span + span) % span; }
  return Number(numerator / denominator);
}
export function validateSampling(data: unknown, duration: number): asserts data is VideoSamplingMap {
  const m = object(data); clock(m.sourceClock); integer(m.sourceTotalFrames, 1); let end = 0;
  for (const raw of array(m.pieces)) { const p = object(raw); bounds(p.target, duration); if (p.target.start < end) invalid("Sampling pieces overlap or are unordered"); end = p.target.end; rational(p.sourceStart); rational(p.sourceStep);
    if (p.loop !== undefined) { const l = object(p.loop); bounds(l.sourceFrames, m.sourceTotalFrames); rational(l.phase);
      if (BigInt(l.phase.numerator) >= BigInt(l.sourceFrames.end - l.sourceFrames.start) * BigInt(l.phase.denominator)) invalid("Loop phase outside source window");
      if (BigInt(p.sourceStart.numerator) * BigInt(l.phase.denominator) !== (BigInt(l.sourceFrames.start) * BigInt(l.phase.denominator) + BigInt(l.phase.numerator)) * BigInt(p.sourceStart.denominator)) invalid("Loop sourceStart disagrees with phase");
    }
  }
  const map = data as VideoSamplingMap;
  for (const p of map.pieces) for (const k of [p.target.start, p.target.end - 1]) { const f = sampleFrame(map, k); if (f === null || f < 0 || f >= map.sourceTotalFrames) invalid("Sampling exceeds source frame domain"); }
}
export function validateSurface(data: unknown): asserts data is Surface { const s = object(data); resource(s.resource); extent(s.extent); if (!["opaque", "straight"].includes(String(s.alpha)) || s.color !== "srgb-sdr") invalid("Invalid surface color/alpha"); const timing = object(s.timing); if (timing.kind === "frames") { clock(timing.clock); integer(timing.totalFrames, 1); } else if (timing.kind !== "still") invalid("Invalid surface timing"); }
export function validateVisualTrack(data: unknown, domain?: ProgramDomain): asserts data is VisualTrack {
  const t = object(data); if (t.kind !== "visual") invalid("Expected visual track"); text(t.trackKey); text(t.axisKey); if (domain && t.axisKey !== domain.axisKey) invalid("Track axis mismatch"); const presents = new Set<string>();
  for (const raw of array(t.presents)) {
    const p = object(raw); text(p.presentKey); text(p.axisKey); if (p.axisKey !== t.axisKey || presents.has(p.presentKey)) invalid("Present axis or identity mismatch"); presents.add(p.presentKey); bounds(p.lifetime, domain?.totalFrames); finite(p.layer); if (!Number.isSafeInteger(p.layer)) invalid("Layer must be integer"); text(p.layerKey); text(p.rootKey);
    if (p.visible !== undefined) { let end = p.lifetime.start; for (const w of array(p.visible)) { bounds(w, p.lifetime.end); if (w.start < end) invalid("Visible windows overlap or escape lifetime"); end = w.end; } }
    const nodes = array(p.nodes).map(object); const keys = new Map<string, Record<string, unknown>>(); const orders = new Set<number>();
    for (const n of nodes) { text(n.nodeKey); integer(n.order); if (keys.has(n.nodeKey) || orders.has(n.order)) invalid("Duplicate node key/order"); keys.set(n.nodeKey, n); orders.add(n.order); validateStyle(n.style);
      const attrs = new Set<string>(); for (const a of array(n.attributes).map(object)) { text(a.name); if (!/^(?:data-[\w-]+|aria-[\w-]+|role|title|lang|dir)$/.test(a.name) || attrs.has(a.name) || typeof a.value !== "string") invalid("Invalid HTML attributes"); attrs.add(a.name); }
      const kfs = array(n.keyframes); if (kfs.length === 1) invalid("At least two keyframes required"); let last = -1;
      for (const k of kfs.map(object)) { integer(k.offsetFrames); if (k.offsetFrames <= last || !["linear", "ease-in", "ease-out", "ease-in-out"].includes(String(k.easing)) || array(k.declarations).length === 0) invalid("Invalid keyframes"); validateStyle(k.declarations, true); last = k.offsetFrames; }
      if (n.kind === "image" || n.kind === "video") resource(n.resource);
      if (n.kind === "surface") validateSurface(n.surface);
      if (n.sampling !== undefined) { if (!["video", "surface"].includes(String(n.kind)) || kfs.length) invalid("Sampling only on unanimated video/frames surface"); validateSampling(n.sampling, p.lifetime.end - p.lifetime.start); }
      if (n.kind === "surface") { const s = n.surface as Surface; if (s.timing.kind === "still" && n.sampling !== undefined) invalid("Still surface cannot be sampled"); if (s.timing.kind === "frames") { const m = n.sampling as VideoSamplingMap | undefined; if (m ? m.sourceTotalFrames !== s.timing.totalFrames || canonicalJson(m.sourceClock) !== canonicalJson(s.timing.clock) : s.timing.totalFrames !== p.lifetime.end - p.lifetime.start || domain && canonicalJson(domain.clock) !== canonicalJson(s.timing.clock)) invalid("Surface timing disagrees with sampling/lifetime"); } }
      if (n.kind === "text") { if (typeof n.text !== "string") invalid("Invalid text"); validateTextFormat(n.format); }
      if (n.kind === "text-flow") validateTextFlow(n.flow);
      if (n.kind === "path-text") validatePathTextFlow(n.flow);
      if (n.kind === "path-text") { const path = object(n.path); const points=[object(path.start)]; for(const segment of array(path.segments).map(object)){if(!["line","quadratic","cubic"].includes(String(segment.kind)))invalid("Unknown path segment");points.push(object(segment.to));if(segment.kind==="quadratic")points.push(object(segment.control));if(segment.kind==="cubic")points.push(object(segment.control1),object(segment.control2));}for(const point of points){finite(point.xPx);finite(point.yPx);} finite(n.startMarginPx); finite(n.endMarginPx); if (!["left", "right"].includes(String(n.side)) || !["follow", "upright"].includes(String(n.orientation)) || typeof n.reverse !== "boolean" || !["start", "center", "end"].includes(String(n.align)) || !["visible", "clip"].includes(String(n.overflow))) invalid("Invalid path text options"); let offset = -1; for (const k of array(n.marginKeys).map(object)) { integer(k.offsetFrames); finite(k.marginPx); if (k.offsetFrames <= offset || !["linear", "ease-in", "ease-out", "ease-in-out"].includes(String(k.easing))) invalid("Invalid path margin keyframes"); offset = k.offsetFrames; } }
      if (n.kind === "program") { const pr = object(n.program); if (pr.format !== BROWSER_PROGRAM_VERSION || typeof pr.html !== "string" || typeof pr.css !== "string" || typeof pr.setup !== "string") invalid("Invalid browser program"); canonicalJson(pr.data as never); for (const r of array(pr.resources)) resource(r); }
      if (!["box", "image", "video", "surface", "text", "text-flow", "path-text", "mask", "program"].includes(String(n.kind))) invalid("Unknown visual kind");
    }
    const roots = nodes.filter(n => n.parentKey === null); if (roots.length !== 1 || roots[0]?.nodeKey !== p.rootKey) invalid("Present must have its declared unique root");
    for (const n of nodes) { const visited = new Set<string>(); let current = n; while (current.parentKey !== null) { text(current.parentKey); if (visited.has(current.parentKey)) invalid("Node parent cycle"); visited.add(current.parentKey); const parent = keys.get(current.parentKey); if (!parent || !["box", "mask", "program"].includes(String(parent.kind))) invalid("Invalid node parent"); current = parent; }
      const children = nodes.filter(c => c.parentKey === n.nodeKey);
      if (n.kind === "mask") { if (!["alpha", "luminance"].includes(String(n.mode)) || children.length !== 2 || n.maskRootKey === n.contentRootKey || !children.some(c => c.nodeKey === n.maskRootKey) || !children.some(c => c.nodeKey === n.contentRootKey)) invalid("Mask requires exactly two declared roots"); const mask = keys.get(String(n.maskRootKey))!; if (!["text", "text-flow", "path-text", "image", "surface"].includes(String(mask.kind)) || mask.kind === "surface" && (mask.surface as Surface).timing.kind !== "still") invalid("Mask source must be terminal static visual"); }
      if (n.kind === "program") { const html = object(n.program).html as string; const slots = [...html.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1]); if (slots.length !== children.length || new Set(slots).size !== slots.length || slots.some(key => !children.some(c => c.nodeKey === key))) invalid("Program must place all direct child slots exactly once"); }
    }
  }
}
export function validateAudioTrack(data: unknown, domain?: ProgramDomain): asserts data is AudioTrack {
  const t = object(data); if (t.kind !== "audio") invalid("Expected audio track"); text(t.trackKey); text(t.axisKey); if (domain && t.axisKey !== domain.axisKey) invalid("Audio axis mismatch"); const keys = new Set<string>();
  for (const c of array(t.clips).map(object)) { text(c.clipKey); if (keys.has(c.clipKey)) invalid("Duplicate audio clip"); keys.add(c.clipKey); resource(c.source); integer(c.sourceTotalSamples, 1); bounds(c.sourceSamples, c.sourceTotalSamples); bounds(c.targetSamples, domain?.totalSamples48k); rational(c.speed); if (!c.speed.numerator || c.preservePitch !== true) invalid("Invalid audio speed/pitch"); finite(c.gain); if (c.gain < 0 || c.gain > 64) invalid("Audio gain out of range"); integer(c.fadeInSamples); integer(c.fadeOutSamples); if (Math.max(c.fadeInSamples,c.fadeOutSamples) > c.targetSamples.end-c.targetSamples.start) invalid("Fade exceeds target"); if (c.loop !== undefined) { const l = object(c.loop); integer(l.phaseSamples); if (l.phaseSamples >= c.sourceSamples.end-c.sourceSamples.start) invalid("Loop phase outside source"); }
    let last = -1; const curve = array(c.gainCurve).map(object); for (const g of curve) { integer(g.sample); finite(g.gain); if (g.sample <= last || g.gain < 0 || g.gain > 64) invalid("Invalid gain curve"); last = g.sample; } if (curve.length && ((curve[0]!.sample as number) > c.targetSamples.start || (curve.at(-1)!.sample as number) < c.targetSamples.end)) invalid("Gain curve must cover target"); if (c.audible !== undefined) { let end = c.targetSamples.start; for (const w of array(c.audible)) { bounds(w,c.targetSamples.end); if (w.start < end) invalid("Audible windows overlap/escape target"); end = w.end; } }
  }
}
export function validateDocument(data: unknown): asserts data is RenderDocument {
  const d = object(data);
  if (d.version !== VISUAL_IR_VERSION) invalid("Unknown visual IR version");
  text(d.compositionKey); validateDomain(d.domain); extent(d.extent); text(d.html);
  const refs = new Set<string>();
  for (const raw of array(d.resources)) {
    const usage = object(raw); resource(usage.resource);
    const ref = usage.resource as Surface["resource"];
    if (refs.has(ref.$resource)) invalid("Duplicate document resource");
    refs.add(ref.$resource);
    if (usage.required === "windows") for (const interval of array(usage.frames)) bounds(interval, d.domain.totalFrames);
    else if (usage.required !== "global") invalid("Invalid resource usage");
  }
  for (const surface of array(d.surfaces)) {
    validateSurface(surface);
    if (!refs.has(surface.resource.$resource)) invalid("Surface missing resource usage");
  }
  for (const match of d.html.matchAll(/dv-resource:\/\/([^\s"'<>\),]+)/g)) {
    let id: string;
    try { id = decodeURIComponent(match[1]!); }
    catch { invalid("Malformed HTML resource placeholder"); }
    if (!refs.has(id)) invalid("Unlisted HTML resource placeholder");
  }
}
