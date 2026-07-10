import { ONE, type WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { STOCK_TAB_COUNT } from '../src/content/gui-atlas-map.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
  GOOD_WOOD,
  JOB_GATHERER_WOOD,
} from '../src/game/sandbox/ids.js';
import {
  type StockRow,
  type UnitPanelModel,
  type UnitPanelModelContext,
  buildUnitPanelModel,
} from '../src/hud/details-panel/index.js';
import { defaultStockTab } from '../src/hud/details-panel/panel.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox.js';

function ctxFromScene(): UnitPanelModelContext {
  const sim = createSceneSim(sandboxScene);
  return {
    buildings: sim.content.buildings,
    goods: sim.content.goods,
    jobs: sim.content.jobs,
  };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

describe('selection details panel model', () => {
  it('reflects a selected headquarters from the sandbox acceptance scene', () => {
    const sim = createSceneSim(sandboxScene);
    sim.step();
    const snapshot = sim.snapshot();
    const hq = snapshot.entities.find((e) => {
      const b = e.components.Building as { buildingType?: unknown } | undefined;
      return num(b?.buildingType) === BUILDING_HEADQUARTERS;
    });
    if (hq === undefined) throw new Error('sandbox scene did not place the headquarters');

    const model = buildUnitPanelModel(snapshot, new Set([hq.id]), {
      buildings: sim.content.buildings,
      goods: sim.content.goods,
      jobs: sim.content.jobs,
    });

    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.typeId).toBe(BUILDING_HEADQUARTERS);
    expect(model.title).toBe('Headquarters');
    expect(model.showDefense).toBe(true);
    // The stock list is the HQ's ACCEPTED goods (its `stock` slots), each shown even at 0 — so every
    // accepted good appears; a freshly-placed HQ holds nothing, so every row is 0.
    const hqDef = sim.content.buildings.find((b) => b.typeId === BUILDING_HEADQUARTERS);
    const accepted = new Set((hqDef?.stock ?? []).map((s) => s.goodType));
    expect(accepted.size).toBeGreaterThan(0);
    expect(new Set(model.stock.map((r) => r.goodType))).toEqual(accepted);
    expect(model.stock.every((r) => r.amount === 0)).toBe(true);
    // Every row carries the stock category tab it belongs to (0–7), so the render can filter by tab.
    expect(model.stock.every((r) => r.category >= 0 && r.category < STOCK_TAB_COUNT)).toBe(true);
  });

  it('opens a building on its fullest stock category, and the lowest tab on a tie', () => {
    const row = (category: number): StockRow => ({ goodType: category, label: 'g', amount: 0, category });
    const building = (stock: StockRow[]): UnitPanelModel =>
      ({ kind: 'building', stock }) as unknown as UnitPanelModel;
    // Tab 2 holds three of the four goods → the panel opens there.
    expect(defaultStockTab(building([row(2), row(2), row(2), row(5)]))).toBe(2);
    // Tabs 5 and 0 tie at one good each → the lowest tab index wins.
    expect(defaultStockTab(building([row(5), row(0)]))).toBe(0);
    // No stock → tab 0.
    expect(defaultStockTab(building([]))).toBe(0);
  });

  it('shows a producing building stock, production progress, and assigned workers', () => {
    const snapshot: WorldSnapshot = {
      tick: 10,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Building: { buildingType: BUILDING_JOINERY, tribe: 1, built: ONE, level: 0 },
            Owner: { player: 0 },
            Stockpile: { amounts: [[GOOD_WOOD, 3]] },
            Production: { elapsed: 5, duration: 20 },
          },
        },
        {
          id: 2,
          components: {
            Settler: {
              tribe: 1,
              jobType: JOB_GATHERER_WOOD,
              hunger: 0,
              fatigue: 0,
              piety: 0,
              enjoyment: 0,
              experience: [],
            },
            JobAssignment: { workplace: 1 },
            CurrentAtomic: { targetEntity: 1 },
          },
        },
      ],
    };

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxFromScene());
    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.production?.pct).toBe(25);
    expect(model.production?.label).toContain('plank x1');
    expect(model.stock).toEqual(
      expect.arrayContaining([expect.objectContaining({ goodType: GOOD_WOOD, amount: 3 })]),
    );
    // The joinery also lists its other accepted goods at 0 (its stock slots beyond the held wood).
    expect(model.stock.some((r) => r.amount === 0)).toBe(true);
    // The held good sorts ahead of the empty ones.
    expect(model.stock[0]?.amount).toBe(3);
    // The worker section is a per-trade filled/capacity line: the joinery's one gatherer slot, now filled
    // (the bound settler), named from the shared catalog + i18n (Polish), not the raw job id.
    expect(model.workerSlots).toEqual([
      expect.objectContaining({ label: 'Zbieracz drewna', filled: 1, capacity: 1 }),
    ]);
  });

  it('lists each worker trade with its own filled/capacity (Druid 1/1 · Tragarz 0/1 · Zbieracz 0/1)', () => {
    const DRUID_HUT = 35;
    const sim = createSceneSim(sandboxScene);
    const druidSlot = sim.content.buildings.find((b) => b.typeId === DRUID_HUT)?.workers[0]; // Druid, declared first
    if (druidSlot === undefined) throw new Error('druid hut has no worker slots');
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Building: { buildingType: DRUID_HUT, tribe: 1, built: ONE, level: 0 },
            Owner: { player: 0 },
          },
        },
        // One settler bound here as the Druid trade — that slot is filled, the carrier/gatherer slots empty.
        { id: 2, components: { Settler: { jobType: druidSlot.jobType }, JobAssignment: { workplace: 1 } } },
      ],
    };

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxFromScene());
    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`)).toEqual([
      'Druid 1/1',
      'Tragarz 0/1',
      'Zbieracz 0/1',
    ]);

    // Selecting that bound settler must name its trade, not fall back to "Bezrobotny": its `jobType` is the
    // rebased building-slot id, which the profession catalog doesn't carry — so the title resolves through
    // the content job names, exactly like the worker-slot rows above.
    const settlerModel = buildUnitPanelModel(snapshot, new Set([2]), ctxFromScene());
    expect(settlerModel.kind).toBe('settler');
    if (settlerModel.kind !== 'settler') return;
    expect(settlerModel.title).toBe('Druid');
  });
});
