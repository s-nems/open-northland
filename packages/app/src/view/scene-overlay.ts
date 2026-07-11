import type { SceneDefinition } from '../scenes/index.js';
import { el, PANEL_STYLE, signOffFooter } from './overlay.js';

/**
 * The on-canvas acceptance overlay — the "czy jest OK?" panel a human reads while watching a scene: the
 * scene's title/summary, its checklist of what-to-look-for, and a live tick readout. Plain DOM (allowed in
 * `app`, never in `sim`). Playback controls (pause / speed / single-step / restart) USED to live here but
 * were removed — game speed + pause now belong to the in-game **tool panel** (the game GUI), so this overlay
 * is purely the sign-off checklist plus a debug tick. Sign-off itself happens in chat.
 */

export interface SceneOverlayHandle {
  /** Refresh the live readout (called once per frame). */
  update(tick: number): void;
}

/** The collapsed-state toggle chip (top-right corner) that expands the checklist on demand. */
const TOGGLE_STYLE = [
  'position:fixed',
  'top:12px',
  'right:12px',
  'box-sizing:border-box',
  'padding:4px 10px',
  'background:rgba(20, 16, 12, 0.9)',
  'color:#e8dcc8',
  'border:1px solid #5a4a36',
  'border-radius:4px',
  'font:12px/1.4 ui-monospace, monospace',
  'cursor:pointer',
  'z-index:40',
].join(';');

/**
 * Mount the acceptance overlay for a scene — COLLAPSED by default to a small top-right chip, so the
 * checklist never covers the in-game HUD (the details panel lives in the same corner region). Clicking
 * the chip toggles the full panel. Returns a live handle for the per-frame tick readout.
 */
export function mountSceneOverlay(scene: SceneDefinition): SceneOverlayHandle {
  const panel = el('div', `${PANEL_STYLE};display:none`);

  panel.append(
    el('div', 'font-weight:700;font-size:14px;margin-bottom:2px', scene.title),
    el('div', 'opacity:0.85;margin-bottom:8px', scene.summary),
    el('div', 'font-weight:700;margin-bottom:4px', 'Czy to wygląda OK? Sprawdź:'),
  );

  const list = el('ul', 'margin:0 0 10px 0;padding-left:18px');
  for (const item of scene.checklist) list.append(el('li', 'margin:2px 0', item));
  panel.append(list);

  const tickLine = el('div', 'opacity:0.7;margin-bottom:6px', 'tick: 0');
  panel.append(tickLine);
  panel.append(
    signOffFooter(
      'Gdy ocenisz scenę, wróć do czatu i napisz, czy jest OK. Tempo / pauza — na lewym panelu narzędzi.',
    ),
  );

  const toggle = el('button', TOGGLE_STYLE, `ℹ ${scene.title}`);
  let open = false;
  toggle.addEventListener('click', () => {
    open = !open;
    panel.style.display = open ? 'block' : 'none';
    toggle.style.display = open ? 'none' : 'block';
  });
  // Clicking anywhere on the expanded panel collapses it back to the chip.
  panel.addEventListener('click', () => {
    open = false;
    panel.style.display = 'none';
    toggle.style.display = 'block';
  });

  document.body.append(panel, toggle);
  return {
    update(tick: number): void {
      tickLine.textContent = `tick: ${tick}`;
    },
  };
}

/** Mount a small message panel when `?scene=<id>` names no registered scene, listing the valid ids. */
export function mountUnknownSceneOverlay(sceneId: string, available: readonly string[]): void {
  const panel = el('div', PANEL_STYLE);
  panel.append(
    el('div', 'font-weight:700;font-size:14px;margin-bottom:6px', `Brak sceny: "${sceneId}"`),
    el('div', 'opacity:0.85;margin-bottom:6px', 'Dostępne sceny (?scene=…):'),
  );
  const list = el('ul', 'margin:0;padding-left:18px');
  for (const id of available) list.append(el('li', 'margin:2px 0', id));
  panel.append(list);
  document.body.append(panel);
}
