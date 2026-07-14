import { messages } from '../i18n/index.js';

/**
 * Shared DOM chrome for the app's on-canvas panels — the scene routing error
 * ({@link import('./scene-overlay.js')}), the animation gallery panel
 * ({@link import('../entries/anim-overlay.js')}) and the main menu ({@link import('../entries/menu.js')}).
 * Plain DOM + floats, app-layer only (never in `sim`).
 */

/** The right-docked panel look (dark parchment card) every overlay shares. */
export const PANEL_STYLE = [
  'position:fixed',
  'top:12px',
  'right:12px',
  'width:320px',
  'box-sizing:border-box',
  'padding:12px 14px',
  'background:rgba(20,16,12,0.92)',
  'color:#e8dcc8',
  'font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #5a4a36',
  'border-radius:8px',
  'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
  'z-index:50',
].join(';');

/** The small parchment button look (playback / navigation buttons). */
export const BUTTON_STYLE = [
  'cursor:pointer',
  'background:#3a2f22',
  'color:#e8dcc8',
  'border:1px solid #6b5840',
  'border-radius:5px',
  'padding:4px 8px',
  'font:12px ui-monospace,monospace',
].join(';');

/** Create an element with an inline `cssText` style and optional text — the terse DOM builder the panels use. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A button that navigates the page (reloads with a new `?…` search string) — used by the gallery's
 * character/view selectors and the menu, where changing the selection means loading different atlases /
 * a different entry. `active` highlights the current choice.
 */
export function navButton(label: string, active: boolean, href: string): HTMLButtonElement {
  const b = el('button', BUTTON_STYLE, label);
  if (active) {
    b.style.background = '#6b5840';
    b.style.fontWeight = '700';
  }
  b.addEventListener('click', () => {
    window.location.search = href;
  });
  return b;
}

/** The minimal audio-driver shape {@link mountSoundToggle} needs (structural — no `@open-northland/audio` import). */
interface SoundToggleDriver {
  resume(): Promise<void>;
  readonly started: boolean;
  /** Mute/unmute the running engine (the button starts muted and flips this on click). */
  setEnabled(enabled: boolean): void;
}

/** The bottom-centre sound toggle button — a real click target (pointer-events on), so it must sit above panels. */
const SOUND_TOGGLE_STYLE = [
  'position:fixed',
  'left:50%',
  'bottom:24px',
  'transform:translateX(-50%)',
  'cursor:pointer',
  'padding:10px 18px',
  'background:rgba(20,16,12,0.92)',
  'color:#e8dcc8',
  'font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #8a6f4c',
  'border-radius:24px',
  'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  'z-index:200',
].join(';');

/**
 * Mount the bottom-centre sound toggle button. Audio starts muted (the driver is created with
 * `setEnabled(false)`); the game is silent until the user clicks this button. The click doubles as the
 * autoplay gesture — browsers keep an `AudioContext` suspended until a trusted user gesture, so the same
 * click that unmutes also `resume()`s the context. Clicking again re-mutes (the context stays running).
 */
export function mountSoundToggle(driver: SoundToggleDriver): void {
  const button = el('button', SOUND_TOGGLE_STYLE, messages().common.soundOff);
  document.body.append(button);
  let enabled = false;
  button.addEventListener('click', () => {
    const next = !enabled;
    // Resume before unmuting so the very first enable satisfies autoplay policy; harmless once running.
    void driver
      .resume()
      .then(() => {
        driver.setEnabled(next);
        enabled = next;
        button.textContent = next ? messages().common.soundOn : messages().common.soundOff;
      })
      .catch(() => undefined); // constructing/resuming the context can throw (e.g. a context-count cap) — stay silent, not crash
  });
}

/**
 * The full-page (scrollable) entry shell — the dark-parchment page behind the main menu and the sound
 * gallery. Each page passes only its own density knobs (top padding / body font / content width).
 */
export function pageRootStyle(paddingTopPx: number, fontPx: number): string {
  return [
    'position:fixed',
    'inset:0',
    'overflow-y:auto',
    'box-sizing:border-box',
    `padding:${paddingTopPx}px 20px 64px`,
    'background:radial-gradient(120% 80% at 50% 0%,#241b12 0%,#160f0a 70%)',
    'color:#e8dcc8',
    `font:${fontPx}px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace`,
    'z-index:100',
  ].join(';');
}

/** The centred content column of a full-page entry. */
export function pageInnerStyle(maxWidthPx: number): string {
  return `max-width:${maxWidthPx}px;margin:0 auto`;
}

/** The uppercase, underlined section heading of a full-page entry. */
export const PAGE_SECTION_TITLE_STYLE = [
  'font-weight:700',
  'font-size:14px',
  'letter-spacing:0.08em',
  'text-transform:uppercase',
  'opacity:0.7',
  'margin:28px 0 12px',
  'border-bottom:1px solid #5a4a36',
  'padding-bottom:6px',
].join(';');

/** A titled full-page section wrapping `children` (a card grid, a list of rows, …). */
export function pageSection(title: string, children: readonly HTMLElement[]): HTMLElement {
  const wrap = el('div', '');
  wrap.append(el('div', PAGE_SECTION_TITLE_STYLE, title));
  for (const c of children) wrap.append(c);
  return wrap;
}

/** Mount a small message panel (missing `content/`, an empty filter, …) instead of a blank canvas. */
export function mountMessage(title: string, detail: string): void {
  const panel = el('div', PANEL_STYLE);
  panel.append(
    el('div', 'font-weight:700;font-size:14px;margin-bottom:6px', title),
    el('div', 'opacity:0.85', detail),
  );
  document.body.append(panel);
}
