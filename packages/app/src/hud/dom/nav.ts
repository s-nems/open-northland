import { createTooltip } from '../../view/tooltip.js';
import { setTip } from './parts/dom.js';
import { attachTipLayer } from './parts/tip-layer.js';

export interface HudNavEntry<Id extends string> {
  readonly id: Id;
  readonly label: string;
  /** The action art markup: a painted icon or the residents token. */
  readonly art: string;
}

/** The bottom navigation beam: one medallion action per entry, the open window's entry lit. */
export interface HudNav<Id extends string> {
  setActive(id: Id | null): void;
  /** A wax seal on the entry for news waiting behind it, named `label` for assistive tech. */
  setMarked(id: Id, marked: boolean, label: string): void;
  /** The entry's tip: its label and `key`, the binding that toggles it; null (unbound) leaves the label. */
  setKey(id: Id, key: string | null): void;
  focus(id: Id): void;
  dispose(): void;
}

export function createHudNav<Id extends string>(
  plane: HTMLElement,
  label: string,
  entries: readonly HudNavEntry<Id>[],
  onActivate: (id: Id) => void,
): HudNav<Id> {
  const nav = document.createElement('nav');
  nav.className = 'on-beam on-panel';
  nav.setAttribute('aria-label', label);
  Object.assign(nav.style, { position: 'absolute', left: '50%', bottom: '0', transform: 'translateX(-50%)' });
  const buttons = new Map<Id, HTMLButtonElement>();
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'on-action';
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span class="on-action__art">${entry.art}</span><span class="on-action__label"></span>`;
    const text = button.querySelector('.on-action__label');
    if (text !== null) text.textContent = entry.label;
    button.addEventListener('click', () => onActivate(entry.id));
    buttons.set(entry.id, button);
    nav.append(button);
  }
  plane.append(nav);
  // Its own chip: the frame loop hides the world's tooltip whenever the pointer is over the HUD.
  const chip = createTooltip();
  const tips = attachTipLayer(nav, chip);
  const labels = new Map(entries.map((entry) => [entry.id, entry.label]));
  let active: Id | null = null;
  const marks = new Map<Id, HTMLElement>();
  return {
    setActive: (id) => {
      if (id === active) return;
      active = id;
      for (const [entryId, button] of buttons) button.setAttribute('aria-pressed', String(entryId === id));
    },
    setMarked: (id, marked, label) => {
      const button = buttons.get(id);
      if (button === undefined || marks.has(id) === marked) return;
      if (!marked) {
        marks.get(id)?.remove();
        marks.delete(id);
        return;
      }
      const seal = document.createElement('i');
      seal.className = 'on-action__mark';
      seal.setAttribute('role', 'status');
      seal.setAttribute('aria-label', label);
      button.append(seal);
      marks.set(id, seal);
    },
    setKey: (id, key) => {
      const button = buttons.get(id);
      const label = labels.get(id);
      if (button === undefined || label === undefined) return;
      setTip(button, key === null ? label : `${label} · ${key}`);
    },
    focus: (id) => buttons.get(id)?.focus(),
    dispose: () => {
      tips.dispose();
      chip.destroy();
      nav.remove();
    },
  };
}
