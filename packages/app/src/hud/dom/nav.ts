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
    focus: (id) => buttons.get(id)?.focus(),
    dispose: () => nav.remove(),
  };
}
