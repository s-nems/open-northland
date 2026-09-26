import { button, element, setAttribute, setClass, setTip, write } from './dom.js';

/** One text tab: its caption, the count after it (hidden at 0) and a lit dot for "something here". */
export interface CategoryTab {
  readonly label: string;
  readonly count: number;
  readonly marked: boolean;
  readonly tooltip: string;
}

/** A strip of text tabs over a parchment, as the construction window's categories: one open at a time.
 *  The strip knows no content; its owner keeps which tab is open and passes it with every update. */
export interface CategoryTabs {
  readonly element: HTMLElement;
  update(tabs: readonly CategoryTab[], open: number): void;
}

interface TabView {
  readonly tab: HTMLButtonElement;
  readonly caption: HTMLElement;
  readonly count: HTMLElement;
}

const STEP_KEYS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowLeft: -1 };

export function createCategoryTabs(groupLabel: string, onPick: (index: number) => void): CategoryTabs {
  const root = element('div', 'on-tabs on-tabs--categories');
  root.setAttribute('role', 'tablist');
  root.setAttribute('aria-label', groupLabel);
  let views: TabView[] = [];
  let open = 0;

  const view = (index: number): TabView => {
    const tab = button(
      'on-tab',
      '<span class="on-tab__caption"></span><span class="on-tab__count"></span><i class="on-tab__dot"></i>',
    );
    tab.setAttribute('role', 'tab');
    const [caption, count] = [tab.children[0], tab.children[1]];
    if (!(caption instanceof HTMLElement) || !(count instanceof HTMLElement)) throw new Error('tabs: tab');
    tab.addEventListener('click', () => onPick(index));
    return { tab, caption, count };
  };
  // Arrow keys step to the neighbouring tab and open it, as a tab list does.
  root.addEventListener('keydown', (event) => {
    const step = STEP_KEYS[event.key];
    if (step === undefined || views.length === 0) return;
    event.preventDefault();
    const next = (open + step + views.length) % views.length;
    onPick(next);
    views[next]?.tab.focus();
  });

  return {
    element: root,
    update(tabs, openIndex): void {
      open = openIndex;
      if (views.length !== tabs.length) {
        views = tabs.map((_tab, index) => view(index));
        root.replaceChildren(...views.map((entry) => entry.tab));
      }
      tabs.forEach((tab, index) => {
        const entry = views[index];
        if (entry === undefined) return;
        const selected = index === openIndex;
        write(entry.caption, tab.label);
        write(entry.count, tab.count > 0 ? String(tab.count) : '');
        setClass(entry.tab, 'on-tab--marked', tab.marked);
        setAttribute(entry.tab, 'aria-selected', String(selected));
        // One tab stop for the strip: the open tab; the arrows reach the rest.
        setAttribute(entry.tab, 'tabindex', selected ? '0' : '-1');
        setTip(entry.tab, tab.tooltip);
      });
    },
  };
}
