import { el } from '../overlay.js';

/**
 * The admin/debug panel's shared DOM CHROME — the right-rail style vocabulary plus the small builders the
 * panel assembles itself from (collapsible sections, button rows, a name filter, the labelled number/
 * select fields). Kept apart from the panel wiring ({@link import('./index.js')}) and the spawn/action
 * data catalogs so "how the panel looks" has one home and the wiring reads as layout, not CSS strings.
 * Plain DOM + inline styles, app-layer only (never in `sim`).
 */

/** The rail width — narrow enough to leave the map readable beside it. */
export const PANEL_WIDTH_PX = 300;
/** Half the toggle chip's ~140px width — so the chip centres over the rail that opens below it. */
const TOGGLE_CHIP_HALF_WIDTH_PX = 70;

export const TOGGLE_STYLE = [
  'position:fixed',
  'top:8px',
  // Centred over the rail that opens below it (rail: right:8px, width PANEL_WIDTH_PX).
  `right:${8 + PANEL_WIDTH_PX / 2 - TOGGLE_CHIP_HALF_WIDTH_PX}px`,
  'cursor:pointer',
  'padding:6px 14px',
  'background:rgba(20,16,12,0.92)',
  'color:#e8dcc8',
  'font:13px ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #8a6f4c',
  'border-radius:6px',
  'box-shadow:0 4px 16px rgba(0,0,0,0.45)',
  'z-index:160',
].join(';');

// A right-docked, full-height flex column: header + settings stay put while only the body scrolls.
export const ADMIN_PANEL_STYLE = [
  'position:fixed',
  'top:44px',
  'right:8px',
  'bottom:8px',
  `width:${PANEL_WIDTH_PX}px`,
  'display:flex',
  'flex-direction:column',
  'box-sizing:border-box',
  'background:rgba(20,16,12,0.95)',
  'color:#e8dcc8',
  'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #6b5840',
  'border-radius:8px',
  'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  'z-index:150',
].join(';');

/** The static (non-scrolling) header + settings block. */
export const HEADER_STYLE = 'padding:10px 12px 8px;border-bottom:1px solid #5a4a36';
/** The scrolling palette body — the only part that grows/scrolls. */
export const BODY_STYLE = 'flex:1;min-height:0;overflow-y:auto;padding:0 12px';
/** The pinned status footer. */
export const FOOTER_STYLE = 'padding:8px 12px;border-top:1px solid #5a4a36;min-height:16px';

export const SECTION_TITLE_STYLE =
  'font-weight:700;font-size:10px;letter-spacing:0.07em;text-transform:uppercase;opacity:0.6;margin:0 0 6px';
export const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:4px';

/** A collapsible-section header (the clickable "▸ Title (n)" bar). */
const SECTION_HEADER_STYLE = [
  'display:flex',
  'align-items:center',
  'gap:6px',
  'width:100%',
  'cursor:pointer',
  'background:none',
  'border:none',
  'border-top:1px solid #5a4a36',
  'color:#e8dcc8',
  'padding:9px 2px',
  'margin:0',
  'text-align:left',
  'font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
  'letter-spacing:0.07em',
  'text-transform:uppercase',
].join(';');

const FILTER_STYLE =
  'width:100%;box-sizing:border-box;margin-bottom:6px;background:#2a2118;color:#e8dcc8;border:1px solid #6b5840;border-radius:4px;padding:3px 6px;font:12px ui-monospace,monospace';

const FIELD_INPUT_STYLE =
  'background:#2a2118;color:#e8dcc8;border:1px solid #6b5840;border-radius:4px;padding:2px 4px;font:12px ui-monospace,monospace';

/** One built button with its display label (kept so a filter can show/hide it by name). */
export interface LabelledButton {
  readonly button: HTMLButtonElement;
  readonly label: string;
}

/** Style a spawn/action button to reflect whether it is the armed choice (brighter than resting). */
export function setButtonActive(button: HTMLButtonElement, active: boolean): void {
  button.style.background = active ? '#6b5840' : '#3a2f22';
  button.style.fontWeight = active ? '700' : '400';
  button.style.outline = active ? '1px solid #d8ccb0' : 'none';
}

/**
 * A collapsible section: a clickable "▸/▾ Title (count)" header over a hideable content box. Returns the
 * wrapper (append to the body) and the `content` element (append the section's rows to it). Only the
 * section a human is actually using need be open, so the rail stays short instead of one long wall.
 */
export function collapsibleSection(
  title: string,
  count: number,
  startOpen: boolean,
): { readonly wrap: HTMLElement; readonly content: HTMLElement } {
  const wrap = el('div', '');
  const header = el('button', SECTION_HEADER_STYLE);
  const caret = el('span', 'opacity:0.7;width:10px;display:inline-block', startOpen ? '▾' : '▸');
  header.append(caret, el('span', 'flex:1', title), el('span', 'opacity:0.5;font-weight:400', String(count)));
  const content = el('div', `padding-bottom:8px;${startOpen ? '' : 'display:none'}`);
  let open = startOpen;
  header.addEventListener('click', () => {
    open = !open;
    content.style.display = open ? 'block' : 'none';
    caret.textContent = open ? '▾' : '▸';
  });
  wrap.append(header, content);
  return { wrap, content };
}

/** Wrap already-built buttons in a flex-wrap row. */
export function rowOf(entries: readonly LabelledButton[]): HTMLElement {
  const row = el('div', ROW_STYLE);
  for (const { button } of entries) row.append(button);
  return row;
}

/** A case-insensitive name filter that shows/hides the given buttons in place (a `type=search` input). */
export function filterInput(entries: readonly LabelledButton[], placeholder: string): HTMLElement {
  const input = el('input', FILTER_STYLE);
  input.type = 'search';
  input.placeholder = placeholder;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    for (const { button, label } of entries)
      button.style.display = q === '' || label.toLowerCase().includes(q) ? '' : 'none';
  });
  return input;
}

/** A small "label: [number input]" field that reports parsed changes (blank/NaN → 0). */
export function numberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = el('label', 'display:flex;gap:5px;align-items:center');
  wrap.append(el('span', 'opacity:0.8', label));
  const input = el('input', `width:64px;${FIELD_INPUT_STYLE}`);
  input.type = 'number';
  input.min = '0';
  input.value = String(value);
  // Commit on `input` (every keystroke), NOT `change` (blur): a spawn press `preventDefault()`s the
  // click, which suppresses the field's blur, so a `change`-committed value would never reach a click.
  input.addEventListener('input', () => {
    const v = Number.parseInt(input.value, 10);
    onChange(Number.isFinite(v) && v > 0 ? v : 0);
  });
  wrap.append(input);
  return wrap;
}

/** A small "label: [select]" field over integer-valued options. */
export function selectField(
  label: string,
  options: readonly { value: number; label: string }[],
  value: number,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = el('label', 'display:flex;gap:5px;align-items:center');
  wrap.append(el('span', 'opacity:0.8', label));
  const select = el('select', FIELD_INPUT_STYLE);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => onChange(Number.parseInt(select.value, 10) || 0));
  wrap.append(select);
  return wrap;
}
