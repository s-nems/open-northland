import { button, element, setAttribute, setClass, setHidden, setTip } from './dom.js';

/** One icon tab: faded while its category holds nothing, a lit dot for "something runs here". The
 *  label is the tab's name and its whole tooltip. */
export interface CategoryTab {
  readonly label: string;
  readonly empty: boolean;
  readonly marked: boolean;
  /** Left out of the strip: a category the house has no shelf for. */
  readonly hidden?: boolean;
}

/** A strip of square icon tabs over a list, one open at a time. The strip knows no content; its owner
 *  keeps which tab is open and passes it with every update. */
export interface CategoryTabs {
  readonly element: HTMLElement;
  update(tabs: readonly CategoryTab[], open: number): void;
}

const STEP_KEYS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowLeft: -1 };

export function createCategoryTabs(
  glyphs: readonly string[],
  groupLabel: string,
  onPick: (index: number) => void,
): CategoryTabs {
  const root = element('div', 'on-tabs on-tabs--icons');
  root.setAttribute('role', 'tablist');
  root.setAttribute('aria-label', groupLabel);
  let open = 0;
  let shown: readonly CategoryTab[] = [];
  const tabs = glyphs.map((glyph, index) => {
    const tab = button('on-tab on-tab--icon', `${glyph}<i class="on-tab__dot"></i>`);
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => onPick(index));
    root.append(tab);
    return tab;
  });
  // Arrow keys step to the neighbouring tab and open it, as a tab list does.
  root.addEventListener('keydown', (event) => {
    const step = STEP_KEYS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    let next = open;
    do next = (next + step + tabs.length) % tabs.length;
    while (next !== open && shown[next]?.hidden === true);
    onPick(next);
    tabs[next]?.focus();
  });

  return {
    element: root,
    update(models, openIndex): void {
      open = openIndex;
      shown = models;
      models.forEach((model, index) => {
        const tab = tabs[index];
        if (tab === undefined) return;
        const selected = index === openIndex;
        setHidden(tab, model.hidden === true);
        setClass(tab, 'on-tab--empty', model.empty);
        setClass(tab, 'on-tab--marked', model.marked);
        setAttribute(tab, 'aria-selected', String(selected));
        setAttribute(tab, 'aria-label', model.label);
        // One tab stop for the strip: the open tab; the arrows reach the rest.
        setAttribute(tab, 'tabindex', selected ? '0' : '-1');
        setTip(tab, model.label);
      });
    },
  };
}
