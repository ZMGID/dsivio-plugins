import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { FieldEditor } from './fields.js';
import { SelectMenu } from './menus.js';
const html = htm.bind(h);

/** @param {unknown} value @returns {string} */
function factText(value) { return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value ?? ''); }

/** @param {{state:import('./state.js').AppState,api:typeof import('./api.js').api,transport:typeof import('./transport.js').transport,t:(key:string,vars?:Record<string,string|number>)=>string}} props */
export function Inspector({ state, api, transport, t }) {
  const [domain, setDomain] = useState('Where');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const view = state.view;
  const entity = view?.entities.find(item => item.editorKey === state.selectedKey);
  const ready = state.status === 'ready' && !state.dirty;
  if (!view) return html`<aside class="studio-inspector inspector-panel" data-inspector aria-label=${t('inspector.title')}><h2>${t('inspector.title')}</h2><p>${t('inspector.unavailable')}</p></aside>`;
  if (!entity) {
    const fps = view.clock.fps;
    const facts = [
      [t('inspector.project'), view.projectRoot], [t('inspector.run'), view.runFile],
      [t('inspector.canvas'), `${view.document.extent.widthPx} × ${view.document.extent.heightPx}`],
      [t('inspector.duration'), `${view.totalFrames * fps.denominator / fps.numerator} s`],
      [t('inspector.fps'), `${fps.numerator}/${fps.denominator}`], [t('inspector.frames'), view.totalFrames],
      [t('inspector.targets'), view.targets.join('\n')], [t('inspector.candidates'), view.candidateCount],
    ];
    return html`<aside class="studio-inspector inspector-panel" data-inspector aria-label=${t('inspector.title')}><h2>${t('inspector.project')}</h2><dl>${facts.map(([label, value]) => html`<dt>${label}</dt><dd>${factText(value)}</dd>`)}</dl></aside>`;
  }
  const owners = new Set([entity.editorKey, entity.authorKey, ...entity.parameterOwners]);
  const seenFields = new Set();
  const groups = view.fieldGroups.filter(group => owners.has(group.ownerKey) && (!entity.fieldGroupKeys || entity.fieldGroupKeys.includes(group.key))).map(group => ({
    ...group,
    fields: group.fields.filter(field => {
      const identity = JSON.stringify([field.fieldKey, field.endpointKey ?? null]);
      if (seenFields.has(identity)) return false;
      seenFields.add(identity); return true;
    }),
  })).filter(group => group.fields.length > 0);
  const domains = ['Where', 'When', 'How'].filter(candidate => groups.some(group => group.domain === candidate));
  const activeDomain = domains.includes(domain) ? domain : domains[0];
  /** @param {import('../companion.ts').TemporalAuthority} authority @param {import('../../core/value.ts').Json} anchorKey */
  async function reanchor(authority, anchorKey) {
    if (!ready || busy || !view || !entity || typeof anchorKey !== 'string') return;
    setBusy(true); setError('');
    try { await api.write('/__studio/time', { expectedViewRevision: view.viewRevision, editorKey: entity.editorKey, authorityKey: authority.key, gesture: 'reanchor', anchorKey }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(false); }
  }
  return html`<aside class="studio-inspector inspector-panel" data-inspector aria-label=${t('inspector.title')} onFocusIn=${() => transport.pause()}>
    <div class="panel-toolbar"><h2>${entity.title}</h2><button type="button" onClick=${() => transport.select(null)} aria-label=${t('inspector.clear')}>×</button></div>
    <dl class="entity-facts"><dt>${t('inspector.author')}</dt><dd>${entity.authorKey}</dd>${Object.entries(entity.facts).map(([key, value]) => html`<dt>${key}</dt><dd>${factText(value)}</dd>`)}</dl>
    ${entity.temporal.length > 0 && html`<section aria-label=${t('inspector.time')}><h3>${t('inspector.time')}</h3>${entity.temporal.map(authority => html`<div key=${authority.key} class="temporal-authority"><dl><dt>${t('inspector.origin')}</dt><dd>${authority.originKey}</dd>${authority.anchorKey && html`<dt>${t('inspector.anchor')}</dt><dd>${authority.anchorKey}</dd>`}<dt>${t('inspector.consumer')}</dt><dd>${authority.consumerPort}</dd>${authority.window ? html`<dt>${t('inspector.interval')}</dt><dd>${authority.window.frames.start}…${authority.window.frames.end}f</dd>` : authority.instant && html`<dt>${t('inspector.frame')}</dt><dd>${authority.instant.frame}f</dd>`}</dl>
      ${authority.gestures.includes('reanchor') && (authority.anchors?.length ?? 0) > 0 && html`<${SelectMenu} label=${t('inspector.reanchor')} disabled=${!ready || busy} value=${authority.anchorKey ?? ''} options=${(authority.anchors ?? []).map(anchor => ({ value: anchor.anchorKey, label: `${anchor.anchorKey} (${anchor.frame}f)` }))} onChange=${/** @param {import('../../core/value.ts').Json} anchor */ anchor => reanchor(authority, anchor)} />`}
    </div>`)}</section>`}
    ${error && html`<p role="alert">${error}</p>`}
    ${domains.length > 0 && html`<nav class="inspector-domains" aria-label=${t('inspector.groups')}>${domains.map(candidate => html`<button key=${candidate} type="button" aria-pressed=${activeDomain === candidate} onClick=${() => setDomain(candidate)}>${t(`inspector.${candidate.toLowerCase()}`)}</button>`)}</nav>`}
    ${groups.length === 0 && html`<p>${t('inspector.noFields')}</p>`}
    ${groups.map(group => html`<section key=${group.key} hidden=${group.domain !== activeDomain} class="inspector-group" data-owner-key=${group.ownerKey}>
      <h3>${['Where', 'When', 'How'].includes(group.pageKey) ? t(`inspector.${group.pageKey.toLowerCase()}`) : group.pageKey} / ${group.sectionKey}</h3><small>${group.ownerKey}</small>
      ${group.fields.map(field => html`<${FieldEditor} key=${`${field.ownerKey}:${field.fieldKey}`} field=${field} schema=${view.fieldSchemas?.[field.schemaKey]} editorKey=${entity.editorKey} revision=${view.viewRevision} ready=${ready} api=${api} t=${t} />`)}
    </section>`)}
  </aside>`;
}
