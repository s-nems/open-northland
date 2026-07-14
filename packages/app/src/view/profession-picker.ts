import type { PickerEntry } from '../catalog/professions.js';
import type { UiFont } from '../content/ui-font.js';
import { uiLabel } from '../i18n/index.js';
import { el } from './overlay.js';

/**
 * The "Zmiana zawodu" profession picker: a DOM window approximating the original's parchment/rope
 * selection windows (a deliberately lighter DOM take, not the true original-art details panel) — kept DOM
 * so the long profession set scrolls with no Pixi masking work. Palette matches the HUD's warm-wood
 * windows (hud/chrome.ts).
 *
 * It is the window half of the settler action menu ({@link import('./settler-actions.js')}): that module
 * owns the ring + the `closed`/`menu`/`jobs` mode machine and drives {@link ProfessionPicker.show}/`hide`;
 * this module owns the DOM and turns a row click into {@link ProfessionPickerOptions.onPick} and the ✕
 * box / backdrop click into {@link ProfessionPickerOptions.onDismiss}.
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
const JOB_BACKDROP_STYLE = [
  'position:fixed',
  'inset:0',
  'background:rgba(0,0,0,0.35)',
  'z-index:80',
  'display:none',
].join(';');
/** The centred wood window: title bar + scrollable profession list, framed by a double rope-tan border. */
const JOB_WINDOW_STYLE = [
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
const JOB_HEADER_STYLE = [
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'position:relative',
  'padding:7px 30px',
  `background:linear-gradient(${WOOD_DARK},${WOOD})`,
  `border-bottom:1px solid ${ROPE_DARK}`,
  'box-shadow:inset 0 -1px 0 rgba(0,0,0,0.4)',
].join(';');
const JOB_TITLE_STYLE = [
  'font-weight:700',
  'font-size:15px',
  'letter-spacing:0.06em',
  `color:${TEXT}`,
  'text-shadow:0 1px 2px rgba(0,0,0,0.7)',
].join(';');
/** The top-right close box (an X), the original window-close affordance. */
const JOB_CLOSE_STYLE = [
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
/** The scrollable list: caps its height so a long profession set scrolls instead of overflowing the screen. */
const JOB_LIST_STYLE = [
  'display:flex',
  'flex-direction:column',
  'gap:3px',
  'padding:8px',
  'max-height:52vh',
  'overflow-y:auto',
].join(';');
/** A category separator row (the picker's group headers) — small, dim, letter-spaced, with a hairline rule. */
const JOB_GROUP_STYLE = [
  'margin:6px 2px 1px',
  'padding-bottom:3px',
  'font-size:10px',
  'font-weight:700',
  'letter-spacing:0.14em',
  'text-transform:uppercase',
  `color:${TEXT_DIM}`,
  `border-bottom:1px solid ${ROPE_DARK}`,
].join(';');
const JOB_ROW_STYLE = [
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
const JOB_ROW_HOVER = `linear-gradient(${ROW_HILITE},${WOOD_LIGHT})`;
const JOB_ROW_BG = `linear-gradient(${WOOD_LIGHT},${WOOD})`;
/** One-shot stylesheet id for the picker's scrollbar skin (rules that inline cssText can't express). */
const JOB_STYLE_ID = 'opennorthland-job-picker-style';

/**
 * Inject the profession list's scrollbar skin once (a wood track + rope-tan thumb, matching the window),
 * guarded by {@link JOB_STYLE_ID} so remounts don't stack duplicate sheets. Scrollbar pseudo-elements can't
 * be set through inline `style`, so this is the one rule set that needs a real stylesheet.
 */
function installJobPickerScrollbarStyle(): void {
  if (document.getElementById(JOB_STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = JOB_STYLE_ID;
  style.textContent = `
.opennorthland-job-list{scrollbar-width:thin;scrollbar-color:${ROPE_DARK} ${WOOD_DARK};}
.opennorthland-job-list::-webkit-scrollbar{width:10px;}
.opennorthland-job-list::-webkit-scrollbar-track{background:${WOOD_DARK};}
.opennorthland-job-list::-webkit-scrollbar-thumb{background:${ROPE_DARK};border-radius:5px;border:2px solid ${WOOD_DARK};}
.opennorthland-job-list::-webkit-scrollbar-thumb:hover{background:${ROPE};}`;
  document.head.append(style);
}

export interface ProfessionPickerOptions {
  /** The grouped profession menu the picker offers (group headers + one-click profession rows). */
  readonly professions: readonly PickerEntry[];
  /** The bundled serif UI face (shared with the details panel); the picker composes it over its fallback. */
  readonly uiFont: UiFont;
  /** A profession row was clicked — the caller issues the `setJob` command and closes the menu. */
  readonly onPick: (jobType: number) => void;
  /** The window was dismissed without a pick (the ✕ box or a backdrop click). */
  readonly onDismiss: () => void;
}

export interface ProfessionPicker {
  /** Reveal the backdrop + window (the caller has already switched the menu to its `jobs` mode). */
  show(): void;
  /** Hide the backdrop + window. */
  hide(): void;
  /** Remove the backdrop + window from the DOM. */
  dispose(): void;
}

/**
 * Build the profession-picker window (once, from the grouped menu) and return its show/hide/dispose handle.
 * The window is appended to `document.body` hidden; the caller drives it in step with the action-menu mode.
 */
export function createProfessionPicker(opts: ProfessionPickerOptions): ProfessionPicker {
  const fontFamily = `${opts.uiFont.family}, ${SERIF_FALLBACK}`;
  installJobPickerScrollbarStyle();

  const jobBackdrop = el('div', JOB_BACKDROP_STYLE);
  const jobWindow = el('div', JOB_WINDOW_STYLE);
  jobWindow.style.fontFamily = fontFamily;

  const jobHeader = el('div', JOB_HEADER_STYLE);
  jobHeader.append(el('div', JOB_TITLE_STYLE, uiLabel('changeProfession')));
  const jobClose = el('div', JOB_CLOSE_STYLE, '✕'); // ✕
  jobClose.addEventListener('click', () => opts.onDismiss());
  jobHeader.append(jobClose);
  jobWindow.append(jobHeader);

  const jobList = el('div', JOB_LIST_STYLE);
  jobList.className = 'opennorthland-job-list';
  // Render the grouped menu top to bottom: a dim separator per category, then its clickable profession rows.
  for (const entry of opts.professions) {
    if (entry.kind === 'header') {
      jobList.append(el('div', JOB_GROUP_STYLE, entry.label));
      continue;
    }
    const row = el('button', JOB_ROW_STYLE, entry.label);
    row.style.fontFamily = fontFamily;
    row.addEventListener('mouseenter', () => {
      row.style.background = JOB_ROW_HOVER;
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = JOB_ROW_BG;
    });
    row.addEventListener('click', () => opts.onPick(entry.jobType));
    jobList.append(row);
  }
  jobWindow.append(jobList);
  document.body.append(jobBackdrop, jobWindow);

  // A click on the backdrop (anywhere off the window) dismisses it — the standard modal behaviour.
  jobBackdrop.addEventListener('mousedown', () => opts.onDismiss());

  return {
    show: (): void => {
      jobBackdrop.style.display = 'block';
      jobWindow.style.display = 'block';
    },
    hide: (): void => {
      jobBackdrop.style.display = 'none';
      jobWindow.style.display = 'none';
    },
    dispose: (): void => {
      jobWindow.remove();
      jobBackdrop.remove();
    },
  };
}
