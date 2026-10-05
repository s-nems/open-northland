import { messages } from '../i18n/index.js';
import { button, element, setAttribute, setDisabled, setTip } from './dom/parts/dom.js';

export type MapOverlay = 'signposts';

/** Session-local view state; overlays never enter a save or simulation command. */
export interface MapOverlayControls {
  active: MapOverlay | null;
}

export function createMapOverlayToolbar(parent: HTMLElement, state: MapOverlayControls) {
  const copy = messages().hud.mapOverlays;
  const root = element('div', 'on-map-overlays');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', copy.label);
  const toggle = button('on-minimap-chrome__button on-map-overlays__toggle');
  toggle.setAttribute('aria-label', copy.signposts);
  toggle.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 18V2M6 3h9l-2 3 2 3H6M6 10H2l2 3-2 3h4"/></svg>';
  let hasSeat = true;
  const refresh = (): void => {
    const active = hasSeat && state.active === 'signposts';
    setAttribute(toggle, 'aria-pressed', String(active));
    setDisabled(toggle, !hasSeat);
    setTip(toggle, hasSeat ? copy.tip : copy.noSeat);
  };
  toggle.addEventListener('click', () => {
    if (!hasSeat) return;
    state.active = state.active === 'signposts' ? null : 'signposts';
    refresh();
  });
  root.append(toggle);
  parent.append(root);
  refresh();
  return {
    update(seated: boolean): void {
      hasSeat = seated;
      refresh();
    },
  };
}
