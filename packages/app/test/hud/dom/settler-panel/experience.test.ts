import { expect, it } from 'vitest';
import { trainedRow } from '../../../../src/hud/dom/settler-panel/experience.js';
import { formatMessage, messages } from '../../../../src/i18n/index.js';

const SHARE_PCT = 50;
const DEALT_PCT = 20;
const TAKEN_PCT = 20;
const ACCURACY_PCT = 61;

const fightRow = (dealtPct: number | null, accuracyPct: number | null) =>
  trainedRow({
    label: 'Fight',
    repeats: SHARE_PCT,
    bonusPct: null,
    fight: { sharePct: SHARE_PCT, dealtPct, takenCutPct: TAKEN_PCT, accuracyPct },
    own: true,
  });

it('shows the fight counter as its share and lists its bonuses in the tooltip, one to a line', () => {
  const copy = messages().hud.settlerPanel;
  const melee = fightRow(DEALT_PCT, null);
  expect(melee.value).toEqual([{ text: `${SHARE_PCT}%` }]);
  expect(melee.tooltip?.split('\n')).toEqual([
    formatMessage(copy.fightShare, { pct: SHARE_PCT }),
    formatMessage(copy.fightDealt, { pct: DEALT_PCT }),
    formatMessage(copy.fightTaken, { pct: TAKEN_PCT }),
  ]);
  expect(fightRow(null, ACCURACY_PCT).tooltip?.split('\n')).toEqual([
    formatMessage(copy.fightShare, { pct: SHARE_PCT }),
    formatMessage(copy.fightAccuracy, { pct: ACCURACY_PCT }),
    formatMessage(copy.fightTaken, { pct: TAKEN_PCT }),
  ]);
});
