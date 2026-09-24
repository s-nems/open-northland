import type { UiCue } from '@open-northland/audio';
import type { UiFont } from '../../content/ui-font.js';
import { el } from '../overlay.js';

/**
 * An approximation of the original's parchment/rope selection windows, kept in DOM so a long list
 * scrolls with no Pixi masking work.
 */

const WOOD_DARK = '#211812';
const WOOD = '#2c2015';
const WOOD_LIGHT = '#3a2c1b';
const ROPE = '#8a6f3f';
const ROPE_DARK = '#4a3a22';
const TEXT = '#e8dcc8';
const TEXT_DIM = '#b8a684';
const ROW_HILITE = '#5a4a30';
/** The stack used until the bundled UI serif, loaded at mount, resolves. */
const SERIF_FALLBACK = "'Times New Roman', Georgia, serif";

const BACKDROP_STYLE = [
  'position:fixed',
  'inset:0',
  'background:rgba(0,0,0,0.35)',
  'z-index:80',
  'display:none',
].join(';');
const WINDOW_STYLE = [
  'position:fixed',
  'top:50%',
  'left:50%',
  'transform:translate(-50%,-50%)',
  'min-width:210px',
  'max-width:280px',
  'box-sizing:border-box',
  `background:linear-gradient(${WOOD_LIGHT},${WOOD} 55%,${WOOD_DARK})`,
  `color:${TEXT}`,
  `border:2px solid ${ROPE}`,
  `box-shadow:inset 0 0 0 1px ${ROPE_DARK},inset 0 0 22px rgba(0,0,0,0.55),0 10px 30px rgba(0,0,0,0.6)`,
  'border-radius:4px',
  'z-index:81',
  'display:none',
  'overflow:hidden',
].join(';');
/** Approximates the original's `bg_headline` bar. */
const HEADER_STYLE = [
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'position:relative',
  'padding:7px 30px',
  `background:linear-gradient(${WOOD_DARK},${WOOD})`,
  `border-bottom:1px solid ${ROPE_DARK}`,
  'box-shadow:inset 0 -1px 0 rgba(0,0,0,0.4)',
].join(';');
const TITLE_STYLE = [
  'font-weight:700',
  'font-size:15px',
  'letter-spacing:0.06em',
  `color:${TEXT}`,
  'text-shadow:0 1px 2px rgba(0,0,0,0.7)',
].join(';');
const CLOSE_STYLE = [
  'position:absolute',
  'top:50%',
  'right:8px',
  'transform:translateY(-50%)',
  'width:18px',
  'height:18px',
  'line-height:16px',
  'text-align:center',
  'cursor:pointer',
  'font-size:14px',
  `color:${TEXT_DIM}`,
  `background:${WOOD_DARK}`,
  `border:1px solid ${ROPE_DARK}`,
  'border-radius:3px',
].join(';');
const LIST_STYLE = [
  'display:flex',
  'flex-direction:column',
  'gap:3px',
  'padding:8px',
  'max-height:52vh',
  'overflow-y:auto',
].join(';');
const ROW_STYLE = [
  'cursor:pointer',
  'text-align:left',
  `background:linear-gradient(${WOOD_LIGHT},${WOOD})`,
  `color:${TEXT}`,
  `border:1px solid ${ROPE_DARK}`,
  'border-radius:3px',
  'padding:6px 11px',
  'font-size:13.5px',
  'box-shadow:inset 0 1px 0 rgba(255,240,210,0.06)',
].join(';');
const NOTE_STYLE = ['padding:6px 11px', 'font-size:13px', `color:${TEXT_DIM}`, 'text-align:center'].join(';');
const ROW_HOVER = `linear-gradient(${ROW_HILITE},${WOOD_LIGHT})`;
const ROW_BG = `linear-gradient(${WOOD_LIGHT},${WOOD})`;
const STYLE_ID = 'opennorthland-picker-style';
const LIST_CLASS = 'opennorthland-picker-list';

/**
 * Scrollbar pseudo-elements cannot be set through inline `style`, so this is the one rule set that
 * needs a real stylesheet; the id guard keeps remounts from stacking duplicate sheets.
 */
function installPickerScrollbarStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.${LIST_CLASS}{scrollbar-width:thin;scrollbar-color:${ROPE_DARK} ${WOOD_DARK};}
.${LIST_CLASS}::-webkit-scrollbar{width:10px;}
.${LIST_CLASS}::-webkit-scrollbar-track{background:${WOOD_DARK};}
.${LIST_CLASS}::-webkit-scrollbar-thumb{background:${ROPE_DARK};border-radius:5px;border:2px solid ${WOOD_DARK};}
.${LIST_CLASS}::-webkit-scrollbar-thumb:hover{background:${ROPE};}`;
  document.head.append(style);
}

export interface PickerWindow {
  setTitle(text: string): void;
  clearList(): void;
  addRow(label: string, onPick: () => void): void;
  addNote(label: string): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** The ✕ box and a backdrop click fire `onDismiss`; the owner decides whether that hides the window.
 *  The ✕ box and every enabled row confirm through `cue`; the backdrop is no button. */
export function createPickerWindow(opts: {
  readonly uiFont: UiFont;
  readonly onDismiss: () => void;
  readonly cue?: (cue: UiCue) => void;
}): PickerWindow {
  const fontFamily = `${opts.uiFont.family}, ${SERIF_FALLBACK}`;
  installPickerScrollbarStyle();

  const backdrop = el('div', BACKDROP_STYLE);
  const window_ = el('div', WINDOW_STYLE);
  window_.style.fontFamily = fontFamily;

  const header = el('div', HEADER_STYLE);
  const title = el('div', TITLE_STYLE);
  header.append(title);
  const close = el('div', CLOSE_STYLE, '✕');
  close.addEventListener('click', () => {
    opts.cue?.('confirm');
    opts.onDismiss();
  });
  header.append(close);
  window_.append(header);

  const list = el('div', LIST_STYLE);
  list.className = LIST_CLASS;
  window_.append(list);
  document.body.append(backdrop, window_);

  backdrop.addEventListener('mousedown', () => opts.onDismiss());

  return {
    setTitle: (text): void => {
      title.textContent = text;
    },
    clearList: (): void => {
      list.replaceChildren();
    },
    addRow: (label, onPick): void => {
      const row = el('button', ROW_STYLE, label);
      row.style.fontFamily = fontFamily;
      row.addEventListener('mouseenter', () => {
        row.style.background = ROW_HOVER;
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = ROW_BG;
      });
      row.addEventListener('click', () => {
        opts.cue?.('confirm');
        onPick();
      });
      list.append(row);
    },
    addNote: (label): void => {
      list.append(el('div', NOTE_STYLE, label));
    },
    show: (): void => {
      backdrop.style.display = 'block';
      window_.style.display = 'block';
    },
    hide: (): void => {
      backdrop.style.display = 'none';
      window_.style.display = 'none';
    },
    dispose: (): void => {
      window_.remove();
      backdrop.remove();
    },
  };
}
