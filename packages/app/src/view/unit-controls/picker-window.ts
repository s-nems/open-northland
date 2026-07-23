import type { UiFont } from '../../content/ui-font.js';
import { el } from '../overlay.js';

/**
 * The shared centred pick-window chrome: a DOM window approximating the original's parchment/rope
 * selection windows (a deliberately lighter DOM take, not the true original-art details panel) - kept
 * DOM so a long list scrolls with no Pixi masking work. Palette matches the HUD's warm-wood windows
 * (hud/chrome.ts). A full-screen backdrop makes it modal (it eats canvas clicks; clicking it, or the ✕
 * box, dismisses). The profession picker and the equipment pick-menu both build on this.
 */

const WOOD_DARK = '#211812';
const WOOD = '#2c2015';
const WOOD_LIGHT = '#3a2c1b';
const ROPE = '#8a6f3f';
const ROPE_DARK = '#4a3a22';
const TEXT = '#e8dcc8';
const TEXT_DIM = '#b8a684';
const ROW_HILITE = '#5a4a30';
/** The bundled UI serif family (loaded at mount); this stack is the fallback until it resolves. */
const SERIF_FALLBACK = "'Times New Roman', Georgia, serif";

/** Full-screen click-catcher + subtle dim behind the window: a click off the window closes it (modal). */
const BACKDROP_STYLE = [
  'position:fixed',
  'inset:0',
  'background:rgba(0,0,0,0.35)',
  'z-index:80',
  'display:none',
].join(';');
/** The centred wood window: title bar + scrollable list, framed by a double rope-tan border. */
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
  // Double frame: a raised rope-tan ridge outside, a dark bevel line inside (the rope-and-knot look, flat).
  `border:2px solid ${ROPE}`,
  `box-shadow:inset 0 0 0 1px ${ROPE_DARK},inset 0 0 22px rgba(0,0,0,0.55),0 10px 30px rgba(0,0,0,0.6)`,
  'border-radius:4px',
  'z-index:81',
  'display:none',
  'overflow:hidden',
].join(';');
/** The engraved headline bar (the original's `bg_headline`): centred title + a close box on the right. */
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
/** The top-right close box (an X), the original window-close affordance. */
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
/** The scrollable list: caps its height so a long set scrolls instead of overflowing the screen. */
const LIST_STYLE = [
  'display:flex',
  'flex-direction:column',
  'gap:3px',
  'padding:8px',
  'max-height:52vh',
  'overflow-y:auto',
].join(';');
/** A category separator row (group headers) - small, dim, letter-spaced, with a hairline rule. */
const GROUP_STYLE = [
  'margin:6px 2px 1px',
  'padding-bottom:3px',
  'font-size:10px',
  'font-weight:700',
  'letter-spacing:0.14em',
  'text-transform:uppercase',
  `color:${TEXT_DIM}`,
  `border-bottom:1px solid ${ROPE_DARK}`,
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
/** A non-clickable info line (the equip menu's "nothing available" state). */
const NOTE_STYLE = ['padding:6px 11px', 'font-size:13px', `color:${TEXT_DIM}`, 'text-align:center'].join(';');
const ROW_HOVER = `linear-gradient(${ROW_HILITE},${WOOD_LIGHT})`;
const ROW_BG = `linear-gradient(${WOOD_LIGHT},${WOOD})`;
/** One-shot stylesheet id for the list's scrollbar skin (rules that inline cssText can't express). */
const STYLE_ID = 'opennorthland-picker-style';
const LIST_CLASS = 'opennorthland-picker-list';

/**
 * Inject the list's scrollbar skin once (a wood track + rope-tan thumb, matching the window), guarded
 * by {@link STYLE_ID} so remounts don't stack duplicate sheets. Scrollbar pseudo-elements can't be set
 * through inline `style`, so this is the one rule set that needs a real stylesheet.
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
  /** Empty the list body (a dynamic picker rebuilds its rows per open). */
  clearList(): void;
  /** Append a dim group-separator header. */
  addGroup(label: string): void;
  /** Append a clickable row; hovering brightens it, clicking fires `onPick`. */
  addRow(label: string, onPick: () => void): void;
  /** Append a dim non-clickable info line. */
  addNote(label: string): void;
  show(): void;
  hide(): void;
  isOpen(): boolean;
  /** Remove the backdrop + window from the DOM. */
  dispose(): void;
}

/**
 * Build one centred pick window (appended to `document.body` hidden) and return its handle. The ✕ box
 * and a backdrop click fire `onDismiss` - the owner decides whether that hides the window.
 */
export function createPickerWindow(opts: {
  readonly uiFont: UiFont;
  readonly title: string;
  readonly onDismiss: () => void;
}): PickerWindow {
  const fontFamily = `${opts.uiFont.family}, ${SERIF_FALLBACK}`;
  installPickerScrollbarStyle();

  const backdrop = el('div', BACKDROP_STYLE);
  const window_ = el('div', WINDOW_STYLE);
  window_.style.fontFamily = fontFamily;

  const header = el('div', HEADER_STYLE);
  const title = el('div', TITLE_STYLE, opts.title);
  header.append(title);
  const close = el('div', CLOSE_STYLE, '✕');
  close.addEventListener('click', () => opts.onDismiss());
  header.append(close);
  window_.append(header);

  const list = el('div', LIST_STYLE);
  list.className = LIST_CLASS;
  window_.append(list);
  document.body.append(backdrop, window_);

  // A click on the backdrop (anywhere off the window) dismisses it - the standard modal behaviour.
  backdrop.addEventListener('mousedown', () => opts.onDismiss());

  let open = false;
  return {
    setTitle: (text): void => {
      title.textContent = text;
    },
    clearList: (): void => {
      list.replaceChildren();
    },
    addGroup: (label): void => {
      list.append(el('div', GROUP_STYLE, label));
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
      row.addEventListener('click', onPick);
      list.append(row);
    },
    addNote: (label): void => {
      list.append(el('div', NOTE_STYLE, label));
    },
    show: (): void => {
      open = true;
      backdrop.style.display = 'block';
      window_.style.display = 'block';
    },
    hide: (): void => {
      open = false;
      backdrop.style.display = 'none';
      window_.style.display = 'none';
    },
    isOpen: (): boolean => open,
    dispose: (): void => {
      window_.remove();
      backdrop.remove();
    },
  };
}
