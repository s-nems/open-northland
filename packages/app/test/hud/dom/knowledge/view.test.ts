// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeArt,
  KnowledgeContext,
  KnowledgeView,
} from '../../../../src/hud/dom/knowledge/context.js';
import { createKnowledgeView } from '../../../../src/hud/dom/knowledge/view.js';
import { createKnowledgeBase } from '../../../../src/hud/knowledge/base.js';
import type { EntryRef, KnowledgeSettlement, KnowledgeStatus } from '../../../../src/hud/knowledge/model.js';
import { knowledgeContent } from '../../../support/knowledge-content.js';

/** What the stub entries still hold, by the page that took it. */
const held = vi.hoisted(() => new Set<string>());
let plays = 0;

const page = (className: string, text: string): HTMLElement => {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = text;
  return node;
};

vi.mock('../../../../src/hud/dom/knowledge/entry-view.js', () => ({
  renderEntry: (context: KnowledgeContext, ref: EntryRef) => {
    const entry = page('stub-entry', `${ref.kind}:${ref.id}`);
    held.add(ref.id);
    context.onPageLeft(() => held.delete(ref.id));
    const link = (go: string): HTMLButtonElement => {
      const node = document.createElement('button');
      node.dataset.go = go;
      return node;
    };
    entry.append(link('good:iron'), link('building:handcart'), link('job:carrier'), link('article:fog'));
    return entry;
  },
}));
vi.mock('../../../../src/hud/dom/knowledge/encyclopedia-view.js', () => ({
  ENCYCLOPEDIA_LIST_SCROLL: 'enc-list',
  firstEntry: (): EntryRef => ({ kind: 'good', id: 'wood' }),
  renderEncyclopedia: (
    context: KnowledgeContext,
    ref: EntryRef | null,
    onCategory: (first: EntryRef) => void,
  ) => {
    const encyclopedia = page('stub-encyclopedia', ref === null ? '' : `${ref.kind}:${ref.id}`);
    held.add('encyclopedia');
    plays += 1;
    context.onPageLeft(() => held.delete('encyclopedia'));
    const category = document.createElement('button');
    category.className = 'stub-category';
    category.addEventListener('click', () => onCategory({ kind: 'job', id: 'carrier' }));
    encyclopedia.append(category);
    return encyclopedia;
  },
}));
vi.mock('../../../../src/hud/dom/knowledge/article-view.js', () => ({
  CALCULATOR_ARTICLE: 'damage',
  articleGroups: () => [
    {
      group: 'World',
      items: [{ id: 'fog', name: 'Fog of war', blocks: [{ h: 'Sight' }, { p: 'text' }] }],
    },
  ],
  renderArticle: (_context: unknown, id: string, focus: { calculator?: string }) =>
    page('stub-article', `${id}:${focus.calculator ?? ''}`),
}));

const art: KnowledgeArt = {
  goodIcon: () => undefined,
  buildingThumb: () => false,
  animalPicture: () => false,
  motion: null,
};

