// @vitest-environment jsdom
import type { HudModel } from '@open-northland/render';
import { afterEach, describe, expect, it } from 'vitest';
import { createHudSummary } from '../src/hud/dom/summary.js';

afterEach(() => {
  document.body.replaceChildren();
});

const WOOD_TYPE = 7;
const WOOD_AMOUNT = 12;
const GOOD_IDS: ReadonlyMap<number, string> = new Map([[WOOD_TYPE, 'wood']]);

describe('the summary bar', () => {
  it('paints each breakdown row with its own good icon', () => {
    const painted: { goodId: string; frame: HTMLElement }[] = [];
    const summary = createHudSummary({
      paintGood: (frame, goodId) => painted.push({ goodId, frame }),
      goodIdOf: (goodType) => GOOD_IDS.get(goodType),
      goodLabel: (goodId) => goodId,
    });
    document.body.append(summary.element);
    const model: HudModel = {
      tick: 0,
      player: 0,
      population: 0,
      jobs: [],
      stocks: [{ goodType: WOOD_TYPE, amount: WOOD_AMOUNT }],
    };
    summary.update(model);

    const woodRow = [...summary.element.querySelectorAll<HTMLElement>('.on-tip__row--good')].find(
      (row) => row.textContent?.startsWith('wood') === true,
    );
    const woodFrame = woodRow?.querySelector('.on-good__frame');
    expect(woodRow?.querySelector('b')?.textContent).toBe(String(WOOD_AMOUNT));
    expect(painted.find((p) => p.frame === woodFrame)?.goodId).toBe('wood');
    // The category counter's icon is painted too, with the category's representative good.
    const counterFrames = summary.element.querySelectorAll('.on-bar__count .on-good__frame');
    expect(painted.filter((p) => [...counterFrames].includes(p.frame)).map((p) => p.goodId)).toContain(
      'wood',
    );
    summary.dispose();
  });
});
