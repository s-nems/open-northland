// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYERS_SIGHT, switchableViewerSeat, type WatchTarget } from '../../../../src/game/viewer-seat.js';
import { createObserverPicker } from '../../../../src/hud/dom/system/observer-picker.js';
import { DEFAULT_KEY_BINDINGS } from '../../../../src/hud/keybindings.js';
import { messages } from '../../../../src/i18n/index.js';

afterEach(() => {
  document.body.replaceChildren();
});

const FIRST_SEAT = 0;
const SECOND_SEAT = 2;

function mount() {
  const viewer = switchableViewerSeat(PLAYERS_SIGHT);
  const picked: WatchTarget[] = [];
  const picker = createObserverPicker({
    seats: [
      { player: FIRST_SEAT, name: 'Duchy' },
      { player: SECOND_SEAT, name: 'Duchy' },
    ],
    viewer,
    bindings: DEFAULT_KEY_BINDINGS,
    onWatch: (target) => {
      picked.push(target);
      viewer.watch(target);
    },
  });
  document.body.append(picker.element);
  picker.refresh();
  const button = picker.element.querySelector('.on-picker__button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('no picker button');
  button.click();
  const options = [...picker.element.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  return { picker, viewer, picked, button, options };
}

describe('observer picker', () => {
  it('names each view by its label alone, the two whole-map views by icon on one row', () => {
    const copy = messages().hud.observer;
    const { options } = mount();
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      copy.playersSight,
      copy.wholeMap,
      'Duchy 1',
      'Duchy 3',
    ]);
    const [sight, revealed] = options;
    expect(sight?.parentElement?.classList.contains('on-picker__modes')).toBe(true);
    expect(revealed?.parentElement).toBe(sight?.parentElement);
    expect([sight?.title, sight?.textContent]).toEqual([copy.playersSight, '0']);
    for (const key of document.querySelectorAll('.on-key'))
      expect(key.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a whole-map view on the button by icon and a seat by name', () => {
    const copy = messages().hud.observer;
    const { picker, button, options, picked } = mount();
    expect([button.title, button.querySelector('b')?.hidden]).toEqual([copy.playersSight, true]);
    options[2]?.click();
    picker.refresh();
    expect(picked).toEqual([FIRST_SEAT]);
    expect([button.title, button.querySelector('b')?.textContent]).toEqual(['', 'Duchy 1']);
    expect(options[2]?.getAttribute('aria-selected')).toBe('true');
  });
});
