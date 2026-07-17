import { diag } from '../diag/log.js';
import { messages } from '../i18n/index.js';
import { el } from './overlay.js';

/**
 * The boot progress card the two playable entries (`?map=`, `?scene=`) show while they assemble a world.
 * Both spend seconds on content fetches, atlas builds and terrain meshing before their first frame; without
 * this the page is the body's bare `#1a1410` for that whole stretch. Plain DOM, like the crash banner
 * ({@link import('../diag/crash.js')}): it must be able to draw before Pixi exists and while Pixi is busy.
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

const OVERLAY_STYLE = [
  'position:fixed',
  'inset:0',
  'display:flex',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:14px',
  'background:radial-gradient(120% 80% at 50% 0%,#241b12 0%,#160f0a 70%)',
  'color:#e8dcc8',
  'font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  // Above the sound toggle (200), which mounts during the last step; below the crash banner (2200).
  'z-index:1000',
].join(';');

const TITLE_STYLE = [
  'font-weight:700',
  'font-size:14px',
  'letter-spacing:0.08em',
  'text-transform:uppercase',
  'opacity:0.7',
].join(';');

/** The bar's track and fill share the menu preview spinner's palette (`entries/menu/details.css`). */
const TRACK_STYLE = [
  'width:260px',
  'height:6px',
  'background:rgba(232,201,120,0.22)',
  'border-radius:3px',
  'overflow:hidden',
].join(';');

const BAR_STYLE = ['width:0%', 'height:100%', 'background:#e8c978', 'transition:width 180ms linear'].join(
  ';',
);

const LABEL_STYLE = 'opacity:0.85';

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

/** Mount the card for an entry's own ordered step list (the steps it actually runs, in the order it runs them). */
export function mountBootProgress(phases: readonly BootPhase[]): BootProgress {
  dismissBootProgress();
  const root = el('div', OVERLAY_STYLE);
  const track = el('div', TRACK_STYLE);
  const bar = el('div', BAR_STYLE);
  const label = el('div', LABEL_STYLE);
  track.append(bar);
  root.append(el('div', TITLE_STYLE, messages().loading.title), track, label);
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
