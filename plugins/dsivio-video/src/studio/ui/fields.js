import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { SelectMenu, equalValue } from './menus.js';
const html = htm.bind(h);
/** @typedef {import('../protocol.ts').FieldSchema} Schema */
/** @typedef {import('../../core/value.ts').Json} Json */
/** @typedef {import('preact').TargetedEvent<HTMLInputElement>} InputChange */
/** @typedef {import('preact').TargetedEvent<HTMLInputElement|HTMLTextAreaElement>} TextChange */
/** @typedef {{key:string,path:string}|{message:string}} FieldProblem */

/** Numeric text is never coerced from empty input. Units remain authored, not converted.
 * @param {string} text @param {import('../companion.ts').StudioField} field @returns {Json}
 */
export function parseNumberDraft(text, field) {
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(%|px|ms|s|f)?\s*$/.exec(text);
  if (!match) throw new Error('fields.number');
  const number = Number(match[1]);
  if (!Number.isFinite(number)) throw new Error('fields.number');
  if (typeof field.authorValue === 'string') {
    const authored = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*(%|px|ms|s|f)?\s*$/.exec(field.authorValue);
    if (!authored || (match[2] && match[2] !== authored[1])) throw new Error('fields.unit');
    return `${number}${authored[1] ?? ''}`;
  }
  if (match[2]) throw new Error('fields.unit');
  const scale = field.displayScale ?? 1;
  if (!Number.isFinite(scale) || scale === 0) throw new Error('fields.number');
  return number / scale;
}

/** @param {Json} value @param {Schema|undefined} schema @param {string} path @returns {{key:string,path:string}|null} */
export function validateFieldValue(value, schema, path = '') {
  if (!schema) return null;
  if (schema.enum && !schema.enum.some(option => equalValue(option, value))) return { key: 'fields.option', path };
  const type = schema.type;
  if ((type === 'number' || type === 'integer') && (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value)))) return { key: 'fields.number', path };
  if (type === 'string' && typeof value !== 'string' || type === 'boolean' && typeof value !== 'boolean' || type === 'array' && !Array.isArray(value) || type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return { key: 'fields.type', path };
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return { key: 'fields.range', path };
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) return { key: 'fields.pattern', path };
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return { key: 'fields.count', path };
    for (const [index, child] of value.entries()) { const error = validateFieldValue(child, schema.items, `${path}[${index}]`); if (error) return error; }
  } else if (value && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return { key: 'fields.required', path: `${path}.${key}` };
    for (const [key, child] of Object.entries(value)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {}, key)) return { key: 'fields.property', path: `${path}.${key}` };
      const error = validateFieldValue(child, schema.properties?.[key], `${path}.${key}`); if (error) return error;
    }
  }
  return null;
}

/** Convert numeric draft leaves only according to canonical schema. @param {unknown} draft @param {Schema|undefined} schema @returns {Json} */
export function completeDraft(draft, schema) {
  if (schema?.type === 'number' || schema?.type === 'integer') {
    if (typeof draft === 'string' && /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(draft) && Number.isFinite(Number(draft))) return Number(draft);
    if (typeof draft !== 'number') throw new Error('fields.number');
  }
  if (Array.isArray(draft)) return draft.map(value => completeDraft(value, schema?.items));
  if (draft && typeof draft === 'object') return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, completeDraft(value, schema?.properties?.[key])]));
  return /** @type {Json} */ (draft);
}

/** @param {Schema|undefined} schema @returns {Json} */
function initialValue(schema) {
  if (schema?.enum?.length) return /** @type {Json} */ (schema.enum[0]);
  if (schema?.type === 'object') return {};
  if (schema?.type === 'array') return [];
  if (schema?.type === 'boolean') return false;
  return '';
}

/** Recursive schema widget edits one root draft; no child ever submits HTTP.
 * @param {{schema:Schema,value:any,onChange:(value:any)=>void,label:string,disabled:boolean,t:(key:string,vars?:Record<string,string|number>)=>string}} props
 */
