import { uiFoundationArt } from '../../content/own-assets/ui-foundation.js';
import './foundation.css';
import { HUD_SYMBOLS } from './symbols.js';

/** Below the DOM diagnostics overlays (perf 50, admin 150/160) and the system menu (2000). */
const HUD_DOM_Z = 40;

export interface HudPlane {
  /** The design-px plane; regions append themselves here. */
  readonly element: HTMLElement;
  /** `HudScaleTarget` seam shared with the Pixi HUD parts. */
  setUiScale(scale: number): Promise<void>;
  currentScale(): number;
}

export interface HudDomRoot extends HudPlane {
  dispose(): void;
}

/**
 * A plane that keeps design px and is scaled as a whole, so regions lay out at the numbers the
 * foundation reference uses. Its size follows the parent divided by the scale (foundation.css).
 */
export function createHudPlane(initialScale: number): HudPlane {
  const element = document.createElement('div');
  element.className = 'on-hud';
  element.innerHTML = HUD_SYMBOLS;
  const art = uiFoundationArt();
  if (art !== null) {
    element.style.setProperty('--on-surface', `url("${art.surfaceUrl}")`);
    element.style.setProperty('--on-icons', `url("${art.iconsUrl}")`);
  }
  let scale = Number.NaN;
  const apply = (next: number): void => {
    scale = next;
    element.style.setProperty('--hud-scale', String(next));
  };
  apply(initialScale);
  return {
    element,
    setUiScale: (next) => {
      apply(next);
      return Promise.resolve();
    },
    currentScale: () => scale,
  };
}

/** Mount the DOM HUD plane over the game canvas. The plane never eats pointer events; only its panels do. */
export function mountHudDomRoot(initialScale: number): HudDomRoot {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: String(HUD_DOM_Z),
  });
  const plane = createHudPlane(initialScale);
  host.append(plane.element);
  document.body.append(host);
  return { ...plane, dispose: () => host.remove() };
}
