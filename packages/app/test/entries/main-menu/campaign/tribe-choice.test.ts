// @vitest-environment jsdom
import { CIVILIZATION_TRIBES } from '@open-northland/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignTribeChoice } from '../../../../src/entries/main-menu/campaign/tribe-choice.js';

/** The campaign's civilization choice is a radio group: arrows step and wrap, Home and End jump. */

vi.mock('../../../../src/hud/dom/tribe-emblems.js', () => ({
  tribeEmblem: () => document.createElement('span'),
}));

const FIRST = CIVILIZATION_TRIBES[0];
const SECOND = CIVILIZATION_TRIBES[1];
const LAST = CIVILIZATION_TRIBES.at(-1);

function mount(initial: number) {
  const changes: number[] = [];
  const { root } = campaignTribeChoice(initial, (tribe) => changes.push(tribe));
  document.body.append(root);
  const group = root.querySelector<HTMLElement>('[role="radiogroup"]');
  if (group === null) throw new Error('no radio group');
  const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const press = (key: string): void => {
    group.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const checked = (): number => radios.findIndex((radio) => radio.getAttribute('aria-checked') === 'true');
  return { radios, press, checked, changes };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('campaignTribeChoice keyboard', () => {
  if (FIRST === undefined || SECOND === undefined || LAST === undefined) throw new Error('no civilizations');
  const lastIndex = CIVILIZATION_TRIBES.length - 1;

  it('keeps only the checked radio in the tab order', () => {
    const { radios, checked } = mount(SECOND);
    expect(checked()).toBe(1);
    expect(radios.map((radio) => radio.tabIndex)).toEqual(radios.map((_, index) => (index === 1 ? 0 : -1)));
  });

  it('steps with the arrows, wrapping at both ends, and moves focus and the tab stop along', () => {
    const { radios, press, checked, changes } = mount(FIRST);
    press('ArrowRight');
    expect(checked()).toBe(1);
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1]?.tabIndex).toBe(0);
    expect(radios[0]?.tabIndex).toBe(-1);
    press('ArrowUp');
    press('ArrowLeft');
    expect(checked()).toBe(lastIndex);
    press('ArrowDown');
    expect(checked()).toBe(0);
    expect(changes).toEqual([SECOND, FIRST, LAST, FIRST]);
  });

  it('jumps with Home and End and ignores other keys', () => {
    const { radios, press, checked, changes } = mount(SECOND);
    press('End');
    expect(checked()).toBe(lastIndex);
    expect(document.activeElement).toBe(radios[lastIndex]);
    press('Home');
    expect(checked()).toBe(0);
    press('Home');
    press('Enter');
    expect(checked()).toBe(0);
    expect(changes).toEqual([LAST, FIRST]);
  });
});
