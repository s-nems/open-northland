// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createCalculator,
  selectCalculatorWeapon,
} from '../../../../src/hud/dom/knowledge/calculator-view.js';
import type { KnowledgeContext } from '../../../../src/hud/dom/knowledge/context.js';
import { createKnowledgeBase, type KnowledgeWeapon } from '../../../../src/hud/knowledge/base.js';
import { knowledgeContent, VIKING } from '../../../support/knowledge-content.js';

const weapon = (id: string, bare: number): KnowledgeWeapon => ({
  typeId: 1,
  id,
  jobType: 33,
  filmJob: null,
  jobName: id,
  goodType: null,
  goodName: id,
  mainType: 2,
  weight: 0,
  minRange: 1,
  maxRange: 1,
  damage: { '0': bare, '2': bare },
  clipTicks: 24,
  blows: 1,
  usable: true,
});

const makeContext = (): KnowledgeContext =>
  ({
    base: {
      ...createKnowledgeBase(knowledgeContent()),
      weapons: new Map([
        [VIKING, [weapon('wooden_spear', 100), weapon('iron_spear', 500), weapon('hero_spear', 900)]],
      ]),
    },
    art: { goodIcon: () => undefined, motion: null },
    settlement: null,
    tribe: () => VIKING,
    go: () => undefined,
    onPageLeft: () => undefined,
    leavePage: () => undefined,
  }) as unknown as KnowledgeContext;

const mount = (context: KnowledgeContext): HTMLElement => {
  const node = createCalculator(context);
  document.body.replaceChildren(node);
  return node;
};

const tiles = (root: HTMLElement): readonly string[] =>
  [...root.querySelectorAll('.kn-calc__tile dd')].map((node) => node.textContent ?? '');

describe('calculator view', () => {
  it('survives a rebuild of the article with the same fight', () => {
    const context = makeContext();
    const first = mount(context);
    const rank = first.querySelector<HTMLElement>('[data-weapon="wooden_spear"]');
    rank?.click();
    expect(rank?.isConnected).toBe(false);
    expect(document.activeElement).toBe(first.querySelector('[data-weapon="wooden_spear"]'));
    const before = tiles(first);
    expect(tiles(mount(context))).toEqual(before);
    expect(mount(context).querySelector('[data-weapon="wooden_spear"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('preselects a weapon through the target, heroes included', () => {
    const context = makeContext();
    selectCalculatorWeapon(context, 'hero_spear');
    const root = mount(context);
    expect(root.querySelector('[data-weapon="hero_spear"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.kn-calc__weapon').length).toBe(3);
  });

  it('walks the dial with the arrow keys', () => {
    const root = mount(makeContext());
    const sectors = [...root.querySelectorAll<SVGPathElement>('.kn-dial__sector')];
    sectors[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(sectors[5]?.getAttribute('aria-checked')).toBe('true');
    expect(sectors[5]?.getAttribute('tabindex')).toBe('0');
    expect(sectors[0]?.getAttribute('tabindex')).toBe('-1');
  });

  it('closes experience to a hero and says why', () => {
    const context = makeContext();
    selectCalculatorWeapon(context, 'hero_spear');
    const root = mount(context);
    expect(root.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
  });

  it('switches to the duel and back on the same state', () => {
    const root = mount(makeContext());
    const buttons = [...root.querySelectorAll<HTMLElement>('.on-segmented button')];
    buttons[1]?.click();
    expect(root.querySelector('.kn-calc__verdict')?.textContent).not.toBe('');
    expect(root.querySelector('.kn-calc__strip')).toBeNull();
    buttons[0]?.click();
    expect(root.querySelector('.kn-calc__strip')).not.toBeNull();
  });
});
