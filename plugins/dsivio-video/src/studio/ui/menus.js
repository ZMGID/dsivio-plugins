import { h } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

/** @typedef {{key:string, label:string, disabled?:boolean, selected?:boolean, action:()=>void}} MenuItem */
/** Keyboard menu used by timeline hit lists and scalar option fields.
 * @param {{items:readonly MenuItem[],label:string,onClose:()=>void,position?:{x:number,y:number},returnFocus?:HTMLElement|null}} props
 */
export function Menu({ items, label, onClose, position, returnFocus }) {
  const root = useRef(/** @type {HTMLDivElement|null} */ (null));
  const search = useRef({ text: '', at: 0 });
  useLayoutEffect(() => {
    const element = root.current;
    const first = element?.querySelector('button:not(:disabled)');
    if (first instanceof HTMLElement) first.focus();
    if (element && position) {
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(0, Math.min(position.x, innerWidth - bounds.width))}px`;
      element.style.top = `${Math.max(0, Math.min(position.y, innerHeight - bounds.height))}px`;
    }
    /** @param {PointerEvent} event */
    const outside = (event) => { if (element && event.target instanceof Node && !element.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); returnFocus?.focus(); };
  }, []);
  /** @param {KeyboardEvent} event */
  function navigate(event) {
    const buttons = /** @type {HTMLButtonElement[]} */ (Array.from(root.current?.querySelectorAll('button:not(:disabled)') ?? []));
    const current = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    let index = current;
    if (event.key === 'Escape' || event.key === 'Tab') { event.stopPropagation(); onClose(); if (event.key === 'Escape') event.preventDefault(); return; }
    if (event.key === 'ArrowDown') index = (current + 1) % buttons.length;
    else if (event.key === 'ArrowUp') index = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.key !== ' ') {
      const now = performance.now();
      search.current.text = (now - search.current.at > 700 ? '' : search.current.text) + event.key.toLocaleLowerCase();
      search.current.at = now;
      for (let offset = 1; offset <= buttons.length; offset++) {
        const candidate = (current + offset) % buttons.length;
        if (buttons[candidate]?.textContent?.toLocaleLowerCase().startsWith(search.current.text)) { index = candidate; break; }
      }
    } else return;
    event.preventDefault(); event.stopPropagation(); buttons[index]?.focus();
  }
  return html`<div ref=${root} class="studio-menu menu-options" role="menu" aria-label=${label} onKeyDown=${navigate}
    style=${{ ...(position ? { position: 'fixed', left: `${position.x}px`, top: `${position.y}px` } : { position: 'absolute' }), zIndex: 1000, background: 'var(--panel)', border: '1px solid var(--border)', padding: '4px', maxHeight: 'min(400px, 80vh)', maxWidth: 'min(640px, calc(100vw - 16px))', overflowWrap: 'anywhere', overflow: 'auto' }}>
    ${items.map(item => html`<button key=${item.key} type="button" role=${item.selected === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked=${item.selected} disabled=${item.disabled} tabIndex="-1" onClick=${() => { item.action(); onClose(); }}>${item.label}</button>`)}
  </div>`;
}

/** Custom select preserves option values independently of their labels.
 * @param {{options:readonly import('../companion.ts').FieldOption[],value:import('../../core/value.ts').Json,onChange:(value:import('../../core/value.ts').Json)=>void,label:string,disabled?:boolean}} props
 */
export function SelectMenu({ options, value, onChange, label, disabled }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const selected = options.find(option => equalValue(option.value, value));
  const bounds = open ? trigger.current?.getBoundingClientRect() : undefined;
  return html`<div class="studio-select" style=${{ position: 'relative' }}>
    <button ref=${trigger} type="button" aria-label=${label} aria-haspopup="menu" aria-expanded=${open} disabled=${disabled} title=${selected?.label} style=${{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      onClick=${() => setOpen(!open)} onKeyDown=${/** @param {KeyboardEvent} event */ event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>${selected?.label ?? String(value ?? '')}</button>
    ${open && html`<${Menu} label=${label} position=${bounds ? { x: bounds.left, y: bounds.bottom } : undefined} returnFocus=${trigger.current} onClose=${() => setOpen(false)} items=${options.map((option, index) => ({ key: String(index), label: option.label, selected: equalValue(option.value, value), action: () => onChange(option.value) }))} />`}
  </div>`;
}

/** Structural scalar/record equality, independent of property insertion order.
 * @param {unknown} left @param {unknown} right @returns {boolean}
 */
export function equalValue(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  const a = /** @type {Record<string,unknown>} */ (left), b = /** @type {Record<string,unknown>} */ (right);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalValue(a[key], b[key]));
}
