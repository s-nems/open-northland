import { ONE, type WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { STOCK_TAB_COUNT } from '../src/content/gui-atlas-map.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
  GOOD_SHOES,
  GOOD_WOOD,
  JOB_GATHERER_WOOD,
} from '../src/game/sandbox/ids.js';
import {
  HUMANWINDOW,
  type SettlerPanelModel,
  type StockRow,
  type UnitPanelModel,
  type UnitPanelModelContext,
  buildUnitPanelModel,
} from '../src/hud/details-panel/index.js';
import { MAX_STOCK_ROWS, stockSlotRects } from '../src/hud/details-panel/layout.js';
import { defaultStockTab } from '../src/hud/details-panel/panel.js';
import { equipmentScene } from '../src/scenes/equipment.js';
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

  it('lays the stock grid as MAX_STOCK_ROWS×2 column-major cells inside the body (draw == hit geometry)', () => {
    const body = { x: 10, y: 100, w: 200, h: 132 };
    const slots = stockSlotRects(body, 1);
    expect(slots).toHaveLength(MAX_STOCK_ROWS * 2);
    // Column-major: the first MAX_STOCK_ROWS fill the left column (shared x), the rest the right column.
    expect(slots[0]?.x).toBe(body.x);
    expect(slots[MAX_STOCK_ROWS - 1]?.x).toBe(body.x);
    expect(slots[MAX_STOCK_ROWS]?.x).toBeGreaterThan(body.x); // right column starts further right
    // Rows descend within a column, and every cell stays inside the body.
    expect(slots[1]?.y).toBeGreaterThan(slots[0]?.y ?? 0);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(body.x);
      expect(s.x + s.w).toBeLessThanOrEqual(body.x + body.w + 1); // +1 for integer rounding
      expect(s.y + s.h).toBeLessThanOrEqual(body.y + body.h + 1);
    }
  });

  it('opens a building on the FIRST (lowest-index) category that holds any of its goods', () => {
    const row = (category: number): StockRow => ({ goodType: category, label: 'g', amount: 0, category });
    const building = (stock: StockRow[]): UnitPanelModel =>
      ({ kind: 'building', stock }) as unknown as UnitPanelModel;
    // The panel opens on the lowest tab that has goods, regardless of which category is fullest.
    expect(defaultStockTab(building([row(2), row(2), row(2), row(5)]))).toBe(2);
    // A general store holding goods across many tabs opens on the leading one (tab 0).
    expect(defaultStockTab(building([row(5), row(0), row(7), row(7), row(7)]))).toBe(0);
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
    expect(settlerModel.profession).toBe('Druid');
  });

  it('shows a settler equipment section with labeled rows, worn goods, use percentages and empty slots', () => {
    const sim = createSceneSim(equipmentScene);
    sim.step();
    const snapshot = sim.snapshot();
    const ctx: UnitPanelModelContext = {
      buildings: sim.content.buildings,
      goods: sim.content.goods,
      jobs: sim.content.jobs,
    };
    const bootsGood = (e: (typeof snapshot.entities)[number]): number | undefined =>
      num((e.components.Equipment as { boots?: { goodType?: unknown } } | undefined)?.boots?.goodType);
    const hasWeaponSlot = (e: (typeof snapshot.entities)[number]): boolean =>
      (e.components.Equipment as { weapon?: unknown } | undefined)?.weapon != null;
    const rowOf = (m: SettlerPanelModel, titleId: number) =>
      m.equipmentRows.find((r) => r.titleId === titleId);

    // The equipped civilian: boots = shoes, no weapon slot → Buty / Narzędzia / Ekwipunek rows only.
    const civ = snapshot.entities.find((e) => bootsGood(e) === GOOD_SHOES && !hasWeaponSlot(e));
    if (civ === undefined) throw new Error('equipment scene did not place the equipped civilian');
    const civModel = buildUnitPanelModel(snapshot, new Set([civ.id]), ctx);
    if (civModel.kind !== 'settler') throw new Error('expected a settler model');
    expect(civModel.equipmentRows.map((r) => r.titleId)).toEqual([
      HUMANWINDOW.boots,
      HUMANWINDOW.tools,
      HUMANWINDOW.misc,
    ]);
    expect(rowOf(civModel, HUMANWINDOW.boots)?.slots[0]).toMatchObject({ goodId: 'shoes', usePct: 70 });
    // The misc row holds the four consumable slots: a worn mead carries a use percent, a permanent amulet
    // does not, and one slot stays empty.
    const misc = rowOf(civModel, HUMANWINDOW.misc)?.slots ?? [];
    expect(misc).toHaveLength(4);
    expect(misc.some((sl) => sl.goodId === 'mead' && sl.usePct === 50)).toBe(true);
    expect(misc.some((sl) => sl.goodId === 'amulet_strength' && sl.usePct === null)).toBe(true);
    expect(misc.filter((sl) => sl.goodId === undefined)).toHaveLength(1);

    // The soldier additionally carries the Broń + Zbroja rows.
    const soldier = snapshot.entities.find(hasWeaponSlot);
    if (soldier === undefined) throw new Error('equipment scene did not place the equipped soldier');
    const solModel = buildUnitPanelModel(snapshot, new Set([soldier.id]), ctx);
    if (solModel.kind !== 'settler') throw new Error('expected a settler model');
    expect(solModel.equipmentRows.map((r) => r.titleId)).toEqual([
      HUMANWINDOW.boots,
      HUMANWINDOW.tools,
      HUMANWINDOW.weapon,
      HUMANWINDOW.armor,
      HUMANWINDOW.misc,
    ]);
    expect(rowOf(solModel, HUMANWINDOW.weapon)?.slots[0]?.goodId).toBe('sword_shord');
    expect(rowOf(solModel, HUMANWINDOW.armor)?.slots[0]?.goodId).toBe('armor_chain');
  });

  it('shows empty equipment rows for a settler with no Equipment component', () => {
    const sim = createSceneSim(equipmentScene);
    sim.step();
    const snapshot = sim.snapshot();
    const ctx: UnitPanelModelContext = {
      buildings: sim.content.buildings,
      goods: sim.content.goods,
      jobs: sim.content.jobs,
    };
    const bare = snapshot.entities.find(
      (e) => e.components.Settler !== undefined && e.components.Equipment === undefined,
    );
    if (bare === undefined) throw new Error('equipment scene did not place an unequipped settler');
    const model = buildUnitPanelModel(snapshot, new Set([bare.id]), ctx);
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // The base rows still show (Buty, Narzędzia, Ekwipunek), all empty; no weapon/armour row.
    expect(model.equipmentRows.map((r) => r.titleId)).toEqual([
      HUMANWINDOW.boots,
      HUMANWINDOW.tools,
      HUMANWINDOW.misc,
    ]);
    expect(
      model.equipmentRows
        .flatMap((r) => r.slots)
        .every((sl) => sl.goodId === undefined && sl.usePct === null),
    ).toBe(true);
  });
});
