import { el } from '../overlay.js';

export const PANEL_WIDTH_PX = 300;
/** Half the toggle chip's ~140px width. */
const TOGGLE_CHIP_HALF_WIDTH_PX = 70;

/** How far the panel's top edge sits below the chip's: just clear of the ~35 px chip. */
export const PANEL_BELOW_CHIP_PX = 36;

export const TOGGLE_STYLE = [
  'position:fixed',
  // Centres the chip over the rail below it (rail: right:8px, width PANEL_WIDTH_PX).
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

export const ADMIN_PANEL_STYLE = [
  'position:fixed',
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

export const HEADER_STYLE = 'padding:10px 12px 8px;border-bottom:1px solid #5a4a36';
export const BODY_STYLE = 'flex:1;min-height:0;overflow-y:auto;padding:0 12px';
export const FOOTER_STYLE = 'padding:8px 12px;border-top:1px solid #5a4a36;min-height:16px';

export const SECTION_TITLE_STYLE =
  'font-weight:700;font-size:10px;letter-spacing:0.07em;text-transform:uppercase;opacity:0.6;margin:0 0 6px';
export const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:4px';

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

export interface LabelledButton {
  readonly button: HTMLButtonElement;
  readonly label: string;
}

export function setButtonActive(button: HTMLButtonElement, active: boolean): void {
  button.style.background = active ? '#6b5840' : '#3a2f22';
  button.style.fontWeight = active ? '700' : '400';
  button.style.outline = active ? '1px solid #d8ccb0' : 'none';
}

/** Returns the wrapper to append and the `content` element the section's own rows go into. */
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

export function rowOf(entries: readonly LabelledButton[]): HTMLElement {
  const row = el('div', ROW_STYLE);
  for (const { button } of entries) row.append(button);
  return row;
}

/** Case-insensitive: shows and hides the given buttons in place. */
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

/** Reports a blank or unparsable value as 0. */
export function numberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = el('label', 'display:flex;gap:5px;align-items:center');
  wrap.append(el('span', 'opacity:0.8', label));
  const input = el('input', `width:64px;${FIELD_INPUT_STYLE}`);
  input.type = 'number';
  input.min = '0';
  input.value = String(value);
  // A spawn press `preventDefault()`s the click and so suppresses blur; a `change` commit would never
  // reach that click.
  input.addEventListener('input', () => {
    const v = Number.parseInt(input.value, 10);
    onChange(Number.isFinite(v) && v > 0 ? v : 0);
  });
  wrap.append(input);
  return wrap;
}

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
