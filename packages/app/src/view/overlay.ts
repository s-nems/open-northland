/**
 * Shared DOM chrome for the app's on-canvas panels — the scene acceptance overlay
 * ({@link import('./scene-overlay.js')}), the animation gallery panel
 * ({@link import('../entries/anim-overlay.js')}) and the main menu ({@link import('../entries/menu.js')}).
 * Plain DOM + floats, app-layer only (never in `sim`). Kept in ONE place so the panels can't drift in
 * look and an agent has an obvious home for panel helpers instead of re-declaring `el`/`navButton`/the
 * style strings per file.
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
 * A button that NAVIGATES the page (reloads with a new `?…` search string) — used by the gallery's
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

/**
 * The shared "you've reviewed it? tell the chat" footer both acceptance panels (scene + animation
 * gallery) end with — only the sentence differs (`text`). Keeps the border/opacity styling in one place.
 */
export function signOffFooter(text: string): HTMLElement {
  return el('div', 'opacity:0.65;font-size:12px;border-top:1px solid #5a4a36;padding-top:6px', text);
}

/** The minimal audio-driver shape {@link enableAudioOnGesture} needs (structural — no `@vinland/audio` import). */
interface Resumable {
  resume(): Promise<void>;
  readonly started: boolean;
}

/** The bottom-centre "click to enable sound" pill — high z-index, click-through so it never eats the gesture. */
const AUDIO_PROMPT_STYLE = [
  'position:fixed',
  'left:50%',
  'bottom:24px',
  'transform:translateX(-50%)',
  'pointer-events:none', // the window gesture listener catches the click anywhere — the pill must not block it
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
 * Mount a persistent "🔊 click to enable sound" affordance and resume `driver` on the first gesture that
 * actually starts the audio context. Browsers keep an `AudioContext` suspended until a user gesture; the
 * pill (and its listeners) stay until the context is **confirmed running** (`driver.started`), so a gesture
 * missed while the scene was still loading — or a user who simply hasn't clicked yet — can't leave the view
 * silently muted (the bug where a self-removing, load-gated listener dropped the only click). No-op when the
 * context is already running (e.g. a browser that auto-allows audio). Returns nothing; cleans itself up.
 */
export function enableAudioOnGesture(driver: Resumable): void {
  if (driver.started) return;
  const pill = el('div', AUDIO_PROMPT_STYLE, '🔊 Kliknij w okno, aby włączyć dźwięk');
  document.body.append(pill);
  const onGesture = (): void => {
    void driver
      .resume()
      .then(() => {
        if (!driver.started) return; // resume refused (not a trusted gesture yet) — keep the pill + listeners
        pill.remove();
        window.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('keydown', onGesture);
      })
      .catch(() => undefined); // constructing/resuming the context can throw (e.g. a context-count cap) — stay silent, not crash
  };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
}

/**
 * The full-page (scrollable) entry shell — the dark-parchment page behind the main menu and the sound
 * gallery. Shared here so the full-page entries can't drift in look; each page passes only its own
 * density knobs (top padding / body font / content width).
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
