import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Menu } from './menus.js';
const html = htm.bind(h);
const LABEL_WIDTH = 148;
const RULER_HEIGHT = 28;
/** @typedef {import('../companion.ts').StudioEntity} Entity */
/** @typedef {import('../companion.ts').TemporalAuthority} Authority */
/** @typedef {import('../companion.ts').StudioLane} Lane */
/** @typedef {import('../companion.ts').StudioBand & {top:number}} BandRow */
/** @typedef {{lane:Lane,depth:number,top:number,height:number,bodyHeight:number,bands:BandRow[]}} LaneRow */
/** @typedef {{entity:Entity,interval:{start:number,end:number},x:number,y:number,width:number,height:number,labelHidden:boolean}} Hit */
/** @typedef {'ruler'|'tracks'} Surface */
/** @typedef {MouseEvent & {currentTarget:HTMLCanvasElement}} CanvasMouse */
/** @typedef {PointerEvent & {currentTarget:HTMLCanvasElement}} CanvasPointer */
/** @typedef {{start:number,end:number,top:number,height:number}} Ghost */
/** @typedef {{kind:'edit',gesture:'move'|'trim-start'|'trim-end',authority:Authority,entity:Entity,origin:number,target:number,delta:number,bounds:{start:number,end:number},top:number,height:number,revision:number,changed:boolean}|{kind:'seek'}} Drag */

/** Stable declared rows: bands stay inside a lane; child lanes have their own height.
 * @param {import('../protocol.ts').ViewRevision} view
 */
export function timelineRows(view) {
  const lanes = [...view.lanes].filter(lane => !view.entities.some(entity => entity.laneKey === lane.key && entity.semanticKind)).sort((a, b) => a.order - b.order);
  /** @type {{lane:Lane,depth:number}[]} */
  const ordered = [];
  /** @param {Lane} lane @param {Set<string>} ancestors */
  const visit = (lane, ancestors) => {
    if (ancestors.has(lane.key) || ordered.some(row => row.lane.key === lane.key)) return;
    ordered.push({ lane, depth: ancestors.size });
    const next = new Set(ancestors); next.add(lane.key);
    lanes.filter(child => child.parentLaneKey === lane.key).forEach(child => visit(child, next));
  };
  lanes.filter(lane => !lane.parentLaneKey || !lanes.some(parent => parent.key === lane.parentLaneKey)).forEach(lane => visit(lane, new Set()));
  lanes.forEach(lane => visit(lane, new Set()));
  let top = 0;
  return ordered.map(({ lane, depth }) => {
    const bands = view.bands.filter(band => band.laneKey === lane.key).sort((a, b) => a.order - b.order);
    const bandHeight = bands.reduce((sum, band) => sum + band.height, 0);
    const height = lane.height + bandHeight;
    /** @type {LaneRow} */
    const row = { lane, depth, top, height, bodyHeight: lane.height, bands: [] };
    let bandTop = top + row.bodyHeight;
    row.bands = bands.map(band => { const result = { ...band, top: bandTop }; bandTop += band.height; return result; });
    top += height; return row;
  });
}

/** Only declared, unambiguous authorization can expose a gesture.
 * @param {Entity} entity @param {import('../protocol.ts').TimeEditRequest['gesture']} gesture
 * @returns {Authority|undefined}
 */
