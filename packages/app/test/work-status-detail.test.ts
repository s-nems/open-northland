import type { HerdWait } from '@open-northland/sim';
import { afterEach, expect, it } from 'vitest';
import { GOOD_FLOUR, GOOD_SHEEP, GOOD_WATER } from '../src/game/sandbox/ids/index.js';
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
    missingInputs: [
      { goodType: GOOD_WATER, available: 1, required: 3, missing: 2, source: 'inReach', gatheredBy: null },
    ],
  } as const;
  const names = () => ({ product: goodLabel(ctx, GOOD_FLOUR), input: goodLabel(ctx, GOOD_WATER) });
  setActiveLocale('pol');
  const pol = names();
  expect(workStatusDetail(ctx, status)).toBe(
    `${pol.product}: brakuje w warsztacie ${pol.input} ×2 (jest 1/3)`,
  );
  setActiveLocale('eng');
  const eng = names();
  expect(workStatusDetail(ctx, status)).toBe(`${eng.product}: workshop is missing ${eng.input} ×2 (has 1/3)`);
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

it('says when the only store for a product or an input lies outside signpost reach', () => {
  const ctx = sandboxCtx();
  const product = goodLabel(ctx, GOOD_FLOUR);
  const input = goodLabel(ctx, GOOD_WATER);
  const waiting = {
    kind: 'waitingInput',
    goodType: GOOD_FLOUR,
    missingInputs: [
      { goodType: GOOD_WATER, available: 0, required: 1, missing: 1, source: 'outOfReach', gatheredBy: null },
    ],
  } as const;
  expect(workStatusDetail(ctx, waiting)).toBe(
    `Poza zasięgiem drogowskazów: ${input} (${product}). Połącz drogowskazami z magazynem`,
  );
  expect(
    workStatusDetail(ctx, { kind: 'noOutputDestination', goodType: GOOD_FLOUR, reason: 'outOfReach' }),
  ).toBe(`Brak magazynu w zasięgu drogowskazów: ${product}. Połącz drogowskazami z magazynem`);
});

it('names the herd a breeder waits on in place of its water and wheat', () => {
  const ctx = sandboxCtx();
  const sheep = goodLabel(ctx, GOOD_SHEEP);
  const herd = (wait: HerdWait) =>
    workStatusDetail(ctx, { kind: 'herdNotReady', goodType: GOOD_SHEEP, wait, adults: 1, young: 0 });
  expect(herd('noAnimals')).toBe(
    `Brak zwierząt: ${sheep}. Wyślij zwiadowcę do dzikich zwierząt, by je zajął`,
  );
  expect(herd('tooFew')).toBe(
    `Tylko jedno zwierzę: ${sheep}. Do hodowli potrzeba pary, zajmij zwiadowcą drugie`,
  );
  expect(herd('youngGrowing')).toBe(`Młode dorastają: ${sheep}. Hodowla ruszy, gdy para dorośnie`);
  setActiveLocale('eng');
  expect(herd('herdFull')).toBe(
    `Herd full: ${goodLabel(ctx, GOOD_SHEEP)}. The stock farmer waits for the young to grow up`,
  );
});
