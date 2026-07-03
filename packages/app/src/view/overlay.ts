/**
 * Shared DOM chrome for the app's on-canvas panels — the scene acceptance overlay
 * ({@link import('./scene-overlay.js')}), the animation gallery panel
 * ({@link import('../entries/anim-overlay.js')}) and the main menu ({@link import('../entries/menu.js')}).
 * Plain DOM + floats, app-layer only (never in `sim`). Kept in ONE place so the panels can't drift in
 * look and an agent has an obvious home for panel helpers instead of re-declaring `el`/`button`/the
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

/** A parchment button wired to `onClick`. */
export function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', BUTTON_STYLE, label);
  b.addEventListener('click', onClick);
  return b;
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
    void driver.resume().then(() => {
      if (!driver.started) return; // resume refused (not a trusted gesture yet) — keep the pill + listeners
      pill.remove();
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    });
  };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
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
