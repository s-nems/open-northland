import { ONE, systems, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { shelterCapacityById } from '../src/catalog/defence.js';
import {
  JOB_BABY_MALE,
  JOB_CHILD_MALE,
  JOB_COLLECTOR,
  JOB_HUNTER,
  JOB_SOLDIER,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { STOCK_TAB_COUNT } from '../src/content/gui-atlas-map.js';
import {
  BUILDING_ANIMAL_FARM,
  BUILDING_BARRACKS,
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_MILL,
  BUILDING_WATCHTOWER,
  GOOD_CATTLE,
  GOOD_FLOUR,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_LEATHER,
  GOOD_MEAT,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_SHEEP,
  GOOD_SHOES,
  GOOD_STONE,
  GOOD_TOOL_WOODEN,
  GOOD_WHEAT,
  GOOD_WOOD,
  GOOD_WOOL,
} from '../src/game/sandbox/ids/index.js';
import { num } from '../src/game/snapshot.js';
import {
  barTone,
  buildUnitPanelModel,
  HUMANWINDOW,
  remainingPct,
  type SettlerPanelModel,
  type UnitPanelModelContext,
} from '../src/hud/details-panel/index.js';
import type { PanelBar } from '../src/hud/details-panel/model/index.js';
import { equipmentScene } from '../src/scenes/equipment.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { buildingEntity, ctxOf, sandboxCtx, snapshotOf } from './support/sandbox.js';

/** The equipment scene's first-tick snapshot + its content context - the preamble both equipment
 *  tests open with. */
function equipmentWorld(): { snapshot: WorldSnapshot; ctx: UnitPanelModelContext } {
  const sim = createSceneSim(equipmentScene);
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
    // The stock list is the HQ's ACCEPTED goods (its `stock` slots), each shown even at 0 - so every
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
            // TWO in-flight plank batches at different progress - the plank row bars the front-runner.
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
    // The production row carries its output's string id - the icon key the panel draws beside the bar -
    // and its recipe-inputs tooltip line ("Wymaga: <wood> ×1").
    expect(model.production.rows[0]?.goodId).toBe('plank');
    expect(model.production.rows[0]?.inputs).toContain('×1');
    expect(model.stock).toEqual(
      expect.arrayContaining([expect.objectContaining({ goodType: GOOD_WOOD, amount: 3 })]),
    );
    // The joinery also lists its other accepted goods at 0 (its stock slots beyond the held wood).
    expect(model.stock.some((r) => r.amount === 0)).toBe(true);
    // Rows keep the DECLARED slot order (wood is the joinery's first slot) - stable while amounts
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
    // A site carries the health gauge too: the sim ramps its hitpoints with `built`, so the bar fills as
    // the foundation rises (user rule - a house under construction shows its HP growing).
    expect(model.health).toEqual({ label: 'Zdrowie', pct: 25, hover: '25/100' });
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

  it('gives a building the settler Zdrowie bar off its Health pool', () => {
    /** The panel's health bar for a farm holding `hitpoints`/1000. */
    const healthOfBuilding = (hitpoints: number): PanelBar | null => {
      const model = buildUnitPanelModel(
        snapshotOf(
          [buildingEntity(1, BUILDING_FARM, { components: { Health: { hitpoints, max: 1000 } } })],
          1,
        ),
        new Set([1]),
        sandboxCtx(),
      );
      if (model.kind !== 'building') throw new Error('expected a building panel');
      return model.health;
    };

    // Same shape as a settler's health bar: pinned label, hp/max gauge, raw points in the hover value.
    expect(healthOfBuilding(300)).toEqual({ label: 'Zdrowie', pct: 30, hover: '300/1000' });
    // Damage moves the model, which is what makes the drawn bar follow the building's hitpoints.
    expect(healthOfBuilding(120)).toEqual({ label: 'Zdrowie', pct: 12, hover: '120/1000' });

    // A building whose type declares no hitpoints carries no bar at all (never a zeroed one).
    const poolless = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_FARM)], 1),
      new Set([1]),
      sandboxCtx(),
    );
    expect(poolless.kind === 'building' && poolless.health).toBeNull();
  });

  it("keeps an upgrade site's two numbers apart: standing health beside 0% built", () => {
    const model = buildUnitPanelModel(
      snapshotOf(
        [
          buildingEntity(1, BUILDING_FARM, {
            built: 0,
            components: {
              UnderConstruction: { labor: 0 },
              Upgrading: { savedStock: [] },
              Health: { hitpoints: 1000, max: 1000 },
              Stockpile: { amounts: [] },
            },
          }),
        ],
        1,
      ),
      new Set([1]),
      sandboxCtx(),
    );
    if (model.kind !== 'building') throw new Error('expected a building panel');
    // The sim never ramps an upgrading building's pool (`construction.ts` skips the ramp for
    // `Upgrading`): the old tier stands at full health while `built` restarts from 0. Both readouts are
    // real and different - the panel must not render one of them twice.
    expect(model.builtPct).toBe(0);
    expect(model.health).toEqual({ label: 'Zdrowie', pct: 100, hover: '1000/1000' });
  });

  it('retains the upgrade control and its explanation when technology blocks it', () => {
    const model = buildUnitPanelModel(snapshotOf([buildingEntity(1, BUILDING_HOME_00)], 1), new Set([1]), {
      ...sandboxCtx(),
      technologyReason: () => 'Requires collector',
    });
    expect(model.kind === 'building' && model.upgradable).toBe(true);
    expect(model.kind === 'building' && model.upgradeBlockedReason).toBe('Requires collector');
  });

  it('offers Upgrade on a built chained home and Cancel on a running upgrade site - never both', () => {
    const built = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_HOME_00)], 1),
      new Set([1]),
      sandboxCtx(),
    );
    expect(built.kind === 'building' && built.upgradable).toBe(true);
    expect(built.kind === 'building' && built.cancelable).toBe(false);
    // The Upgrade button's hover tooltip lists the next tier's own bill (home level 1: wood 4, stone 3),
    // not the from-scratch cumulative cost - the level difference the sim actually charges.
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
    // the first - a compact store's two rows swapping mid-work read as a glitch (user feedback
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
    // model's labels must prefer that `name` over the machine id - the Produkcja row read "flour x1".
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
      // One settler bound here as the Druid trade - that slot is filled, the carrier/gatherer slots empty.
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

    // Selecting that bound settler must name its trade, not fall back to "Cywil": its `jobType` is the
    // rebased building-slot id, which the profession catalog doesn't carry - so the title resolves through
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
      // The same needs without a Health component - the Zdrowie bar must be omitted, not zeroed.
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

  it('drops every need bar while the needs rule is off, leaving only Zdrowie', () => {
    const settler = {
      Settler: { tribe: 1, hunger: ONE / 4, fatigue: ONE / 2, enjoyment: 0, piety: (ONE * 9) / 10 },
      Health: { hitpoints: 300, max: 1000 },
    };
    const off = snapshotOf([
      { id: 1, components: settler },
      { id: 9, components: { WorldRules: { needsEnabled: false } } },
    ]);

    const model = buildUnitPanelModel(off, new Set([1]), sandboxCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.bars.map((b) => b.label)).toEqual(['Zdrowie']);

    const on = snapshotOf([
      { id: 1, components: settler },
      { id: 9, components: { WorldRules: { needsEnabled: true } } },
    ]);
    const kept = buildUnitPanelModel(on, new Set([1]), sandboxCtx());
    if (kept.kind !== 'settler') throw new Error('expected a settler model');
    expect(kept.bars.map((b) => b.label)).toEqual(['Zdrowie', 'Głód', 'Sen', 'Towarzystwo', 'Religia']);
  });

  it('shows a minor its age in years off the sim rate, and shows an adult none', () => {
    const snapshot = snapshotOf([
      // A four-year-old: exactly on the baby→child boundary, so the ramp must read a whole 4.
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 },
          Age: { ticks: systems.CHILD_AGE_TICKS },
        },
      },
      // One tick short of adulthood - the oldest age the panel can ever render.
      {
        id: 2,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 },
          Age: { ticks: systems.ADULT_AGE_TICKS - 1 },
        },
      },
      // Grown: no Age component at all, so no age is shown.
      { id: 3, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } } },
    ]);

    const four = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (four.kind !== 'settler') throw new Error('expected a settler model');
    expect(four.meta).toContain('Wiek: 4');

    const eleven = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    if (eleven.kind !== 'settler') throw new Error('expected a settler model');
    expect(eleven.meta).toContain('Wiek: 11');

    const adult = buildUnitPanelModel(snapshot, new Set([3]), sandboxCtx());
    if (adult.kind !== 'settler') throw new Error('expected a settler model');
    expect(adult.meta).not.toContain('Wiek');
  });

  it('names each settler civilization instead of printing its tribe code', () => {
    // A seat can field several tribes at once and tribe partitions the economy, so the panel has to
    // say which one a settler belongs to rather than showing a bare number.
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        { id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Owner: { player: 0 } } },
        { id: 2, components: { Settler: { tribe: 4, jobType: JOB_COLLECTOR }, Owner: { player: 0 } } },
      ],
    };
    const viking = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    const saracen = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    if (viking.kind !== 'settler' || saracen.kind !== 'settler') throw new Error('expected settlers');
    expect(viking.meta).toContain('Wikingowie');
    expect(saracen.meta).toContain('Saraceni');
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
            Age: { ticks: systems.CHILD_AGE_TICKS },
            Health: { hitpoints: 300, max: 300 },
          },
        },
      ],
    };

    // No settler still growing carries needs (the NeedsSystem skips every one), so their bars would
    // always read the same - the panel hides them and shows only the real Health pool.
    for (const id of [1, 2]) {
      const young = buildUnitPanelModel(snapshot, new Set([id]), sandboxCtx());
      if (young.kind !== 'settler') throw new Error('expected a settler model');
      expect(young.bars.map((b) => b.label)).toEqual(['Zdrowie']);
    }
  });

  it('offers remove-from-home only to a housed adult (not the homeless, not a child)', () => {
    const snapshot = snapshotOf([
      // A housed adult: has a Residence, no Age - the remove button is live.
      { id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Residence: { home: 9 } } },
      // A homeless adult: no Residence - nothing to remove.
      { id: 2, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } } },
      // A housed child: it moves with its parents, never on its own.
      {
        id: 3,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 },
          Age: { ticks: systems.CHILD_AGE_TICKS },
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

  it('offers remove-work-place only to a posted man (not the unposted, not a child or woman)', () => {
    const snapshot = snapshotOf([
      // A posted tradesman: the release has a binding to drop.
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          JobAssignment: { workplace: 9 },
        },
      },
      // A trade-ful but unposted settler: nothing to release.
      { id: 2, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } } },
      // The two the sim's trade-assignable gate refuses whatever binding they carry.
      {
        id: 3,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE, hunger: 0, fatigue: 0, enjoyment: 0, piety: 0 },
          Age: { ticks: systems.CHILD_AGE_TICKS },
          JobAssignment: { workplace: 9 },
        },
      },
      {
        id: 4,
        components: {
          Settler: { tribe: 1, jobType: JOB_WOMAN },
          Female: {},
          JobAssignment: { workplace: 9 },
        },
      },
    ]);

    const expected = new Map([
      [1, true],
      [2, false],
      [3, false],
      [4, false],
    ]);
    for (const [id, offered] of expected) {
      const model = buildUnitPanelModel(snapshot, new Set([id]), sandboxCtx());
      if (model.kind !== 'settler') throw new Error('expected a settler model');
      expect(model.canUnassignWorkplace, `settler ${id}`).toBe(offered);
    }
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

  // The HQ has no raw meat slot - it banks a hunter's kill as food - so a raw-slot-only menu filter drops
  // Mięso and leaves the settlement's hunter unable to be pinned to his own product. Twin of the sim's
  // forage filter and of `setGatherGood`'s gate, which read the same banked form.
  it('offers an HQ hunter the meat his larder banks as food', () => {
    const snapshot = snapshotOf([
      buildingEntity(2, BUILDING_HEADQUARTERS),
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_HUNTER },
          JobAssignment: { workplace: 2 },
        },
      },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');

    expect(model.work.gatherChoices.map((choice) => choice.goodType)).toContain(GOOD_MEAT);
  });

  it('hides a needforgood-gated ware from the gather menu until the settler earns it', () => {
    const DIG_TRACK = 999; // no jobExperience record - raw XP counts as repeats
    const IRON_REPEATS = 10;
    const ctx = sandboxCtx();
    const tribe = ctx.tribes.find((t) => t.typeId === 1);
    if (tribe === undefined) throw new Error('sandbox tribe missing');
    tribe.jobRequirements.push({
      requirement: 'need',
      target: 'good',
      targetId: GOOD_IRON,
      amount: IRON_REPEATS,
      experienceTypes: [DIG_TRACK],
    });
    const collector = (xp: number): WorldSnapshot =>
      snapshotOf([
        {
          id: 1,
          components: {
            Settler: { tribe: 1, jobType: JOB_COLLECTOR, experience: [[DIG_TRACK, xp]] },
            WorkFlag: { flag: 2, radius: 24 },
          },
        },
      ]);

    const fresh = buildUnitPanelModel(collector(0), new Set([1]), ctx);
    if (fresh.kind !== 'settler') throw new Error('expected a settler model');
    expect(fresh.work.gatherChoices.some((choice) => choice.goodType === GOOD_IRON)).toBe(false);

    const veteran = buildUnitPanelModel(collector(IRON_REPEATS), new Set([1]), ctx);
    if (veteran.kind !== 'settler') throw new Error('expected a settler model');
    expect(veteran.work.gatherChoices.some((choice) => choice.goodType === GOOD_IRON)).toBe(true);
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
      field(5, 99, 5), // another farm's field - never counted here
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
    // The store is the original's wheat-only slot (`logicstock 4 25 0`) - exactly one row, carrying
    // its declared capacity so the panel draws "3.0 / 25.0" (the user-requested ceiling readout).
    expect(
      model.stock.map((r) => ({ goodType: r.goodType, amount: r.amount, capacity: r.capacity })),
    ).toEqual([{ goodType: GOOD_WHEAT, amount: 3, capacity: 25 }]);
  });

  it('shows a settler equipment section with labeled rows, worn goods, condition percentages and empty slots', () => {
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
    // Each row names the sim Equipment field it shows - the slot address an equip order targets.
    expect(civModel.equipmentRows.map((r) => r.group)).toEqual(['boots', 'tool', 'misc']);
    expect(rowOf(civModel, HUMANWINDOW.boots)?.slots[0]).toMatchObject({
      goodId: 'shoes',
      conditionPct: 30,
      occupied: true,
    });
    expect(rowOf(civModel, HUMANWINDOW.boots)?.slots[0]?.label).toBeDefined();
    // The misc row holds the four consumable slots: a worn mead carries a condition percent, a permanent amulet
    // does not, and one slot stays empty.
    const misc = rowOf(civModel, HUMANWINDOW.misc)?.slots ?? [];
    expect(misc).toHaveLength(4);
    expect(misc.some((sl) => sl.goodId === 'mead' && sl.conditionPct === 50)).toBe(true);
    expect(misc.some((sl) => sl.goodId === 'amulet_strength' && sl.conditionPct === null)).toBe(true);
    expect(misc.filter((sl) => sl.goodId === undefined)).toHaveLength(1);
    expect(misc.filter((sl) => !sl.occupied)).toHaveLength(1);

    // The soldier additionally carries the Broń + Zbroja rows, combat gear first - and no Narzędzia
    // row: a fighter keeps no tool (the sim sheds one on enlisting), so the slot is not offered.
    const soldier = snapshot.entities.find(hasWeaponSlot);
    if (soldier === undefined) throw new Error('equipment scene did not place the equipped soldier');
    const solModel = buildUnitPanelModel(snapshot, new Set([soldier.id]), ctx);
    if (solModel.kind !== 'settler') throw new Error('expected a settler model');
    expect(solModel.equipmentRows.map((r) => r.titleId)).toEqual([
      HUMANWINDOW.weapon,
      HUMANWINDOW.armor,
      HUMANWINDOW.boots,
      HUMANWINDOW.misc,
    ]);
    expect(rowOf(solModel, HUMANWINDOW.weapon)?.slots[0]?.goodId).toBe('sword_shord');
    expect(rowOf(solModel, HUMANWINDOW.armor)?.slots[0]?.goodId).toBe('armor_chain');

    // A stray worn tool on a fighter (a scene/spawn fixture - normal play never produces one) still
    // shows its row, so the unit stays visible and can be taken off.
    const strayTool = {
      ...soldier,
      components: {
        ...soldier.components,
        Equipment: {
          ...(soldier.components.Equipment as Record<string, unknown>),
          tool: { goodType: GOOD_TOOL_WOODEN, degreeOfUse: 0 },
        },
      },
    };
    const straySnapshot = {
      ...snapshot,
      entities: snapshot.entities.map((e) => (e.id === soldier.id ? strayTool : e)),
    };
    const strayModel = buildUnitPanelModel(straySnapshot, new Set([soldier.id]), ctx);
    if (strayModel.kind !== 'settler') throw new Error('expected a settler model');
    expect(strayModel.equipmentRows.map((r) => r.group)).toContain('tool');
  });

  it('swaps the arms rows for the tool row with the trade, on a settler wearing nothing yet', () => {
    const rowsFor = (jobType: number): string[] => {
      const snapshot = snapshotOf([{ id: 1, components: { Settler: { tribe: 1, jobType } } }]);
      const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
      if (model.kind !== 'settler') throw new Error('expected a settler model');
      return model.equipmentRows.map((r) => r.group);
    };

    // A freshly recruited soldier owns no weapon yet - the arms rows must still be there, or there is
    // no slot to arm him through; his tool row is gone (a fighter keeps none).
    expect(rowsFor(JOB_SOLDIER)).toEqual(['weapon', 'armor', 'boots', 'misc']);
    // Back to a trade: the arms rows go, the tool row returns.
    expect(rowsFor(JOB_COLLECTOR)).toEqual(['boots', 'tool', 'misc']);
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
        .every((sl) => sl.goodId === undefined && sl.conditionPct === null && !sl.occupied),
    ).toBe(true);
  });

  it('lists every trained specialization with repeats and bonus percent, most-trained first', () => {
    // Two content tracks: a good-specific one (labels by the good) and a general one (labels by the job);
    // the third row is a fight bucket (sword, no content track - raw points ARE its repeats).
    const ctx = {
      ...sandboxCtx(),
      jobExperience: [
        {
          typeId: 3,
          id: 'collector_wood',
          jobType: JOB_COLLECTOR,
          goodType: GOOD_WOOD,
          experienceFactor: 10,
        },
        { typeId: 9, id: 'collector_general', jobType: JOB_COLLECTOR, experienceFactor: 100 },
      ],
    };
    const snapshot = snapshotOf([
      {
        id: 1,
        components: {
          Settler: {
            tribe: 1,
            jobType: JOB_COLLECTOR,
            experience: [
              [3, 50], // 50 raw points at rate 10 → 5 wood gathered
              [9, 100], // 100 raw points at rate 100 → 1 repeat
              [systems.FIGHT_EXPERIENCE_TYPE.SWORD, 4], // 4 hits - under 5 hits/repeat, so +0% damage
            ],
          },
        },
      },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), ctx);
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // Repeats descending; the curve percents pin the shared bonus formula (5→52%, 1→17%) and the fight
    // bucket's own damage scale (4 hits sit under its 5-hits-per-repeat step, so it buys +0% yet).
    expect(model.experience.map((r) => ({ repeats: r.repeats, bonusPct: r.bonusPct }))).toEqual([
      { repeats: 5, bonusPct: 52 },
      { repeats: 4, bonusPct: 0 },
      { repeats: 1, bonusPct: 17 },
    ]);
    expect(model.experience[0]?.label).toBe('Zbieracz Drewna'); // hand-translated trackLabels entry
    expect(model.experience[1]?.label).toBe('Walka - Miecz'); // the sword fight bucket's weapon label
    expect(model.experience[2]?.label).not.toMatch(/Specjalizacja/); // general track labels by its job
  });

  it('floors the remaining-condition percent, so any wear at all reads below 100', () => {
    expect(remainingPct(undefined)).toBe(100); // fresh (absent degreeOfUse)
    expect(remainingPct(0)).toBe(100);
    // A barely-worn item must never claim freshness: taking it off would still destroy it.
    expect(remainingPct(1)).toBe(99);
    expect(remainingPct(Math.round(ONE * 0.004))).toBe(99);
    expect(remainingPct(ONE / 2)).toBe(50);
    expect(remainingPct(ONE)).toBe(0);
  });
});

