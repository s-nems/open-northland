import type { SceneDefinition } from '../scenes/index.js';
import { BUTTON_STYLE, PANEL_STYLE, button, el } from './overlay.js';

/**
 * The on-canvas acceptance overlay — the "czy jest OK?" panel a human reads while watching a scene.
 * Plain DOM (allowed in `app`, never in `sim`): a fixed panel over the Pixi canvas showing the scene's
 * title, its checklist of what-to-look-for, and the playback controls (pause / single-step / restart /
 * speed) so a reviewer can slow the loop down or replay it deterministically. Sign-off itself happens
 * in chat — this panel only frames the question and the checklist.
 */

export interface SceneOverlayHandlers {
  readonly initialSpeed: number;
  /** Toggle play/pause; returns the new `paused` state so the button can relabel itself. */
  readonly onTogglePause: () => boolean;
  /** Advance exactly one sim tick (while paused, to inspect a single frame). */
  readonly onStep: () => void;
  /** Rebuild the scene from its seed — a deterministic replay from tick 0. */
  readonly onRestart: () => void;
  /** Set the playback speed multiplier. */
  readonly onSpeed: (speed: number) => void;
}

export interface SceneOverlayHandle {
  /** Refresh the live readout (called once per frame). */
  update(tick: number): void;
}

const SPEEDS: readonly number[] = [0.25, 0.5, 1, 2];

/** Mount the acceptance overlay for a scene and wire its controls to `handlers`. Returns a live handle. */
export function mountSceneOverlay(
  scene: SceneDefinition,
  handlers: SceneOverlayHandlers,
): SceneOverlayHandle {
  const panel = el('div', PANEL_STYLE);

  panel.append(
    el('div', 'font-weight:700;font-size:14px;margin-bottom:2px', scene.title),
    el('div', 'opacity:0.85;margin-bottom:8px', scene.summary),
    el('div', 'font-weight:700;margin-bottom:4px', 'Czy to wygląda OK? Sprawdź:'),
  );

  const list = el('ul', 'margin:0 0 10px 0;padding-left:18px');
  for (const item of scene.checklist) list.append(el('li', 'margin:2px 0', item));
  panel.append(list);

  // Playback controls.
  const controls = el('div', 'display:flex;gap:6px;margin-bottom:8px');
  const pauseBtn = button('⏸ Pauza', () => {
    const paused = handlers.onTogglePause();
    pauseBtn.textContent = paused ? '▶ Wznów' : '⏸ Pauza';
    stepBtn.disabled = !paused;
    stepBtn.style.opacity = paused ? '1' : '0.4';
  });
  const stepBtn = button('⏭ Krok', () => handlers.onStep());
  stepBtn.disabled = true;
  stepBtn.style.opacity = '0.4';
  controls.append(
    pauseBtn,
    stepBtn,
    button('⟲ Restart', () => handlers.onRestart()),
  );
  panel.append(controls);

  // Speed selector.
  const speedRow = el('div', 'display:flex;gap:6px;align-items:center;margin-bottom:8px');
  speedRow.append(el('span', 'opacity:0.85', 'Tempo:'));
  const speedButtons = new Map<number, HTMLButtonElement>();
  const markSpeed = (active: number): void => {
    for (const [value, b] of speedButtons) {
      const on = value === active;
      b.style.background = on ? '#6b5840' : '#3a2f22';
      b.style.fontWeight = on ? '700' : '400';
    }
  };
  for (const value of SPEEDS) {
    const b = button(`${value}×`, () => {
      handlers.onSpeed(value);
      markSpeed(value);
    });
    speedButtons.set(value, b);
    speedRow.append(b);
  }
  panel.append(speedRow);
  markSpeed(handlers.initialSpeed);

  const tickLine = el('div', 'opacity:0.7;margin-bottom:6px', 'tick: 0');
  panel.append(tickLine);
  panel.append(
    el(
      'div',
      'opacity:0.65;font-size:12px;border-top:1px solid #5a4a36;padding-top:6px',
      'Gdy ocenisz scenę, wróć do czatu i napisz, czy jest OK.',
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
