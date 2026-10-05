import { messages } from '../i18n/index.js';
import { button, element, setAttribute, setDisabled, setHidden, setTip } from './dom/parts/dom.js';

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
  const toggle = button('on-map-overlays__toggle');
  toggle.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 18V2M6 3h9l-2 3 2 3H6M6 10H2l2 3-2 3h4"/></svg>';
  const label = element('span', 'on-map-overlays__label');
  label.textContent = copy.signposts;
  toggle.append(label);
  const legend = element('div', 'on-map-overlays__legend');
  legend.textContent = copy.legend;
  let hasSeat = true;
  const refresh = (): void => {
    const active = hasSeat && state.active === 'signposts';
    setAttribute(toggle, 'aria-pressed', String(active));
    setDisabled(toggle, !hasSeat);
    setTip(toggle, hasSeat ? copy.tip : copy.noSeat);
    setHidden(legend, !active);
  };
  toggle.addEventListener('click', () => {
    if (!hasSeat) return;
    state.active = state.active === 'signposts' ? null : 'signposts';
    refresh();
  });
  root.append(toggle, legend);
  parent.append(root);
  refresh();
  return {
    update(seated: boolean): void {
      hasSeat = seated;
      refresh();
    },
  };
}