describe('the Knowledge view', () => {
  let view: KnowledgeView;

  function mount(settlement: KnowledgeSettlement | null = null): KnowledgeView {
    view = createKnowledgeView({ base: createKnowledgeBase(knowledgeContent()), art, settlement });
    document.body.append(view.element);
    view.open();
    return view;
  }
  const find = (selector: string): HTMLElement => {
    const node = view.element.querySelector<HTMLElement>(selector);
    if (node === null) throw new Error(`no ${selector}`);
    return node;
  };
  const click = (selector: string): void => find(selector).click();
  const back = (): void => click('.kn-back');
  const paneText = (): string | null =>
    view.element.querySelector('.kn-pane:not([hidden]) .stub-entry')?.firstChild?.textContent ?? null;
  const pinned = (): string[] =>
    [...view.element.querySelectorAll<HTMLElement>('.kn-card.is-pinned')].map((c) => c.dataset.node ?? '');
  const selectedTab = (): string | undefined => find('.on-tab[aria-selected="true"]').dataset.tab;
  const card = (key: string): string => `.kn-card[data-node="${key}"]`;

  beforeEach(() => {
    document.body.replaceChildren();
    held.clear();
  });
  afterEach(() => view.dispose());

  it('frees a page when another replaces it, and only then', () => {
    mount();
    click('[data-tab="encyclopedia"]');
    expect([...held]).toEqual(['encyclopedia']);
    click('[data-tab="mechanics"]');
    expect([...held]).toEqual([]);
  });

  it('keeps the page a swap just built', () => {
    mount();
    click('[data-tab="encyclopedia"]');
    click('.stub-category');
    expect([...held]).toEqual(['encyclopedia']);
  });

  it('frees a pinned entry when the pin moves or the tree goes', () => {
    mount();
    click(card('good:wood'));
    click(card('good:iron'));
    expect([...held]).toEqual(['iron']);
    click('[data-tab="mechanics"]');
    expect([...held]).toEqual([]);
  });

  it('frees the page on a close and draws it anew on the next open', () => {
    mount();
    click('[data-tab="encyclopedia"]');
    const before = plays;
    view.close();
    expect([...held]).toEqual([]);
    view.open();
    expect([...held]).toEqual(['encyclopedia']);
    expect(plays).toBe(before + 1);
  });

  it('frees the page on dispose', () => {
    mount();
    click('[data-tab="encyclopedia"]');
    view.dispose();
    expect([...held]).toEqual([]);
  });

  it('steps back through every move it made, tab by tab', () => {
    mount();
    expect((find('.kn-back') as HTMLButtonElement).disabled).toBe(true);
    click('[data-tab="encyclopedia"]');
    click('[data-tab="mechanics"]');
    back();
    expect(selectedTab()).toBe('encyclopedia');
    back();
    expect(selectedTab()).toBe('goods');
    expect((find('.kn-back') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a click pins the card and opens its entry beside the tree', () => {
    mount();
    click(card('good:wood'));
    expect(pinned()).toEqual(['good:wood']);
    expect(paneText()).toBe('good:wood');
    expect(find('.kn-treeview').classList.contains('is-spot')).toBe(true);
  });

  it('a second card moves the pin, and each pin is a step back', () => {
    mount();
    click(card('good:wood'));
    click(card('good:iron'));
    expect(pinned()).toEqual(['good:iron']);
    back();
    expect(pinned()).toEqual(['good:wood']);
    expect(paneText()).toBe('good:wood');
    back();
    expect(pinned()).toEqual([]);
    expect(paneText()).toBeNull();
  });

  it('pointing previews another chain and leaving returns to the pin', () => {
    mount();
    click(card('good:wood'));
    const iron = find(card('good:iron'));
    iron.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(iron.classList.contains('is-self')).toBe(true);
    expect(pinned()).toEqual(['good:wood']);
    find('.kn-treescroll').dispatchEvent(new MouseEvent('pointerleave'));
    expect(iron.classList.contains('is-self')).toBe(false);
    expect(find(card('good:wood')).classList.contains('is-self')).toBe(true);
  });

  it("a good link in the pane moves the pin; a building link crosses to that card's tree", () => {
    mount();
    click(card('good:wood'));
    click('.kn-pane [data-go="good:iron"]');
    expect(pinned()).toEqual(['good:iron']);
    expect(selectedTab()).toBe('goods');
    click('.kn-pane [data-go="building:handcart"]');
    expect(selectedTab()).toBe('buildings');
    expect(pinned()).toEqual(['building:handcart']);
    back();
    expect(selectedTab()).toBe('goods');
    expect(pinned()).toEqual(['good:iron']);
  });

  it('other links in the pane leave for their tab', () => {
    mount();
    click(card('good:wood'));
    click('.kn-pane [data-go="job:carrier"]');
    expect(selectedTab()).toBe('encyclopedia');
    expect(find('.stub-encyclopedia').textContent).toBe('job:carrier');
    back();
    click('.kn-pane [data-go="article:fog"]');
    expect(selectedTab()).toBe('mechanics');
    expect(find('.stub-article').textContent).toBe('fog:');
  });

  it('the close button and Esc drop the pin and its pane, and Wróć brings them back', () => {
    mount();
    click(card('good:wood'));
    click('.kn-pane__close');
    expect(pinned()).toEqual([]);
    back();
    expect(paneText()).toBe('good:wood');
    expect(view.escape()).toBe(true);
    expect(paneText()).toBeNull();
    expect(view.escape()).toBe(false);
  });

  it('Esc pressed inside the view is taken by the view while it has something to drop', () => {
    mount();
    click(card('good:wood'));
    const outside = vi.fn();
    document.body.addEventListener('keydown', outside);
    const press = (): void => {
      find('.kn-card').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };
    press();
    expect(outside).not.toHaveBeenCalled();
    press();
    expect(outside).toHaveBeenCalledOnce();
    document.body.removeEventListener('keydown', outside);
  });

  it('hears Esc in the search box after the game window lifts the bar out of the view', () => {
    mount();
    click(card('good:wood'));
    document.body.append(view.head);
    const search = view.head.querySelector('.kn-search input') as HTMLInputElement;
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pinned()).toEqual([]);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).not.toBe(search);
    view.head.remove();
  });

  it('opens a target as a step, and keeps its place when reopened without one', () => {
    mount();
    view.open({ entry: { kind: 'building', id: 'work_smithy_00' } });
    expect(selectedTab()).toBe('encyclopedia');
    expect(find('.stub-encyclopedia').textContent).toBe('building:work_smithy_00');
    view.open();
    expect(selectedTab()).toBe('encyclopedia');
    back();
    expect(selectedTab()).toBe('goods');
    view.open({ calculator: 'wooden_spear' });
    expect(find('.stub-article').textContent).toBe('damage:wooden_spear');
  });

  it('a tab keeps its entry for the session', () => {
    mount();
    view.open({ entry: { kind: 'good', id: 'iron' } });
    click('[data-tab="goods"]');
    click('[data-tab="encyclopedia"]');
    expect(find('.stub-encyclopedia').textContent).toBe('good:iron');
  });

  it('opens the first entry for the reader without a step of its own', () => {
    mount();
    click('[data-tab="encyclopedia"]');
    expect(find('.stub-encyclopedia').textContent).toBe('good:wood');
    click('.stub-category');
    expect(find('.stub-encyclopedia').textContent).toBe('job:carrier');
    back();
    expect(selectedTab()).toBe('goods');
  });

  it('restores the scroll of the place Wróć returns to', () => {
    mount();
    const scroller = find('.kn-treescroll');
    scroller.scrollTop = 240;
    scroller.dispatchEvent(new Event('scroll'));
    click(card('good:wood'));
    scroller.scrollTop = 900;
    scroller.dispatchEvent(new Event('scroll'));
    click(card('good:iron'));
    back();
    expect(find('.kn-treescroll').scrollTop).toBe(900);
    click('[data-tab="encyclopedia"]');
    click('[data-tab="goods"]');
    expect(find('.kn-treescroll').scrollTop).toBe(900);
  });

  it('search spans entries and article headings, grouped, and is itself a step', () => {
    mount();
    const search = find('.kn-search input') as HTMLInputElement;
    const type = (text: string): void => {
      search.value = text;
      search.dispatchEvent(new Event('input'));
    };
    click('[data-tab="encyclopedia"]');
    type('sight');
    expect(find('.kn-row').dataset.go).toBe('article:fog');
    expect(find('.on-section').textContent).toContain('1');
    click('.kn-row');
    expect(selectedTab()).toBe('mechanics');
    back();
    expect(search.value).toBe('sight');
    back();
    expect(search.value).toBe('');
    expect(selectedTab()).toBe('encyclopedia');
    type('zz');
    expect(view.element.querySelector('.kn-search-empty')).not.toBeNull();
    type('');
    expect((find('.kn-back') as HTMLButtonElement).disabled).toBe(false);
    expect(view.element.querySelector('.stub-encyclopedia')).not.toBeNull();
  });

  it("presses the seat's tribe, and drops the seat's standing on another people's pages", () => {
    const status = vi.fn((): KnowledgeStatus => ({ kind: 'locked', missing: ['Smith'] }));
    mount({ tribe: 1, status });
    click('[data-tab="buildings"]');
    const pressed = view.element.querySelectorAll('.kn-tribes__item[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
    expect(find(card('building:work_smithy_00')).classList.contains('kn-card--locked')).toBe(true);
    const other = view.element.querySelector<HTMLElement>('.kn-tribes__item[aria-pressed="false"]');
    other?.click();
    expect(other?.getAttribute('aria-pressed')).toBe('true');
    expect(find(card('building:work_smithy_00')).classList.contains('kn-card--locked')).toBe(false);
  });

  it('tells a locked building from a map ban on its card', () => {
    mount({
      tribe: 1,
      status: (_kind, typeId) =>
        typeId === createKnowledgeBase(knowledgeContent()).buildingById.get('work_druid_00')?.typeId
          ? { kind: 'mapForbidden' }
          : { kind: 'locked', missing: ['Smith', 'Iron'] },
    });
    click('[data-tab="buildings"]');
    expect(find(card('building:work_druid_00')).classList.contains('kn-card--map')).toBe(true);
    const locked = find(card('building:work_smithy_00'));
    expect(locked.classList.contains('kn-card--locked')).toBe(true);
    expect(locked.title).toContain('Smith');
    expect(locked.textContent).not.toContain('Smith');
  });
});
