import { ONE, type WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { STOCK_TAB_COUNT } from '../src/content/gui-atlas-map.js';
import {
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_MILL,
  GOOD_FLOUR,
  GOOD_SHOES,
  GOOD_WHEAT,
  GOOD_WOOD,
  JOB_GATHERER_WOOD,
} from '../src/game/sandbox/ids.js';
import {
  barTone,
  buildUnitPanelModel,
  HUMANWINDOW,
  type SettlerPanelModel,
  type StockRow,
  type UnitPanelModel,
  type UnitPanelModelContext,
} from '../src/hud/details-panel/index.js';
import { layoutDetails, MAX_STOCK_ROWS, stockSlotRects } from '../src/hud/details-panel/layout.js';
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
    // The title reads the SAME localized name the build menu shows (catalog/building-i18n.ts).
    expect(model.title).toBe('Kwatera Główna');
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
            // TWO in-flight batches (one per operator) at different progress — the panel bars each.
            Production: {
              cycles: [
                { elapsed: 5, duration: 20 },
                { elapsed: 10, duration: 20 },
              ],
            },
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
    expect(model.production?.kind).toBe('recipe');
    if (model.production?.kind !== 'recipe') return;
    expect(model.production.pcts).toEqual([25, 50]); // one bar per batch, in cycle (FIFO) order
    expect(model.production.label).toContain('plank x1');
    // The production row carries its output's string id — the icon key the panel draws beside the bar.
    expect(model.production.goodId).toBe('plank');
    expect(model.stock).toEqual(
      expect.arrayContaining([expect.objectContaining({ goodType: GOOD_WOOD, amount: 3 })]),
    );
    // The joinery also lists its other accepted goods at 0 (its stock slots beyond the held wood).
    expect(model.stock.some((r) => r.amount === 0)).toBe(true);
    // Rows keep the DECLARED slot order (wood is the joinery's first slot) — stable while amounts
    // change, so a compact store's rows never swap places mid-work.
    expect(model.stock[0]?.goodType).toBe(GOOD_WOOD);
    expect(model.stock[0]?.amount).toBe(3);
    // The worker section is a per-trade filled/capacity line: the joinery's one gatherer slot, now filled
    // (the bound settler), named from the shared catalog + i18n (Polish), not the raw job id.
    expect(model.workerSlots).toEqual([
      expect.objectContaining({ label: 'Zbieracz drewna', filled: 1, capacity: 1 }),
    ]);
  });

  it('keeps Magazyn rows in declared slot order while amounts change (Pszenica before Mąka, always)', () => {
    // The mill declares wheat then flour; holding ONLY the second slot's good must not bubble it above
    // the first — a compact store's two rows swapping mid-work read as a glitch (user feedback
    // 2026-07-11). Held-first reordering is the big tabbed store's draw-time concern, not the model's.
    const snapshot: WorldSnapshot = {
      tick: 1,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Building: { buildingType: BUILDING_MILL, tribe: 1, built: ONE, level: 0 },
            Owner: { player: 0 },
            Stockpile: { amounts: [[GOOD_FLOUR, 3]] }, // flour held, wheat momentarily empty
          },
        },
      ],
    };
    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxFromScene());
    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.stock.map((r) => [r.goodType, r.amount])).toEqual([
      [GOOD_WHEAT, 0],
      [GOOD_FLOUR, 3],
    ]);
  });

  it('labels a good by its localized content name when one is loaded (Mąka, not "flour")', () => {
    // The browser entries feed sandboxContent a per-locale good-name map (content/good-names.ts); the
    // model's labels must prefer that `name` over the machine id — the Produkcja row read "flour x1".
    const ctx = ctxFromScene();
    const named = {
      ...ctx,
      goods: ctx.goods.map((g) => (g.typeId === GOOD_FLOUR ? { ...g, name: 'Mąka' } : g)),
    };
    const snapshot: WorldSnapshot = {
      tick: 1,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Building: { buildingType: BUILDING_MILL, tribe: 1, built: ONE, level: 0 },
            Owner: { player: 0 },
            Stockpile: { amounts: [] },
          },
        },
      ],
    };
    const model = buildUnitPanelModel(snapshot, new Set([1]), named);
    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.production?.kind).toBe('recipe');
    if (model.production?.kind !== 'recipe') return;
    expect(model.production.label).toContain('Mąka x1');
    expect(model.production.goodId).toBe('flour'); // the icon key stays the machine id
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

  it('shows the Ogólne bars in order with pinned labels, satisfaction levels and hover values', () => {
    // Needs are rising fixed-point DEFICITS; the bars must show the satisfaction LEVEL (100 − need).
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Settler: { tribe: 1, hunger: ONE / 4, fatigue: ONE / 2, enjoyment: 0, piety: (ONE * 9) / 10 },
            Health: { hitpoints: 300, max: 1000 },
          },
        },
        // The same needs without a Health component — the Zdrowie bar must be omitted, not zeroed.
        { id: 2, components: { Settler: { tribe: 1, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 } } },
      ],
    };

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxFromScene());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // Pinned labels (deliberately diverging from the decoded humanwindow 12–14 stat names), in the
    // fixed Zdrowie → Głód → Sen → Towarzystwo → Religia order.
    expect(model.bars.map((b) => b.label)).toEqual(['Zdrowie', 'Głód', 'Sen', 'Towarzystwo', 'Religia']);
    // Health: gauge = hp/max percent, hover = the raw points.
    expect(model.bars[0]).toMatchObject({ pct: 30, hover: '300/1000' });
    // Needs: gauge = satisfaction level, hover = the same level as a percent.
    expect(model.bars[1]).toMatchObject({ pct: 75, hover: '75%' }); // hunger 25% → 75% sated
    expect(model.bars[2]).toMatchObject({ pct: 50, hover: '50%' });
    expect(model.bars[3]).toMatchObject({ pct: 100, hover: '100%' });
    expect(model.bars[4]).toMatchObject({ pct: 10, hover: '10%' });

    const bare = buildUnitPanelModel(snapshot, new Set([2]), ctxFromScene());
    if (bare.kind !== 'settler') throw new Error('expected a settler model');
    expect(bare.bars.map((b) => b.label)).toEqual(['Głód', 'Sen', 'Towarzystwo', 'Religia']);
  });

  it('bands a bar level into green/orange/red tones at the named thresholds', () => {
    expect(barTone(100)).toBe('ok');
    expect(barTone(50)).toBe('ok'); // ≥50 stays green
    expect(barTone(49)).toBe('warn');
    expect(barTone(25)).toBe('warn'); // ≥25 stays orange
    expect(barTone(24)).toBe('critical');
    expect(barTone(0)).toBe('critical');
  });

  it('shows a farm as "Farma" with fields production and a single wheat stock row', () => {
    const field = (id: number, farm: number, stage: number): WorldSnapshot['entities'][number] => ({
      id,
      components: { Crop: { farm, stage, stages: 5 } },
    });
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Building: { buildingType: BUILDING_FARM, tribe: 1, built: ONE, level: 0 },
            Owner: { player: 0 },
            Stockpile: { amounts: [[GOOD_WHEAT, 3]] },
          },
        },
        field(2, 1, 1), // growing
        field(3, 1, 4), // growing
        field(4, 1, 5), // ripe
        field(5, 99, 5), // another farm's field — never counted here
      ],
    };

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxFromScene());
    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.title).toBe('Farma'); // the user-facing localized name (catalog/building-i18n.ts)
    // Production is the live FIELD state (no recipe to show): the farmed good + sown/growing/ripe.
    expect(model.production).toEqual({
      kind: 'fields',
      goodId: 'wheat',
      label: 'Wheat',
      sown: 3,
      growing: 2,
      ripe: 1,
    });
    // The store is the original's wheat-only slot (`logicstock 4 25 0`) — exactly one row, carrying
    // its declared capacity so the panel draws "3.0 / 25.0" (the user-requested ceiling readout).
    expect(
      model.stock.map((r) => ({ goodType: r.goodType, amount: r.amount, capacity: r.capacity })),
    ).toEqual([{ goodType: GOOD_WHEAT, amount: 3, capacity: 25 }]);
  });

  it('lays a small store out compact (no tabs, fitted rows) and drops Magazyn for a store-less building', () => {
    const screen = { width: 1600, height: 1200 };
    const buildingModel = (typeId: number): UnitPanelModel =>
      buildUnitPanelModel(
        {
          tick: 0,
          events: [],
          entities: [
            { id: 1, components: { Building: { buildingType: typeId, tribe: 1, built: ONE, level: 0 } } },
          ],
        },
        new Set([1]),
        ctxFromScene(),
      );

    // The farm's single wheat slot → the compact tab-less body, one fitted row per column pair.
    const farm = layoutDetails(buildingModel(BUILDING_FARM), screen, 1);
    if (farm?.kind !== 'building') throw new Error('expected a building layout');
    expect(farm.stockCompact).toBe(true);
    expect(farm.stockRows).toBe(1);
    expect(farm.stockTabHits).toHaveLength(0);
    expect(farm.stock).not.toBeNull();

    // The HQ's full catalog → the original fixed-height tabbed store.
    const hq = layoutDetails(buildingModel(BUILDING_HEADQUARTERS), screen, 1);
    if (hq?.kind !== 'building') throw new Error('expected a building layout');
    expect(hq.stockCompact).toBe(false);
    expect(hq.stockRows).toBe(MAX_STOCK_ROWS);
    expect(hq.stockTabHits.length).toBeGreaterThan(0);

    // A home stores nothing → no Magazyn window at all, and the panel is SHORTER than the farm's.
    const home = layoutDetails(buildingModel(BUILDING_HOME_00), screen, 1);
    if (home?.kind !== 'building') throw new Error('expected a building layout');
    expect(home.stock).toBeNull();
    expect(home.stockTabHits).toHaveLength(0);
    expect(home.panel.h).toBeLessThan(farm.panel.h);
    expect(farm.panel.h).toBeLessThan(hq.panel.h);
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
    // The panel headline personalises the character: a first name + patronymic is set, drawn in place of
    // the generic "Ogólne" title.
    expect(civModel.name).toContain(' ');
    expect(civModel.name.length).toBeGreaterThan(0);
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