function SchemaWidget({ schema, value, onChange, label, disabled, t }) {
  if (schema.enum) return html`<${SelectMenu} label=${label} disabled=${disabled} options=${schema.enum.map(value => ({ value, label: typeof value === 'string' ? value : JSON.stringify(value) }))} value=${value} onChange=${onChange} />`;
  if (schema.type === 'object') {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const properties = schema.properties ?? {};
    const entries = [...new Set([...Object.keys(properties), ...Object.keys(object)])];
    return html`<fieldset class="field-record" disabled=${disabled}><legend>${label}</legend>${entries.map(key => {
      const child = properties[key];
      const required = schema.required?.includes(key);
      const present = Object.hasOwn(object, key);
      return html`<div key=${key} class="field-record-member"><label>${key}${required ? ' *' : ''}</label>
        ${!required && html`<input type="checkbox" checked=${present} aria-label=${t('fields.include', { name: key })} onChange=${/** @param {InputChange} event */ event => { const next = { ...object }; if (event.currentTarget.checked) next[key] = initialValue(child); else delete next[key]; onChange(next); }} />`}
        ${(present || required) && (child ? html`<${SchemaWidget} schema=${child} value=${object[key] ?? initialValue(child)} label=${key} disabled=${disabled} t=${t} onChange=${/** @param {Json} next */ next => onChange({ ...object, [key]: next })} />` : html`<pre>${JSON.stringify(object[key], null, 2)}</pre>`)}
      </div>`;
    })}</fieldset>`;
  }
  if (schema.type === 'array') {
    const list = Array.isArray(value) ? value : [];
    /** @param {number} index @param {number} delta */
    function move(index, delta) { const next = [...list]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next); }
    return html`<fieldset class="field-list" disabled=${disabled}><legend>${label}</legend>${list.map((item, index) => html`<div key=${index} class="field-list-item">
      ${schema.items ? html`<${SchemaWidget} schema=${schema.items} value=${item} label=${`${label} ${index + 1}`} disabled=${disabled} t=${t} onChange=${/** @param {Json} next */ next => onChange(list.map((old, position) => index === position ? next : old))} />` : html`<pre>${JSON.stringify(item, null, 2)}</pre>`}
      <button type="button" disabled=${index === 0} aria-label=${t('fields.moveUp')} onClick=${() => move(index, -1)}>↑</button><button type="button" disabled=${index === list.length - 1} aria-label=${t('fields.moveDown')} onClick=${() => move(index, 1)}>↓</button>
      <button type="button" disabled=${list.length <= (schema.minItems ?? 0)} onClick=${() => onChange(list.filter((_, position) => position !== index))}>${t('fields.remove')}</button>
    </div>`)}<button type="button" disabled=${!schema.items || list.length >= (schema.maxItems ?? Infinity)} onClick=${() => onChange([...list, initialValue(schema.items)])}>${t('fields.add')}</button></fieldset>`;
  }
  if (schema.type === 'boolean') return html`<input type="checkbox" aria-label=${label} disabled=${disabled} checked=${value === true} onChange=${/** @param {InputChange} event */ event => onChange(event.currentTarget.checked)} />`;
  return html`<input type="text" inputMode=${schema.type === 'number' || schema.type === 'integer' ? 'decimal' : undefined} aria-label=${label} disabled=${disabled} value=${value ?? ''} onInput=${/** @param {InputChange} event */ event => onChange(event.currentTarget.value)} />`;
}

