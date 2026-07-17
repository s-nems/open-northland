import { diag } from '../diag/log.js';
import { messages } from '../i18n/index.js';
import { BRAND_BACKDROP } from './brand-art.js';

/**
 * The boot progress card the two playable entries (`?map=`, `?scene=`) show while they assemble a world.
 * Both spend seconds on content fetches, atlas builds and terrain meshing before their first frame; without
 * this the page is the body's bare `#1a1410` for that whole stretch. Plain DOM, like the crash banner
 * ({@link import('../diag/crash.js')}): it must be able to draw before Pixi exists and while Pixi is busy.
 *
 * Styled in `boot-progress.css` (linked from `index.html`) in the main menu's vocabulary, so leaving the
 * menu does not change the art the player is looking at.
 *
 * The galleries and `?shot` deliberately do not mount it — `?shot` is the committed-PNG harness and
 * screenshots the `#game` element, which an overlay would occlude.
 */

/** The ordered boot steps a playable entry can report. Each is one label and one step of the bar. */
export const BOOT_PHASES = [
  'graphics',
  'map',
  'content',
  'sprites',
  'terrain',
  'objects',
  'world',
  'minimap',
  'hud',
] as const;

export type BootPhase = (typeof BOOT_PHASES)[number];

export interface BootProgress {
  /** Announce the step about to run, then yield until the browser has painted the new label and bar. */
  begin(phase: BootPhase): Promise<void>;
  /** Uncover the finished world (after one painted frame, so no black flash on the handover). */
  finish(): Promise<void>;
}

/**
 * The share of an entry's boot that is done when `phase` starts. Steps are weighted equally: their real
 * costs differ a lot (the content parse dwarfs the minimap), but a weighting would be invented numbers,
 * so the honest signal is the step label and the bar is a coarse "how far through the list".
 * A phase outside `phases` reads as 0 rather than throwing — a mislabelled bar must not break boot.
 */
export function bootFraction(phases: readonly BootPhase[], phase: BootPhase): number {
  const index = phases.indexOf(phase);
  return index < 0 ? 0 : index / phases.length;
}

let overlay: HTMLElement | null = null;
let removeFailureDismiss: (() => void) | null = null;

/**
 * Resolve once the browser has painted what was just written. Boot steps run long synchronous stretches
 * (terrain meshing, resource spawning) that block the frame, so without this yield a step's label would
 * only reach the screen after that step had already finished.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Drop the card if boot dies, so a crash banner is never covered by a stale "loading" screen. Listens for
 * the same two events the crash capture does, rather than coupling `diag/` to `view/`.
 */
function installFailureDismiss(): () => void {
  const onFailure = (): void => dismissBootProgress();
  window.addEventListener('error', onFailure);
  window.addEventListener('unhandledrejection', onFailure);
  return () => {
    window.removeEventListener('error', onFailure);
    window.removeEventListener('unhandledrejection', onFailure);
  };
}

/** Create an element with a class and optional children — the terse builder this card's small tree needs. */
function node(className: string, ...children: readonly HTMLElement[]): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  div.append(...children);
  return div;
}

/** Mount the card for an entry's own ordered step list (the steps it actually runs, in the order it runs them). */
export function mountBootProgress(phases: readonly BootPhase[]): BootProgress {
  dismissBootProgress();
  const bar = node('boot-card__bar');
  const label = node('boot-card__label');
  const root = node('boot-card', node('boot-card__frame', node('boot-card__track', bar)), label);
  root.style.setProperty('--boot-backdrop', `url("${BRAND_BACKDROP}")`);
  document.body.append(root);
  overlay = root;
  removeFailureDismiss = installFailureDismiss();
  return {
    async begin(phase: BootPhase): Promise<void> {
      label.textContent = messages().loading[phase];
      bar.style.width = `${bootFraction(phases, phase) * 100}%`;
      // Rides the existing `boot` channel into the diagnostics bundle, so a slow load is readable there.
      diag.info('boot', 'phase', { phase });
      await nextPaint();
    },
    async finish(): Promise<void> {
      bar.style.width = '100%';
      // Pixi renders on RAF, so waiting a frame guarantees the world is drawn before the card comes off.
      await nextPaint();
      dismissBootProgress();
    },
  };
}

/** Remove the card if one is up. Idempotent. */
export function dismissBootProgress(): void {
  overlay?.remove();
  overlay = null;
  removeFailureDismiss?.();
  removeFailureDismiss = null;
}
