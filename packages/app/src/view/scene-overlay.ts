import type { SceneDefinition } from '../scenes/index.js';
import { PANEL_STYLE, el, signOffFooter } from './overlay.js';

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

/** Mount the acceptance overlay for a scene. Returns a live handle for the per-frame tick readout. */
export function mountSceneOverlay(scene: SceneDefinition): SceneOverlayHandle {
  const panel = el('div', PANEL_STYLE);

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

  document.body.append(panel);
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