export function gestureAuthority(entity, gesture) {
  const matches = entity.temporal.filter(authority => authority.gestures.includes(gesture));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Preview only declared semantic docking facts; the server still owns the inverse.
 * @param {Authority} authority @param {{start:number,end:number}} bounds
 * @param {number} delta @param {number} total
 * @returns {{start:number,end:number,delta:number}|null}
 */
export function moveBounds(authority, bounds, delta, total) {
  if (authority.originKind === 'semantic' && authority.window) {
    const anchors = authority.anchors ?? [];
    let nearest = anchors[0];
    const target = bounds.start + delta;
    for (const anchor of anchors) if (!nearest || Math.abs(anchor.frame - target) < Math.abs(nearest.frame - target)) nearest = anchor;
    if (!nearest) return null;
    const stops = [...new Set(anchors.map(anchor => anchor.frame))].sort((a, b) => a - b);
    const first = stops.indexOf(bounds.start), last = stops.indexOf(bounds.end);
    if (first < 0 || last < 0) return null;
    const shift = Math.max(-first, Math.min(stops.length - 1 - last, stops.indexOf(nearest.frame) - first));
    const start = stops[first + shift], end = stops[last + shift];
    return start === undefined || end === undefined || end <= start ? null : { start, end, delta: start - bounds.start };
  }
  const bounded = Math.max(-bounds.start, Math.min(total - bounds.end, delta));
  return { start: bounds.start + bounded, end: bounds.end + bounded, delta: bounded };
}

/** A band label is all-or-nothing inside its visible, padded rectangle.
 * @param {number} textWidth @param {number} x @param {number} bandWidth
 * @param {number} plotLeft @param {number} plotRight
 * @returns {number|null}
 */
export function bandLabelPosition(textWidth, x, bandWidth, plotLeft, plotRight) {
  const left = Math.max(x, plotLeft), right = Math.min(x + bandWidth, plotRight);
  if (right - left < textWidth + 10) return null;
  return left + 5;
}

/** @param {{state:import('./state.js').AppState,api:typeof import('./api.js').api,transport:typeof import('./transport.js').transport,t:(key:string,vars?:Record<string,string|number>)=>string}} props */
export function Timeline({ state, api, transport, t }) {
  const view = state.view;
  const [viewport, setViewport] = useState({ start: 0, span: Infinity });
  const [width, setWidth] = useState(600);
  const [menu, setMenu] = useState(/** @type {{x:number,y:number,target:HTMLElement,entities:Entity[]}|null} */ (null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ghost, setGhost] = useState(/** @type {Ghost|null} */ (null));
  const [hover, setHover] = useState(/** @type {{text:string,x:number,y:number}|null} */ (null));
  const root = useRef(/** @type {HTMLElement|null} */ (null));
  const ruler = useRef(/** @type {HTMLCanvasElement|null} */ (null)), tracks = useRef(/** @type {HTMLCanvasElement|null} */ (null));
  const drag = useRef(/** @type {Drag|null} */ (null));
  const hits = useRef(/** @type {Record<Surface,Hit[]>} */ ({ ruler: [], tracks: [] }));
  const total = view?.totalFrames ?? 1;
  const span = Math.max(1, Math.min(total, viewport.span));
  const start = Math.max(0, Math.min(total - span, viewport.start));
  const plotWidth = Math.max(1, width - LABEL_WIDTH);
  const scale = plotWidth / span;
  const rows = view ? timelineRows(view) : [];
  const semantics = view?.entities.filter(entity => entity.semanticKind) ?? [];
  const kinds = ['segment', 'word', 'selection', 'moment'].filter(kind => semantics.some(entity => entity.semanticKind === kind));
  const rulerHeight = RULER_HEIGHT + kinds.length * 24;
  const trackHeight = Math.max(40, ...rows.map(row => row.top + row.height));
  const ready = state.status === 'ready' && !state.dirty;
  /** @param {number} x */
  const frameAt = x => Math.max(0, Math.min(total, Math.round(start + (x - LABEL_WIDTH) / scale)));
  /** @param {number} frame */
  const xAt = frame => LABEL_WIDTH + (frame - start) * scale;
  /** @param {number} nextStart @param {number} nextSpan */
  function windowTo(nextStart, nextSpan) {
    const boundedSpan = Math.max(1, Math.min(total, nextSpan));
    setViewport({ start: Math.max(0, Math.min(total - boundedSpan, nextStart)), span: boundedSpan });
  }
  /** @param {number} factor @param {number} [x] */
  function zoom(factor, x = LABEL_WIDTH + plotWidth / 2) {
    const at = start + (x - LABEL_WIDTH) / scale;
    const nextSpan = Math.max(1, Math.min(total, span * factor));
    windowTo(at - ((x - LABEL_WIDTH) / plotWidth) * nextSpan, nextSpan);
  }
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(180, entries[0]?.contentRect.width ?? 600)));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { drag.current = null; setGhost(null); setHover(null); }, [view?.viewRevision, start, span]);
  useEffect(() => {
    if (!view || !root.current) return;
    const colors = getComputedStyle(root.current);
    const text = colors.getPropertyValue('--text').trim() || (state.theme === 'dark' ? '#e9edf4' : '#1d2736');
    const background = state.theme === 'dark' ? '#172131' : '#f4f6fa';
    const line = state.theme === 'dark' ? '#344156' : '#d4dbe7';
    const selected = view.entities.find(entity => entity.editorKey === state.selectedKey);
    /** @param {HTMLCanvasElement|null} canvas @param {number} height @param {boolean} isRuler */
    function paint(canvas, height, isRuler) {
      if (!canvas || !view) return;
      const ratio = devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.scale(ratio, ratio);
      ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); ctx.font = '12px system-ui'; ctx.textBaseline = 'middle';
      /** @type {Hit[]} */
      const targetHits = []; hits.current[isRuler ? 'ruler' : 'tracks'] = targetHits;
      if (isRuler) {
        ctx.fillStyle = text; ctx.fillText(t('timeline.program'), 8, RULER_HEIGHT / 2);
        const minimumStep = Math.max(1, span * Math.max(70, ctx.measureText(`${total}f`).width + 16) / plotWidth);
        const magnitude = 10 ** Math.floor(Math.log10(minimumStep));
        const step = ([1, 2, 5, 10].find(multiplier => multiplier * magnitude >= minimumStep) ?? 10) * magnitude;
        for (let frame = Math.ceil(start / step) * step; frame <= start + span; frame += step) {
          const x = xAt(frame); ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, RULER_HEIGHT); ctx.stroke();
          ctx.fillStyle = text; ctx.fillText(`${frame}f`, x + 3, 12);
        }
        kinds.forEach((kind, index) => { ctx.fillStyle = text; ctx.fillText(t(`timeline.${kind}`), 8, RULER_HEIGHT + index * 24 + 12); });
      } else rows.forEach(row => {
        ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(0, row.top); ctx.lineTo(width, row.top); ctx.stroke();
        ctx.fillStyle = text; ctx.fillText(row.lane.title, 8 + row.depth * 12, row.top + Math.min(row.bodyHeight / 2, 20));
        row.bands.forEach(band => { ctx.fillStyle = text; ctx.fillText(band.title, 12, band.top + band.height / 2); });
      });
      ctx.save(); ctx.beginPath(); ctx.rect(LABEL_WIDTH, isRuler ? RULER_HEIGHT : 0, plotWidth, height); ctx.clip();
      const entities = view.entities.filter(entity => Boolean(entity.semanticKind) === isRuler);
      if (!isRuler) entities.sort((a, b) => a.paintRank - b.paintRank);
      entities.forEach(entity => {
        const row = rows.find(row => row.lane.key === entity.laneKey);
        const band = row?.bands.find(band => band.key === entity.bandKey);
        const top = isRuler ? RULER_HEIGHT + kinds.indexOf(entity.semanticKind ?? '') * 24 : band?.top ?? row?.top;
        const h = isRuler ? 24 : band?.height ?? row?.bodyHeight;
        if (top === undefined || h === undefined) return;
        entity.intervals.forEach(interval => {
          if (interval.end <= interval.start && entity.semanticKind !== 'moment') return;
          if (interval.end < start || interval.start > start + span) return;
          const x = xAt(interval.start), right = xAt(interval.end), w = Math.max(entity.semanticKind === 'moment' ? 5 : 1, right - x);
          const active = entity.editorKey === state.selectedKey || Boolean(selected?.selectionGroup && selected.selectionGroup === entity.selectionGroup);
          ctx.fillStyle = active ? '#ad70ec' : isRuler ? (state.frame >= interval.start && state.frame < interval.end ? '#479985' : '#607f9f') : '#427ead';
          ctx.fillRect(x, top + 2, w, h - 4);
          const label = entity.text ?? entity.title;
          const labelX = bandLabelPosition(ctx.measureText(label).width, x, w, LABEL_WIDTH, width);
          if (labelX !== null) {
            ctx.fillStyle = '#fff'; ctx.fillText(label, labelX, top + h / 2);
          }
          targetHits.push({ entity, interval, x, y: top + 2, width: w, height: h - 4, labelHidden: labelX === null });
        });
      });
      // Selected editing overlay is raised without changing authored paint order.
      targetHits.filter(hit => hit.entity.editorKey === state.selectedKey).forEach(hit => {
        ctx.strokeStyle = '#e1b7ff'; ctx.lineWidth = 2; ctx.strokeRect(hit.x, hit.y, hit.width, hit.height);
        if (ready && !busy) {
          ctx.fillStyle = '#fff';
          if (gestureAuthority(hit.entity, 'trim-start')) ctx.fillRect(hit.x, hit.y + 1, 3, hit.height - 2);
          if (gestureAuthority(hit.entity, 'trim-end')) ctx.fillRect(hit.x + hit.width - 3, hit.y + 1, 3, hit.height - 2);
        }
      });
      if (ghost && !isRuler) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(xAt(ghost.start), ghost.top + 1, Math.max(1, (ghost.end - ghost.start) * scale), ghost.height - 2); }
      ctx.restore();
      ctx.strokeStyle = '#e64755'; ctx.beginPath(); ctx.moveTo(xAt(state.frame), 0); ctx.lineTo(xAt(state.frame), height); ctx.stroke();
    }
    paint(ruler.current, rulerHeight, true); paint(tracks.current, trackHeight, false);
  }, [view, width, start, span, state.frame, state.selectedKey, state.theme, state.locale, ghost, busy, ready]);
  /** @param {CanvasMouse} event */
  function location(event) {
    const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  /** @param {CanvasMouse} event @param {Surface} kind */
  function under(event, kind) {
    const point = location(event);
    return hits.current[kind].filter(hit => point.x >= hit.x && point.x <= hit.x + hit.width && point.y >= hit.y && point.y <= hit.y + hit.height).reverse();
  }
  /** @param {CanvasMouse} event @param {Surface} kind */
  function editingHit(event, kind) {
    const candidates = under(event, kind);
    return candidates.find(hit => hit.entity.editorKey === state.selectedKey) ?? candidates[0];
  }
  /** @param {CanvasPointer} event @param {Surface} kind */
  function pointerDown(event, kind) {
    if (event.button !== 0 || !view) return;
    setHover(null);
    const point = location(event), hit = editingHit(event, kind);
    transport.pause(); event.currentTarget.setPointerCapture(event.pointerId);
    if (!hit) { drag.current = { kind: 'seek' }; transport.seekFrame(Math.min(total - 1, frameAt(point.x))); return; }
    transport.select(hit.entity.editorKey);
    if (!ready || busy) return;
    /** @type {'move'|'trim-start'|'trim-end'|null} */
    let gesture = null, authority;
    if (Math.abs(point.x - hit.x) <= 7 && (authority = gestureAuthority(hit.entity, 'trim-start'))) gesture = 'trim-start';
    else if (Math.abs(point.x - hit.x - hit.width) <= 7 && (authority = gestureAuthority(hit.entity, 'trim-end'))) gesture = 'trim-end';
    else if ((authority = gestureAuthority(hit.entity, 'move'))) gesture = 'move';
    if (!gesture || !authority) return;
    const bounds = authority.window?.frames ?? (gesture === 'move' && authority.instant ? { start: authority.instant.frame, end: authority.instant.frame } : hit.interval);
    drag.current = { kind: 'edit', gesture, authority, entity: hit.entity, origin: frameAt(point.x), target: frameAt(point.x), delta: 0, bounds, top: hit.y, height: hit.height, revision: view.viewRevision, changed: false };
  }
  /** @param {CanvasPointer} event @param {Surface} kind */
  function pointerMove(event, kind) {
    const point = location(event), current = drag.current;
    if (!current) {
      const hit = editingHit(event, kind);
      event.currentTarget.style.cursor = hit && ready && !busy ? ((Math.abs(point.x - hit.x) <= 7 && gestureAuthority(hit.entity, 'trim-start')) || (Math.abs(point.x - hit.x - hit.width) <= 7 && gestureAuthority(hit.entity, 'trim-end')) ? 'ew-resize' : gestureAuthority(hit.entity, 'move') ? 'grab' : 'pointer') : 'default';
      const labelHit = point.x >= LABEL_WIDTH ? under(event, kind)[0] : undefined;
      setHover(labelHit?.labelHidden ? { text: labelHit.entity.text ?? labelHit.entity.title, x: Math.max(8, Math.min(event.clientX + 12, innerWidth - 380)), y: Math.max(8, Math.min(event.clientY + 12, innerHeight - 52)) } : null);
      return;
    }
    if (current.kind === 'seek') { transport.seekFrame(Math.min(total - 1, frameAt(point.x))); return; }
    const delta = frameAt(point.x) - current.origin;
    let from = current.bounds.start, until = current.bounds.end;
    if (current.gesture === 'move') {
      const moved = moveBounds(current.authority, current.bounds, delta, total);
      if (!moved) { current.changed = false; setGhost(null); return; }
      from = moved.start; until = moved.end; current.delta = moved.delta;
    }
    else if (current.gesture === 'trim-start') from = Math.max(0, Math.min(until - 1, current.bounds.start + delta));
    else until = Math.min(total, Math.max(from + 1, current.bounds.end + delta));
    current.target = current.gesture === 'trim-start' ? from : until; current.changed = from !== current.bounds.start || until !== current.bounds.end;
    setGhost({ start: from, end: until, top: current.top, height: current.height });
  }
  async function pointerUp() {
    const current = drag.current; drag.current = null; setGhost(null);
    if (current?.kind !== 'edit' || !current.changed) return;
    setBusy(true); setError('');
    try { await api.write('/__studio/time', { expectedViewRevision: current.revision, editorKey: current.entity.editorKey, authorityKey: current.authority.key, gesture: current.gesture, ...(current.gesture === 'move' ? { deltaFrames: current.delta } : { targetFrame: current.target }) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(false); }
  }
  /** @param {CanvasMouse} event @param {Surface} kind */
  function context(event, kind) {
    event.preventDefault(); const matches = under(event, kind); if (!matches.length) return;
    setHover(null);
    setMenu({ x: event.clientX, y: event.clientY, target: event.currentTarget, entities: [...new Map(matches.map(hit => [hit.entity.editorKey, hit.entity])).values()] });
  }
  /** @param {WheelEvent} event */
  function wheel(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) { event.preventDefault(); zoom(Math.exp(event.deltaY * 0.002), event.clientX - (root.current?.getBoundingClientRect().left ?? 0)); }
    else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { event.preventDefault(); windowTo(start + (event.deltaX || event.deltaY) / scale, span); }
  }
  /** @param {Surface} kind */
  const canvasProps = kind => ({ onPointerDown: /** @param {CanvasPointer} event */ event => pointerDown(event, kind), onPointerMove: /** @param {CanvasPointer} event */ event => pointerMove(event, kind), onPointerLeave: () => setHover(null), onPointerUp: pointerUp, onPointerCancel: () => { drag.current = null; setGhost(null); setHover(null); }, onContextMenu: /** @param {CanvasMouse} event */ event => context(event, kind) });
  return html`<section ref=${root} class="studio-timeline timeline-panel" aria-label=${t('timeline.title')} onWheel=${wheel}>
    <div class="panel-toolbar timeline-toolbar"><strong>${t('timeline.title')}</strong><button type="button" onClick=${() => windowTo(0, total)}>${t('timeline.fit')}</button><button type="button" aria-label=${t('timeline.zoomOut')} onClick=${() => zoom(2)}>−</button><button type="button" aria-label=${t('timeline.zoomIn')} onClick=${() => zoom(0.5)}>+</button></div>
    ${error && html`<p role="alert">${error}</p>`}
    ${!view ? html`<p>${t('timeline.unavailable')}</p>` : html`<canvas ref=${ruler} class="timeline-ruler" tabIndex="0" ...${canvasProps('ruler')} aria-label=${t('timeline.ruler')} onDblClick=${/** @param {CanvasMouse} event */ event => { const hit = under(event, 'ruler')[0]; if (hit?.entity.semanticKind === 'segment') windowTo(hit.interval.start, Math.max(1, hit.interval.end - hit.interval.start)); }} />
      <div class="timeline-tracks" style=${{ overflowY: 'auto', flex: 1, minHeight: '40px' }}><canvas ref=${tracks} tabIndex="0" ...${canvasProps('tracks')} aria-label=${t('timeline.tracks')} /></div>
      <details class="timeline-accessible" style=${{ maxHeight: '92px', overflow: 'auto', flex: 'none' }}><summary>${t('timeline.entities')}</summary>${view.entities.map(entity => html`<button key=${entity.editorKey} type="button" aria-pressed=${state.selectedKey === entity.editorKey} onClick=${() => transport.select(entity.editorKey)}>${entity.title}</button>`)}</details>
      <input type="range" aria-label=${t('timeline.pan')} min="0" max=${Math.max(0, total - span)} step="1" value=${Math.round(start)} onInput=${/** @param {import('preact').TargetedEvent<HTMLInputElement>} event */ event => windowTo(Number(event.currentTarget.value), span)} />`}
    ${menu && html`<${Menu} label=${t('timeline.overlap')} position=${menu} returnFocus=${menu.target} onClose=${() => setMenu(null)} items=${menu.entities.map(entity => ({ key: entity.editorKey, label: entity.title, selected: entity.editorKey === state.selectedKey, action: () => transport.select(entity.editorKey) }))} />`}
    ${hover && !menu && html`<span role="tooltip" class="timeline-tooltip" style=${{ position: 'fixed', left: `${hover.x}px`, top: `${hover.y}px`, zIndex: 999, pointerEvents: 'none', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 8px', maxWidth: 'min(360px, calc(100vw - 16px))', overflowWrap: 'anywhere' }}>${hover.text}</span>`}
  </section>`;
}
