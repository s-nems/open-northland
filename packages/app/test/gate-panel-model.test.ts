import { ONE } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { panelViewFor } from '../src/hud/details-panel/selection-view.js';
import { panelModelOf } from './support/details-panel.js';

it('keeps automatic policy separate from an open passage and leaves gates to the DOM panel', () => {
  const model = panelModelOf({
    id: 8,
    components: {
      Palisade: { built: ONE, gate: { open: true, counterpartGfxIndex: 696 } },
      GateControl: { mode: 'automatic' },
      Owner: { player: 0 },
      Health: { hitpoints: 75, max: 100 },
    },
  });
  expect(model).toMatchObject({ gateOpen: true, gateMode: 'automatic', foreign: false, health: { pct: 75 } });
  expect(panelViewFor(model, { width: 1600, height: 900 }, 1)).toEqual({ kind: 'empty' });
});