describe('settler upcoming-unlock rows', () => {
  const WOOD_TRACK = 3;
  // A tribe requirement table exercising every filter: one live unlock in progress, a fighter-band
  // target, an already-met threshold, and a requirement on a track this job never accrues.
  const GATED_JOB = 9;
  const SOLDIER_JOB = 33;
  const MET_JOB = 11;
  const FOREIGN_JOB = 12;
  const unlockCtx = (): UnitPanelModelContext => {
    const base = sandboxCtx();
    const tribe = base.tribes[0];
    if (tribe === undefined) throw new Error('sandbox has no tribe');
    return {
      ...base,
      jobExperience: [
        {
          typeId: WOOD_TRACK,
          id: 'collector_wood',
          jobType: JOB_COLLECTOR,
          goodType: GOOD_WOOD,
          experienceFactor: 10,
        },
      ],
      tribes: [
        {
          ...tribe,
          typeId: 1,
          jobRequirements: [
            {
              requirement: 'need',
              target: 'job',
              targetId: GATED_JOB,
              amount: 10,
              experienceTypes: [WOOD_TRACK],
            },
            {
              requirement: 'need',
              target: 'job',
              targetId: SOLDIER_JOB,
              amount: 5,
              experienceTypes: [WOOD_TRACK],
            },
            {
              requirement: 'need',
              target: 'job',
              targetId: MET_JOB,
              amount: 3,
              experienceTypes: [WOOD_TRACK],
            },
            { requirement: 'need', target: 'job', targetId: FOREIGN_JOB, amount: 10, experienceTypes: [99] },
          ],
        },
      ],
    };
  };
  const collector = (id: number) => ({
    id,
    components: {
      Settler: { tribe: 1, jobType: JOB_COLLECTOR, experience: [[WOOD_TRACK, 40]] }, // 4 repeats
    },
  });

  it('shows repeats-progress toward reachable unmet gates only (no fighters, no met, no foreign)', () => {
    const model = buildUnitPanelModel(snapshotOf([collector(1)]), new Set([1]), unlockCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // Only the in-progress civilian gate survives: the soldier target is barracks territory, the met
    // threshold has nothing left to promise, and the foreign-track requirement isn't this job's path.
    expect(model.upcomingUnlocks.map((r) => ({ current: r.current, required: r.required }))).toEqual([
      { current: 4, required: 10 },
    ]);
    expect(model.upcomingUnlocks[0]?.label).toContain('4/10');
    expect(model.upcomingUnlocks[0]?.label).toContain('Zbieracz Drewna'); // the tracked path named
  });

  it('shows nothing while profession progression is off (the ProgressionRules singleton)', () => {
    const snapshot = snapshotOf([
      collector(1),
      { id: 99, components: { ProgressionRules: { professionProgressionEnabled: false } } },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), unlockCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.upcomingUnlocks).toEqual([]);
    expect(model.experience.length).toBeGreaterThan(0); // trained rows still show - only promises hide
  });
});

describe('the animal farm panel - fed-animal tokens stay internal', () => {
  it('hides the token stock rows and folds production into two chain rows with ware icons', () => {
    const snapshot = snapshotOf([buildingEntity(1, BUILDING_ANIMAL_FARM)]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (model.kind !== 'building') throw new Error('expected a building model');

    const stocked = model.stock.map((r) => r.goodType);
    expect(stocked).not.toContain(GOOD_SHEEP);
    expect(stocked).not.toContain(GOOD_CATTLE);
    expect(stocked).toContain(GOOD_WOOL);

    if (model.production?.kind !== 'recipe') throw new Error('expected recipe production');
    expect(model.production.rows.map((r) => r.goodType)).toEqual([GOOD_SHEEP, GOOD_CATTLE]);
    const [sheep, cattle] = model.production.rows;
    expect(sheep?.goodId).toBe('meat'); // the chain's wares: meat byproduct + the converter's product
    expect(sheep?.extraGoodIds).toEqual(['wool']);
    expect(cattle?.extraGoodIds).toEqual(['leather']);
    expect(sheep?.inputs.split('\n')).toHaveLength(3); // water + wheat + the penned animal itself
  });

  it("a breeder's craft toggles offer the chain wares, never the tokens or the slaughter row", () => {
    const sim = createSceneSim(sandboxScene);
    const slot = sim.content.buildings.find((b) => b.typeId === BUILDING_ANIMAL_FARM)?.workers[0];
    if (slot === undefined) throw new Error('animal farm has no worker slots');
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_ANIMAL_FARM),
      { id: 2, components: { Settler: { jobType: slot.jobType }, JobAssignment: { workplace: 1 } } },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([2]), ctxOf(sim));
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.work.craftChoices.map((c) => c.goodType)).toEqual([GOOD_WOOL, GOOD_LEATHER]);
  });

  it('offers the defence window only to a building type that takes a garrison', () => {
    const sim = createSceneSim(sandboxScene);
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_WATCHTOWER),
      buildingEntity(2, BUILDING_JOINERY),
      buildingEntity(3, BUILDING_BARRACKS),
    ]);
    const ctx = ctxOf(sim);

    const tower = buildUnitPanelModel(snapshot, new Set([1]), ctx);
    const workshop = buildUnitPanelModel(snapshot, new Set([2]), ctx);
    const barracks = buildUnitPanelModel(snapshot, new Set([3]), ctx);

    if (tower.kind !== 'building' || workshop.kind !== 'building' || barracks.kind !== 'building') {
      throw new Error('expected buildings');
    }
    expect(tower.showDefense).toBe(true);
    expect(workshop.showDefense).toBe(false);
    // The barracks carries the source flag too (`houses.ini` logictype 39), so it raises the alarm.
    expect(barracks.showDefense).toBe(true);
  });

  it('reports the raised alarm and how full the garrison is', () => {
    const sim = createSceneSim(sandboxScene);
    const capacity = shelterCapacityById('tower_00');
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_WATCHTOWER, { components: { DefenceMode: {} } }),
      // One claimant already inside, one still running there: both hold a place, so both count.
      { id: 2, components: { Settler: { jobType: JOB_COLLECTOR }, Sheltering: { shelter: 1 } } },
      {
        id: 3,
        components: {
          Settler: { jobType: JOB_COLLECTOR },
          Sheltering: { shelter: 1 },
          Resting: { at: 1 },
        },
      },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxOf(sim));

    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.defenseEnabled).toBe(true);
    expect(model.defenseLabel).toContain(`2/${capacity}`);
    // The same claimants take the workers window, so its headline and count line read for the garrison
    // rather than leaving "Tragarz 0/3" standing over a field of sheltering civilians.
    expect(model.garrison).toEqual({ sheltered: 2, capacity });
  });

  it('leaves the workers window to the workers once nobody is sheltering', () => {
    const sim = createSceneSim(sandboxScene);
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_WATCHTOWER, { components: { DefenceMode: {} } }),
      { id: 2, components: { Settler: { jobType: JOB_COLLECTOR } } }, // at work, no claim
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxOf(sim));

    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.defenseEnabled).toBe(true); // the alarm alone does not take the window
    expect(model.garrison).toBeNull();
  });
});
