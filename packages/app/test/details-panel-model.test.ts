import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { STOCK_TAB_COUNT } from '../src/content/gui-atlas-map.js';
import {
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_MILL,
  GOOD_FLOUR,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_SHOES,
  GOOD_STONE,
  GOOD_WHEAT,
  GOOD_WOOD,
  JOB_BABY_MALE,
  JOB_CHILD_MALE,
  JOB_COLLECTOR,
} from '../src/game/sandbox/ids/index.js';
import { num } from '../src/game/snapshot.js';
import {
  barTone,
  buildUnitPanelModel,
  HUMANWINDOW,
  type SettlerPanelModel,
  type UnitPanelModelContext,
} from '../src/hud/details-panel/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { equipmentFixture } from './support/equipment.js';
import { buildingEntity, ctxOf, sandboxCtx, snapshotOf } from './support/sandbox.js';

/** The equipment fixture's first-tick snapshot + its content context — the preamble both equipment
 *  tests open with. */
function equipmentWorld(): { snapshot: WorldSnapshot; ctx: UnitPanelModelContext } {
  const sim = createSceneSim(equipmentFixture);
  sim.step();
  return { snapshot: sim.snapshot(), ctx: ctxOf(sim) };
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

    const model = buildUnitPanelModel(snapshot, new Set([hq.id]), ctxOf(sim));

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

  it('shows a producing building stock, production progress, and assigned workers', () => {
    const snapshot = snapshotOf(
      [
        buildingEntity(1, BUILDING_JOINERY, {
          components: {
            Stockpile: { amounts: [[GOOD_WOOD, 3]] },
            // TWO in-flight plank batches at different progress — the plank row bars the front-runner.
            Production: {
              cycles: [
                { elapsed: 5, duration: 20, goodType: GOOD_PLANK },
                { elapsed: 10, duration: 20, goodType: GOOD_PLANK },
              ],
            },
          },
        }),
        {
          id: 2,
          components: {
            Settler: {
              tribe: 1,
              jobType: JOB_COLLECTOR,
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
      10,
    );

    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.production?.kind).toBe('recipe');
    if (model.production?.kind !== 'recipe') return;
    // One row PER PRODUCT (the joinery makes plank only); its bar shows the front-runner batch (50%).
    expect(model.production.rows).toHaveLength(1);
    expect(model.production.rows[0]).toMatchObject({ goodType: GOOD_PLANK, pct: 50, label: 'plank' });
    // The production row carries its output's string id — the icon key the panel draws beside the bar —
    // and its recipe-inputs tooltip line ("Wymaga: <wood> ×1").
    expect(model.production.rows[0]?.goodId).toBe('plank');
    expect(model.production.rows[0]?.inputs).toContain('×1');
    expect(model.stock).toEqual(
      expect.arrayContaining([expect.objectContaining({ goodType: GOOD_WOOD, amount: 3 })]),
    );
    // The joinery also lists its other accepted goods at 0 (its stock slots beyond the held wood).
    expect(model.stock.some((r) => r.amount === 0)).toBe(true);
    // Rows keep the DECLARED slot order (wood is the joinery's first slot) — stable while amounts
    // change, so a compact store's rows never swap places mid-work.
    expect(model.stock[0]?.goodType).toBe(GOOD_WOOD);
    expect(model.stock[0]?.amount).toBe(3);
    // The worker section is a per-trade filled/capacity line: the joinery's one collector slot, now filled
    // (the bound settler), named from the shared catalog + i18n (Polish), not the raw job id.
    expect(model.workerSlots).toEqual([
      expect.objectContaining({ label: 'Zbieracz', filled: 1, capacity: 1 }),
    ]);
  });

  it('models a construction site: delivered/needed material rows + the health ramp', () => {
    const snapshot = snapshotOf(
      [
        buildingEntity(1, BUILDING_FARM, {
          built: ONE / 4,
          components: {
            UnderConstruction: { labor: ONE / 4 },
            Health: { hitpoints: 25, max: 100 },
            Stockpile: { amounts: [[GOOD_WOOD, 2]] }, // 2 of the farm's 3 wood delivered, no stone yet
          },
        }),
      ],
      1,
    );
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.builtPct).toBe(25);
    expect(model.construction?.hpPct).toBe(25); // the sim ramps Health with built — the gauge's source
    // One row per construction cost line (the farm's wood+stone parcel), delivered read off the hold.
    expect(model.construction?.rows).toEqual([
      expect.objectContaining({ goodType: GOOD_WOOD, delivered: 2, needed: 3 }),
      expect.objectContaining({ goodType: GOOD_STONE, delivered: 0, needed: 2 }),
    ]);
    // A finished building carries no construction model (the marker is gone).
    const finished = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_FARM)], 1),
      new Set([1]),
      sandboxCtx(),
    );
    expect(finished.kind === 'building' && finished.construction).toBeNull();
  });

  it('offers Upgrade on a built chained home and Cancel on a running upgrade site — never both', () => {
    const built = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_HOME_00)], 1),
      new Set([1]),
      sandboxCtx(),
    );
    expect(built.kind === 'building' && built.upgradable).toBe(true);
    expect(built.kind === 'building' && built.cancelable).toBe(false);
    // The Upgrade button's hover tooltip lists the next tier's own bill (home level 1: wood 4, stone 3),
    // not the from-scratch cumulative cost — the level difference the sim actually charges.
    expect(built.kind === 'building' && built.upgradeCost).toEqual([
      expect.objectContaining({ goodType: GOOD_WOOD, amount: 4 }),
      expect.objectContaining({ goodType: GOOD_STONE, amount: 3 }),
    ]);

    const upgrading = buildUnitPanelModel(
      snapshotOf(
        [
          buildingEntity(1, BUILDING_HOME_00, {
            built: 0,
            components: {
              UnderConstruction: { labor: 0 },
              Upgrading: { savedStock: [] },
              Stockpile: { amounts: [] },
            },
          }),
        ],
        1,
      ),
      new Set([1]),
      sandboxCtx(),
    );
    expect(upgrading.kind === 'building' && upgrading.upgradable).toBe(false);
    expect(upgrading.kind === 'building' && upgrading.cancelable).toBe(true);
    // No Upgrade button on a running upgrade site, so no cost preview to show.
    expect(upgrading.kind === 'building' && upgrading.upgradeCost).toEqual([]);
  });

  it('keeps Magazyn rows in declared slot order while amounts change (Pszenica before Mąka, always)', () => {
    // The mill declares wheat then flour; holding ONLY the second slot's good must not bubble it above
    // the first — a compact store's two rows swapping mid-work read as a glitch (user feedback
    // 2026-07-11). Held-first reordering is the big tabbed store's draw-time concern, not the model's.
    const snapshot = snapshotOf(
      [
        buildingEntity(1, BUILDING_MILL, {
          components: { Stockpile: { amounts: [[GOOD_FLOUR, 3]] } }, // flour held, wheat momentarily empty
        }),
      ],
      1,
    );
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.stock.map((r) => [r.goodType, r.amount])).toEqual([
      [GOOD_WHEAT, 0],
      [GOOD_FLOUR, 3],
    ]);
  });

  it('labels a good by its localized content name when one is loaded (Mąka, not "flour")', () => {
    // The browser entries feed sandboxContent a per-locale good-name map (content/good-names.ts); the
    // model's labels must prefer that `name` over the machine id — the Produkcja row read "flour x1".
    const ctx = sandboxCtx();
    const named = {
      ...ctx,
      goods: ctx.goods.map((g) => (g.typeId === GOOD_FLOUR ? { ...g, name: 'Mąka' } : g)),
    };
    const snapshot = snapshotOf(
      [buildingEntity(1, BUILDING_MILL, { components: { Stockpile: { amounts: [] } } })],
      1,
    );
    const model = buildUnitPanelModel(snapshot, new Set([1]), named);
    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.production?.kind).toBe('recipe');
    if (model.production?.kind !== 'recipe') return;
    expect(model.production.rows[0]?.label).toBe('Mąka');
    expect(model.production.rows[0]?.goodId).toBe('flour'); // the icon key stays the machine id
  });

  it('lists each worker trade with its own filled/capacity (Druid 1/1 · Tragarz 0/1 · Zbieracz 0/1)', () => {
    const DRUID_HUT = 35;
    const sim = createSceneSim(sandboxScene);
    const druidSlot = sim.content.buildings.find((b) => b.typeId === DRUID_HUT)?.workers[0]; // Druid, declared first
    if (druidSlot === undefined) throw new Error('druid hut has no worker slots');
    const snapshot = snapshotOf([
      buildingEntity(1, DRUID_HUT),
      // One settler bound here as the Druid trade — that slot is filled, the carrier/gatherer slots empty.
      { id: 2, components: { Settler: { jobType: druidSlot.jobType }, JobAssignment: { workplace: 1 } } },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
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
    const settlerModel = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    expect(settlerModel.kind).toBe('settler');
    if (settlerModel.kind !== 'settler') return;
    expect(settlerModel.profession).toBe('Druid');
  });

  it('shows the Ogólne bars in order with pinned labels, satisfaction levels and hover values', () => {
    // Needs are rising fixed-point DEFICITS; the bars must show the satisfaction LEVEL (100 − need).
    const snapshot = snapshotOf([
      {
        id: 1,
        components: {
          Settler: { tribe: 1, hunger: ONE / 4, fatigue: ONE / 2, enjoyment: 0, piety: (ONE * 9) / 10 },
          Health: { hitpoints: 300, max: 1000 },
        },
      },
      // The same needs without a Health component — the Zdrowie bar must be omitted, not zeroed.
      { id: 2, components: { Settler: { tribe: 1, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 } } },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
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

    const bare = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    if (bare.kind !== 'settler') throw new Error('expected a settler model');
    expect(bare.bars.map((b) => b.label)).toEqual(['Głód', 'Sen', 'Towarzystwo', 'Religia']);
  });

  it('hides the need bars for a cared-for baby (only Zdrowie), keeps them for a child', () => {
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Settler: { tribe: 1, jobType: JOB_BABY_MALE, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 },
            Age: { ticks: 0 },
            Health: { hitpoints: 300, max: 300 },
          },
        },
        {
          id: 2,
          components: {
            Settler: { tribe: 1, jobType: JOB_CHILD_MALE, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 },
            Age: { ticks: 9000 },
            Health: { hitpoints: 300, max: 300 },
          },
        },
      ],
    };

    // A baby's needs never accumulate (the NeedsSystem skips it whole), so its bars would always read
    // 100% — the panel hides them and shows only the real Health pool.
    const baby = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (baby.kind !== 'settler') throw new Error('expected a settler model');
    expect(baby.bars.map((b) => b.label)).toEqual(['Zdrowie']);

    // A child self-feeds/rests, so its needs are live state — the full bar set stays.
    const child = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    if (child.kind !== 'settler') throw new Error('expected a settler model');
    expect(child.bars.map((b) => b.label)).toEqual(['Zdrowie', 'Głód', 'Sen', 'Towarzystwo', 'Religia']);
  });

  it('offers remove-from-home only to a housed adult (not the homeless, not a child)', () => {
    const snapshot = snapshotOf([
      // A housed adult: has a Residence, no Age — the remove button is live.
      { id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Residence: { home: 9 } } },
      // A homeless adult: no Residence — nothing to remove.
      { id: 2, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } } },
      // A housed child: it moves with its parents, never on its own.
      {
        id: 3,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 },
          Age: { ticks: 9000 },
          Residence: { home: 9 },
        },
      },
    ]);

    const housed = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (housed.kind !== 'settler') throw new Error('expected a settler model');
    expect(housed.canUnassignHome).toBe(true);

    const homeless = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    if (homeless.kind !== 'settler') throw new Error('expected a settler model');
    expect(homeless.canUnassignHome).toBe(false);

    const child = buildUnitPanelModel(snapshot, new Set([3]), sandboxCtx());
    if (child.kind !== 'settler') throw new Error('expected a settler model');
    expect(child.canUnassignHome).toBe(false);
  });

  it('bands a bar level into green/orange/red tones at the named thresholds', () => {
    expect(barTone(100)).toBe('ok');
    expect(barTone(50)).toBe('ok'); // ≥50 stays green
    expect(barTone(49)).toBe('warn');
    expect(barTone(25)).toBe('warn'); // ≥25 stays orange
    expect(barTone(24)).toBe('critical');
    expect(barTone(0)).toBe('critical');
  });

  it('offers every collector resource plus all in the Praca section and reflects the selected filter', () => {
    const snapshot = snapshotOf([
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          WorkFlag: { flag: 2, radius: 24, goodType: GOOD_STONE },
        },
      },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');

    expect(model.work.gatherChoices.map((choice) => choice.goodType)).toEqual([
      null,
      GOOD_WOOD,
      GOOD_STONE,
      GOOD_MUD,
      GOOD_IRON,
      GOOD_GOLD,
      GOOD_MUSHROOM,
    ]);
    expect(model.work.selectedGood).toBe(GOOD_STONE);
    expect(model.work.product).toBe(
      model.work.gatherChoices.find((choice) => choice.goodType === GOOD_STONE)?.label,
    );
  });

  it('shows a farm as "Farma" with fields production and a single wheat stock row', () => {
    const field = (id: number, farm: number, stage: number): WorldSnapshot['entities'][number] => ({
      id,
      components: { Crop: { farm, stage, stages: 5 } },
    });
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_FARM, { components: { Stockpile: { amounts: [[GOOD_WHEAT, 3]] } } }),
      field(2, 1, 1), // growing
      field(3, 1, 4), // growing
      field(4, 1, 5), // ripe
      field(5, 99, 5), // another farm's field — never counted here
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
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

  it('shows a settler equipment section with labeled rows, worn goods, use percentages and empty slots', () => {
    const { snapshot, ctx } = equipmentWorld();
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
    const { snapshot, ctx } = equipmentWorld();
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
