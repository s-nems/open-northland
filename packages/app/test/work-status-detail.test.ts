import { afterEach, expect, it } from 'vitest';
import { GOOD_FLOUR, GOOD_WATER } from '../src/game/sandbox/ids/index.js';
import { goodLabel } from '../src/hud/details-panel/model/context.js';
import { workStatusDetail } from '../src/hud/details-panel/model/work-status.js';
import { setActiveLocale } from '../src/i18n/index.js';
import { sandboxCtx } from './support/sandbox.js';

afterEach(() => setActiveLocale('pol'));

it('names ingredient deficits separately from the product in both languages', () => {
  const ctx = sandboxCtx();
  const status = {
    kind: 'waitingInput',
    goodType: GOOD_FLOUR,
    missingInputs: [{ goodType: GOOD_WATER, available: 1, required: 3, missing: 2 }],
  } as const;
  const product = goodLabel(ctx, GOOD_FLOUR);
  const input = goodLabel(ctx, GOOD_WATER);
  setActiveLocale('pol');
  expect(workStatusDetail(ctx, status)).toBe(`${product}: brakuje w warsztacie ${input} ×2 (jest 1/3)`);
  setActiveLocale('eng');
  expect(workStatusDetail(ctx, status)).toBe(`${product}: workshop is missing ${input} ×2 (has 1/3)`);
});

it('distinguishes a missing resource, a blocked approach, and an unknown cause', () => {
  const ctx = sandboxCtx();
  const goodTypes = [GOOD_FLOUR];
  const goods = goodLabel(ctx, GOOD_FLOUR);
  expect(workStatusDetail(ctx, { kind: 'noEligibleResource', goodTypes, scope: 'workArea' })).toBe(
    `Nie znaleziono zasobów do zebrania w obszarze pracy: ${goods}`,
  );
  expect(workStatusDetail(ctx, { kind: 'resourceRouteBlocked', goodTypes })).toBe(
    `Brak dostępnego dojścia do zasobów: ${goods}`,
  );
  expect(workStatusDetail(ctx, { kind: 'unknown', reason: 'productionGate' })).toBe(
    'Nie ustalono przyczyny bezczynności',
  );
  expect(workStatusDetail(ctx, { kind: 'nothingSelected' })).toBe('Wszystkie produkty ustawione na 0');
  expect(workStatusDetail(ctx, { kind: 'noWorkplace' })).toBe('Brak przypisanego miejsca pracy');
});
