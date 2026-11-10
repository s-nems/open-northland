// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { type ChoiceGroup, createChoiceWindow } from '../../../src/hud/dom/choice-window.js';
import type { GoodIconPainter } from '../../../src/hud/dom/good-art.js';
import { dropdownControl } from '../../../src/hud/dom/parts/dropdown.js';
import type { CameraGestures } from '../../../src/view/camera/index.js';
import { STILL_CAMERA } from '../../support/still-camera.js';

/** A painter that marks each frame with the good it was asked for, so a test reads what was drawn. */
const markingPainter: GoodIconPainter = (frame, goodId) => {
  frame.dataset.good = goodId;
};

/** Per row, the good its icon slot was painted with: '' for an empty slot, null for no slot. */
const slots = (rows: Iterable<Element>): (string | null)[] =>
  [...rows].map((row) => {
    const frame = row.querySelector<HTMLElement>('.on-good__frame');
    return frame === null ? null : (frame.dataset.good ?? '');
  });

afterEach(() => {
  document.body.replaceChildren();
});

describe('the choice window', () => {
  const choices = (pictured: boolean): ChoiceGroup[] => [
    {
      label: 'Basic',
      rows: [
        { key: '6', label: 'Civilian' },
        { key: '8', label: 'Collector', ...(pictured ? { goodId: 'wood' } : {}) },
      ],
    },
  ];
  const rowsOf = (groups: readonly ChoiceGroup[]): Element[] => {
    const window = createChoiceWindow({
      title: 'Profession',
      camera: STILL_CAMERA,
      icons: markingPainter,
      onPick: () => {},
      onDismiss: () => {},
    });
    window.update(groups);
    return [...document.querySelectorAll('.on-choice-row')];
  };

  it('paints each row good and keeps an empty slot where a row has none', () => {
    expect(slots(rowsOf(choices(true)))).toEqual(['', 'wood']);
  });

  it('paints all overlapping goods in their presentation order', () => {
    const goods = ['wood', 'mud', 'stone', 'iron', 'gold', 'mushroom'];
    const rows = rowsOf([{ label: 'Basic', rows: [{ key: '8', label: 'Collector', goodIds: goods }] }]);
    expect(
      [...(rows[0]?.querySelectorAll<HTMLElement>('.on-good__frame') ?? [])].map(
        (frame) => frame.dataset.good,
      ),
    ).toEqual(goods);
  });

  it('lists names alone when no row has a good', () => {
    expect(slots(rowsOf(choices(false)))).toEqual([null, null]);
  });

  it('hands the camera its pan keys and the backdrop wheel and press, keeping the rest', () => {
    const handed: string[] = [];
    const camera: CameraGestures = {
      key: (event) => {
        handed.push(`key ${event.key}`);
        return event.key === 'ArrowLeft';
      },
      press: (event) => handed.push(`press ${(event.target as HTMLElement).className}`),
      wheel: (event) => handed.push(`wheel ${(event.target as HTMLElement).className}`),
    };
    const window = createChoiceWindow({
      title: 'Profession',
      camera,
      onPick: () => {},
      onDismiss: () => {},
    });
    window.update(choices(false));
    const row = document.querySelector('.on-choice-row');
    const dialog = document.querySelector('dialog');
    const plane = dialog?.firstElementChild;
    if (row === null || dialog === null || !(plane instanceof HTMLElement)) throw new Error('window missing');
    const reachedPage: string[] = [];
    document.addEventListener('keydown', (event) => reachedPage.push(event.key));

    for (const key of ['ArrowLeft', 'Escape', 'c'])
      row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(handed).toEqual(['key ArrowLeft', 'key Escape']); // 'c' went to the search field
    expect(document.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('c');
    expect(reachedPage).toEqual([]);

    handed.length = 0;
    const shownRow = document.querySelector('.on-choice-row');
    if (shownRow === null) throw new Error('search hid every row');
    for (const target of [shownRow, plane, dialog]) {
      target.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true }));
    }
    expect(handed).toEqual([
      'wheel on-hud',
      'press on-hud',
      'wheel on-choice-modal',
      'press on-choice-modal',
    ]);
  });
});

describe('the dropdown', () => {
  it('paints the choices goods in the list and the picked one on the button', () => {
    const dropdown = dropdownControl({
      label: 'Job',
      className: 'on-test-select',
      entries: [
        { id: '', label: 'Anyone' },
        { group: 'Crafts', choices: [{ id: 'potter', label: 'Potter', goodId: 'crockery' }] },
      ],
      active: '',
      onPick: () => {},
      icons: markingPainter,
    });
    expect(slots(dropdown.root.querySelectorAll('.on-test-select-option'))).toEqual(['', 'crockery']);
    expect(slots([dropdown.button])).toEqual([null]);
    dropdown.setActive('potter');
    expect(slots([dropdown.button])).toEqual(['crockery']);
  });
});