/** @param {{field:import('../companion.ts').StudioField,schema?:Schema,editorKey:string,revision:number,ready:boolean,api:typeof import('./api.js').api,t:(key:string,vars?:Record<string,string|number>)=>string}} props */
export function FieldEditor({ field, schema, editorKey, revision, ready, api, t }) {
  const canonical = schema ?? field.schema;
  const displayValue = () => field.widget === 'number' && typeof field.authorValue === 'number' ? String(field.authorValue * (field.displayScale ?? 1)) : field.authorValue;
  const [draft, setDraft] = useState(displayValue);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {FieldProblem|null} */ (null));
  const [baseRevision, setBaseRevision] = useState(revision);
  const currentDraft = useRef(draft); currentDraft.current = draft;
  const disabled = Boolean(!ready || busy || field.readonly || !field.endpointKey || field.binding?.access === 'read');
  const complex = field.widget === 'record' || field.widget === 'list';
  useEffect(() => { if (!dirty && !busy) { setDraft(displayValue()); setBaseRevision(revision); } }, [field.authorValue, revision]);
  /** @param {Json} value */
  function change(value) { currentDraft.current = value; setDraft(value); setDirty(true); setProblem(null); }
  function cancel() { setDraft(displayValue()); currentDraft.current = displayValue(); setDirty(false); setProblem(null); setBaseRevision(revision); }
  async function commit() {
    if (!dirty || disabled) return;
    let value;
    try { value = field.widget === 'number' ? parseNumberDraft(String(currentDraft.current), field) : completeDraft(currentDraft.current, canonical); }
    catch (failure) { setProblem({ key: failure instanceof Error ? failure.message : 'fields.type', path: '' }); return; }
    const error = validateFieldValue(value, canonical);
    if (error) { setProblem(error); return; }
    if (equalValue(value, field.authorValue)) { setDirty(false); setProblem(null); return; }
    setBusy(true); setProblem(null);
    try {
      await api.write('/__studio/fields', { expectedViewRevision: baseRevision, editorKey, fieldKey: field.fieldKey, value });
      setDirty(false);
    } catch (failure) { setProblem({ message: failure instanceof Error ? failure.message : String(failure) }); }
    finally { setBusy(false); }
  }
  const issueId = `field-${encodeURIComponent(field.ownerKey + ':' + field.fieldKey)}-error`;
  const inputProps = { disabled, 'aria-label': field.label, 'aria-describedby': problem ? issueId : undefined, 'aria-invalid': Boolean(problem), onInput: /** @param {TextChange} event */ event => change(event.currentTarget.value) };
  let widget;
  if (complex) widget = canonical ? html`<${SchemaWidget} schema=${canonical} value=${draft} onChange=${change} label=${field.label} disabled=${disabled} t=${t} />` : html`<pre>${JSON.stringify(field.authorValue, null, 2)}</pre>`;
  else if (field.widget === 'select') widget = html`<${SelectMenu} label=${field.label} options=${field.options ?? []} value=${draft} disabled=${disabled} onChange=${change} />`;
  else if (field.widget === 'boolean') widget = html`<input type="checkbox" ...${inputProps} checked=${draft === true} onInput=${/** @param {InputChange} event */ event => change(event.currentTarget.checked)} />`;
  else if (field.widget === 'color') widget = html`<div class="field-color"><input type="text" ...${inputProps} value=${draft ?? ''} /><input type="color" aria-label=${t('fields.colorPicker', { name: field.label })} disabled=${disabled} value=${/^#[0-9a-f]{6}$/i.test(String(draft)) ? draft : '#000000'} onInput=${/** @param {InputChange} event */ event => change(event.currentTarget.value)} /></div>`;
  else if (field.widget === 'text') widget = html`<textarea ...${inputProps} rows="2" value=${draft ?? ''} />`;
  else widget = html`<input type="text" inputMode="decimal" ...${inputProps} value=${draft ?? ''} />`;
  return html`<div class="studio-field" data-field-key=${field.fieldKey} onKeyDown=${/** @param {KeyboardEvent} event */ event => { event.stopPropagation(); const target = event.target; if (event.key === 'Escape') { event.preventDefault(); cancel(); } else if (event.key === 'Enter' && !event.isComposing && target instanceof HTMLElement && target.tagName !== 'TEXTAREA' && !target.closest('[role=menu]') && target.tagName !== 'BUTTON') { event.preventDefault(); commit(); } }}>
    <label>${field.label}${field.units?.length ? html`<small> ${field.units.join(' / ')}</small>` : ''}</label>${widget}
    ${field.widget === 'color' && (field.options?.length ?? 0) > 0 && html`<${SelectMenu} label=${t('fields.colorSuggestions', { name: field.label })} options=${field.options ?? []} value=${draft} disabled=${disabled} onChange=${change} />`}
    ${field.binding?.reference && html`<small>${t('fields.reference', { name: field.binding.reference })}</small>`}
    ${disabled && html`<small>${t('fields.readonly')}</small>`}
    ${dirty && html`<div class="field-actions"><button type="button" disabled=${disabled || (complex && !canonical)} onClick=${commit}>${t('fields.apply')}</button><button type="button" disabled=${busy} onClick=${cancel}>${t('fields.cancel')}</button></div>`}
    ${problem && html`<p id=${issueId} role="alert">${'message' in problem ? problem.message : t(problem.key, { path: problem.path })}</p>`}
  </div>`;
}
