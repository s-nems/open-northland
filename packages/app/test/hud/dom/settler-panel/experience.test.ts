import { systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { trainedRow } from '../../../../src/hud/dom/settler-panel/experience.js';
import { formatMessage, messages } from '../../../../src/i18n/index.js';

const POINTS = 50;
const DEALT_PCT = 5;
const TAKEN_PCT = 4;

it('shows the fight counter as a share of its full and labels both bonuses', () => {
  const copy = messages().hud.settlerPanel;
  const row = trainedRow({
    label: 'Fight',
    repeats: POINTS,
    bonusPct: DEALT_PCT,
    takenCutPct: TAKEN_PCT,
    own: true,
  });
  expect(row.value).toEqual([
    { text: `${POINTS} / ${systems.FIGHT_EXPERIENCE_FULL}` },
    { text: formatMessage(copy.fightDealt, { pct: DEALT_PCT }), tone: 'bonus' },
    { text: formatMessage(copy.fightTaken, { pct: TAKEN_PCT }), tone: 'bonus' },
  ]);
  expect(row.tooltip).toContain(`${POINTS}/${systems.FIGHT_EXPERIENCE_FULL}`);
});
