import { systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { trainedRow } from '../../../../src/hud/dom/settler-panel/experience.js';
import { formatMessage, messages } from '../../../../src/i18n/index.js';

const POINTS = 50;
const DEALT_PCT = 20;
const TAKEN_PCT = 20;
const ACCURACY_PCT = 61;

const fightRow = (dealtPct: number | null, accuracyPct: number | null) =>
  trainedRow({
    label: 'Fight',
    repeats: POINTS,
    bonusPct: null,
    fight: { dealtPct, takenCutPct: TAKEN_PCT, accuracyPct },
    own: true,
  });

it('shows the fight counter as a share of its full with the bonuses its weapon draws on', () => {
  const copy = messages().hud.settlerPanel;
  const share = { text: `${POINTS} / ${systems.FIGHT_EXPERIENCE_FULL}` };
  const taken = { text: formatMessage(copy.fightTaken, { pct: TAKEN_PCT }), tone: 'bonus' };
  expect(fightRow(DEALT_PCT, null).value).toEqual([
    share,
    { text: formatMessage(copy.fightDealt, { pct: DEALT_PCT }), tone: 'bonus' },
    taken,
  ]);
  expect(fightRow(null, ACCURACY_PCT).value).toEqual([
    share,
    { text: formatMessage(copy.fightAccuracy, { pct: ACCURACY_PCT }), tone: 'bonus' },
    taken,
  ]);
});
