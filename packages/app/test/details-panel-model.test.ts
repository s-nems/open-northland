import { fx, ONE, PRODUCTION_UNLIMITED, systems, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { shelterCapacityById } from '../src/catalog/defence.js';
import {
  JOB_BABY_MALE,
  JOB_BUILDER,
  JOB_CHILD_MALE,
  JOB_COLLECTOR,
  JOB_HERO_AXE,
  JOB_HERO_SABER,
  JOB_HERO_SPEAR,
  JOB_HERO_SWORD,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_HUNTER,
  JOB_SOLDIER,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { STOCK_TAB_COUNT } from '../src/content/gui-atlas-map.js';
import {
  BUILDING_ANIMAL_FARM,
  BUILDING_BARRACKS,
  BUILDING_FARM,
  BUILDING_HANDCART_YARD,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_HOME_02,
  BUILDING_JOINERY,
  BUILDING_JOINERY_02,
  BUILDING_MILL,
  BUILDING_WATCHTOWER,
  GOOD_CATTLE,
  GOOD_CROCKERY,
  GOOD_FLOUR,
  GOOD_FURNITURE,
  GOOD_GOLD,
  GOOD_HANDCART,
  GOOD_HOLY_OIL,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_OXCART,
  GOOD_PLANK,
  GOOD_SHEEP,
  GOOD_SHOES,
  GOOD_STONE,
  GOOD_TOOL_IRON,
  GOOD_TOOL_WOODEN,
  GOOD_WHEAT,
  GOOD_WOOD,
  GOOD_WOOL,
} from '../src/game/sandbox/ids/index.js';
import { num } from '../src/game/snapshot.js';
import { fixedViewerSeat } from '../src/game/viewer-seat.js';
import {
  barTone,
  buildUnitPanelModel,
  remainingPct,
  type SettlerPanelModel,
  type UnitPanelModelContext,
} from '../src/hud/details-panel/index.js';
import { goodLabel, jobDisplayName } from '../src/hud/details-panel/model/context.js';
import { experienceShown } from '../src/hud/details-panel/model/index.js';
import { currentLocale, installNameOverlay, messages } from '../src/i18n/index.js';
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
  it('shows the man before the woman in a home even when she has the lower id', () => {
    const snapshot = snapshotOf([
      buildingEntity(20, BUILDING_HOME_00),
      {
        id: 1,
        components: {
          Settler: { jobType: JOB_WOMAN, tribe: 1 },
          Female: {},
          Marriage: { spouse: 2, child: 3 },
          Residence: { home: 20 },
        },
      },
      {
        id: 2,
        components: {
          Settler: { jobType: JOB_COLLECTOR, tribe: 1 },
          Marriage: { spouse: 1, child: 3 },
          Residence: { home: 20 },
        },
      },
      {
        id: 3,
        components: {
          Settler: { jobType: JOB_CHILD_MALE, tribe: 1 },
          Age: { ticks: 0 },
          Residence: { home: 20 },
        },
      },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([20]), sandboxCtx());
    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.staff?.groups.map((family) => family.people.map((person) => person.entity))).toEqual([
      [2, 1, 3],
    ]);
    expect(model.staff?.groups[0]?.people.map((person) => person.look)).toEqual(['man', 'woman', 'child']);
  });

  it("keeps a site's posted workers and a home site's residents beside its builders", () => {
    const site = { built: ONE / 4, components: { UnderConstruction: { labor: ONE / 4 } } };
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_JOINERY, site),
      buildingEntity(20, BUILDING_HOME_00, site),
      {
        id: 2,
        components: { Settler: { jobType: JOB_COLLECTOR, tribe: 1 }, JobAssignment: { workplace: 1 } },
      },
      { id: 3, components: { Settler: { jobType: JOB_BUILDER, tribe: 1 }, SiteAssignment: { site: 1 } } },
      { id: 4, components: { Settler: { jobType: JOB_COLLECTOR, tribe: 1 }, Residence: { home: 20 } } },
    ]);
    const workshop = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (workshop.kind !== 'building') throw new Error('expected a building model');
    expect(workshop.crew?.groups[0]?.people.map((person) => person.entity)).toEqual([3]);
    expect(workshop.staff?.kind).toBe('workers');
    expect(workshop.staff?.groups.flatMap((group) => group.people.map((person) => person.entity))).toEqual([
      2,
    ]);
    const home = buildUnitPanelModel(snapshot, new Set([20]), sandboxCtx());
    if (home.kind !== 'building') throw new Error('expected a building model');
    expect(home.staff?.kind).toBe('residents');
    expect(home.staff?.groups.map((family) => family.people.map((person) => person.entity))).toEqual([[4]]);
  });

  it('shows the generic hero profession for every hero job instead of a body-specific name', () => {
    const base = sandboxCtx();
    const heroes = [
      [JOB_HERO_UNARMED, 'hero_unarmed', 'Bohater'],
      [JOB_HERO_SPEAR, 'hero_spear_siegfried', 'Bohater'],
      [JOB_HERO_SWORD, 'hero_sword_bjarni', 'Bohater'],
      [JOB_HERO_SABER, 'hero_saber_hatschi', 'Bohater'],
      [JOB_HERO_AXE, 'hero_axe', 'Bohater'],
      [JOB_HEROINE_BOW, 'heroine_bow_xena', 'Bohater'],
    ] as const;
    const ctx = {
      ...base,
      jobs: heroes.map(([typeId, id]) => ({ typeId, id, allowedAtomics: [], forbiddenAtomics: [] })),
    };

    for (const [typeId, , label] of heroes) expect(jobDisplayName(ctx, typeId)).toBe(label);
  });

  it('names the map-placed jester through the locale catalog instead of its job slug', () => {
    const JOB_JESTER = 28; // `jobtypes.ini` 28
    const ctx = {
      ...sandboxCtx(),
      jobs: [{ typeId: JOB_JESTER, id: 'jester', name: 'jester', allowedAtomics: [], forbiddenAtomics: [] }],
    };
    expect(jobDisplayName(ctx, JOB_JESTER)).toBe('Błazen');
  });

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
    expect(model.orders?.alarm).toEqual({ on: false });
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
              experience: [],
            },
            SettlerNeeds: {
              hunger: 0,
              fatigue: 0,
              piety: 0,
              enjoyment: 0,
              asOf: 0,
              drain: 'none',
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
    expect(model.production.rows[0]).toMatchObject({
      goodType: GOOD_PLANK,
      pct: 50,
      running: true,
      label: messages().goods.plank,
    });
    // The production row carries its output's string id - the icon key the panel draws beside the bar -
    // and its ingredient against the shelf: one wood a cycle, three held.
    expect(model.production.rows[0]?.goodId).toBe('plank');
    expect(model.production.rows[0]?.inputs).toEqual([
      expect.objectContaining({ goodType: GOOD_WOOD, have: 3, need: 1 }),
    ]);
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
    expect(model.staff?.groups).toEqual([
      expect.objectContaining({
        label: 'Zbieracz',
        people: [expect.objectContaining({ entity: 2 })],
        capacity: 1,
      }),
    ]);
    expect(model.staff?.count).toEqual({ filled: 1, capacity: 1 });
    // The running batch is what the status strip names.
    expect(model.status).toEqual({ label: 'Pracuje', detail: messages().goods.plank, tone: 'ok' });
  });

  it('models a construction site: delivered/needed/inbound materials, stall reason, and health ramp', () => {
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
        {
          id: 2,
          components: {
            Settler: { tribe: 1, jobType: JOB_BUILDER },
            SupplyRun: { site: 1, goodType: GOOD_STONE, amount: 1 },
            PickupClaim: { source: 9, goodType: GOOD_STONE, amount: 1 },
            MoveGoal: { cell: 3 },
          },
        },
        {
          id: 3,
          components: {
            Settler: { tribe: 1, jobType: JOB_BUILDER },
            // No route, load, or atomic: the sim's inbound tally treats this as awaiting cleanup.
            SupplyRun: { site: 1, goodType: GOOD_STONE, amount: 1 },
          },
        },
      ],
      1,
    );
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.construction).toMatchObject({ pct: 25, upgrade: false });
    // A site carries the health gauge too: the sim ramps its hitpoints with `built`, so the bar fills as
    // the foundation rises (user rule - a house under construction shows its HP growing).
    expect(model.health).toEqual({ hitpoints: 25, max: 100 });
    expect(model.status).toEqual({ label: 'Budowa', detail: '25% · brak budowniczego', tone: 'trouble' });
    // Both builders on a supply run for the site show among its crew.
    expect(model.crew?.groups[0]?.people.map((person) => person.entity)).toEqual([2, 3]);
    // One row per construction cost line (the farm's wood+stone parcel): delivered reads off the hold,
    // while inbound is the live SupplyRun reservation and remains separate from delivered stock.
    expect(model.construction?.rows).toEqual([
      expect.objectContaining({ goodType: GOOD_WOOD, delivered: 2, inbound: 0, needed: 3 }),
      expect.objectContaining({ goodType: GOOD_STONE, delivered: 0, inbound: 1, needed: 2 }),
    ]);
    expect(model.construction?.status).toBe('no-builder');
    // A finished building carries no construction model (the marker is gone).
    const finished = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_FARM)], 1),
      new Set([1]),
      sandboxCtx(),
    );
    expect(finished.kind === 'building' && finished.construction).toBeNull();
  });

  it('reports only construction blockers the snapshot proves', () => {
    const site = (labor: number, stock: readonly (readonly [number, number])[] = []) =>
      buildingEntity(1, BUILDING_FARM, {
        components: { UnderConstruction: { labor }, Stockpile: { amounts: stock } },
      });
    const modelOf = (entities: Parameters<typeof snapshotOf>[0], ctx = sandboxCtx()) => {
      const model = buildUnitPanelModel(snapshotOf(entities), new Set([1]), ctx);
      if (model.kind !== 'building' || model.construction === null) {
        throw new Error('expected a construction model');
      }
      return model.construction;
    };

    expect(modelOf([site(0)]).status).toBe('missing-materials');
    expect(
      modelOf([
        site(0),
        {
          id: 2,
          components: {
            Settler: { tribe: 1, jobType: JOB_BUILDER },
            SupplyRun: { site: 1, goodType: GOOD_WOOD, amount: 1 },
            PickupClaim: { source: 9, goodType: GOOD_WOOD, amount: 1 },
            MoveGoal: { cell: 3 },
          },
        },
      ]).status,
    ).toBe('delivery-en-route');
    expect(modelOf([site(0, [[GOOD_WOOD, 3]])]).status).toBe('no-builder');
    expect(
      modelOf([
        site(0, [[GOOD_WOOD, 3]]),
        {
          id: 2,
          components: {
            Settler: { tribe: 1, jobType: JOB_BUILDER },
            SiteAssignment: { site: 1, pinned: false },
          },
        },
      ]).status,
    ).toBeNull();

    const base = sandboxCtx();
    const thirds = {
      ...base,
      buildings: base.buildings.map((building) =>
        building.typeId === BUILDING_FARM
          ? { ...building, construction: [{ goodType: GOOD_WOOD, amount: 3 }] }
          : building,
      ),
    };
    expect(modelOf([site(fx.div(fx.fromInt(1), fx.fromInt(3)), [[GOOD_WOOD, 1]])], thirds).status).toBe(
      'missing-materials',
    );
  });

  it('names a manually pinned foundation as the builder actual site, ignoring automatic crew membership', () => {
    const builder = (pinned: boolean) => ({
      id: 2,
      components: {
        Settler: { tribe: 1, jobType: JOB_BUILDER },
        SiteAssignment: { site: 1, pinned },
      },
    });
    const foundation = buildingEntity(1, BUILDING_HOME_00, {
      built: 0,
      components: { UnderConstruction: { labor: 0 }, Stockpile: { amounts: [] } },
    });

    const pinned = buildUnitPanelModel(snapshotOf([foundation, builder(true)]), new Set([2]), sandboxCtx());
    if (pinned.kind !== 'settler') throw new Error('expected a settler model');
    expect(pinned.workplace?.target).toMatchObject({ id: 1, label: expect.stringContaining('Dom') });

    const automatic = buildUnitPanelModel(
      snapshotOf([foundation, builder(false)]),
      new Set([2]),
      sandboxCtx(),
    );
    if (automatic.kind !== 'settler') throw new Error('expected a settler model');
    expect(automatic.workplace?.target ?? null).toBeNull();
  });

  it('gives a building the settler Zdrowie bar off its Health pool', () => {
    /** The panel's health bar for a farm holding `hitpoints`/1000. */
    const healthOfBuilding = (hitpoints: number): { hitpoints: number; max: number } | null => {
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

    expect(healthOfBuilding(300)).toEqual({ hitpoints: 300, max: 1000 });
    // Damage moves the model, which is what makes the drawn bar follow the building's hitpoints.
    expect(healthOfBuilding(120)).toEqual({ hitpoints: 120, max: 1000 });

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
    expect(model.construction).toMatchObject({ pct: 0, upgrade: true });
    expect(model.health).toEqual({ hitpoints: 1000, max: 1000 });
  });

  it('retains the upgrade control and its explanation when technology blocks it', () => {
    const model = buildUnitPanelModel(snapshotOf([buildingEntity(1, BUILDING_HOME_00)], 1), new Set([1]), {
      ...sandboxCtx(),
      technologyReason: () => 'Requires collector',
    });
    expect(model.kind === 'building' && model.orders?.upgrade?.control).toBe('Requires collector');
  });

  it('shows exact household durability, remaining uses, and the mature home holy fire', () => {
    const quality = { cooking: 240, rest: 75, piety: 2000 };
    const mature = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(1, BUILDING_HOME_02, {
          components: {
            Building: { buildingType: BUILDING_HOME_02, tribe: 1, built: ONE, level: 2 },
            HomeQuality: quality,
          },
        }),
        {
          id: 99,
          components: { HouseholdGoodPolicy: { player: 0, cooking: true, rest: true, piety: true } },
        },
      ]),
      new Set([1]),
      sandboxCtx(),
    );
    if (mature.kind !== 'building') throw new Error('expected a building panel');
    expect(mature.homeQuality?.rows).toEqual([
      expect.objectContaining({
        effect: 'cooking',
        goodId: 'crockery',
        value: 240,
        capacity: 500,
        uses: 48,
      }),
      expect.objectContaining({
        effect: 'rest',
        goodId: 'furniture',
        value: 75,
        capacity: 500,
        uses: 15,
      }),
      expect.objectContaining({
        effect: 'piety',
        goodId: 'holy_oil',
        value: 2000,
        capacity: 5000,
        holyFireActive: true,
      }),
    ]);
    expect(mature.homeQuality?.rows.find((row) => row.effect === 'piety')?.uses).toBeUndefined();
    expect(mature.homeQuality?.rows.map((row) => row.goodId)).toEqual([
      sandboxCtx().goods.find((good) => good.typeId === GOOD_CROCKERY)?.id,
      sandboxCtx().goods.find((good) => good.typeId === GOOD_FURNITURE)?.id,
      sandboxCtx().goods.find((good) => good.typeId === GOOD_HOLY_OIL)?.id,
    ]);

    const young = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(1, BUILDING_HOME_00, {
          components: { HomeQuality: quality },
        }),
      ]),
      new Set([1]),
      sandboxCtx(),
    );
    if (young.kind !== 'building') throw new Error('expected a building panel');
    expect(young.homeQuality?.rows.map((row) => row.effect)).toEqual(['cooking', 'rest']);

    const dry = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(1, BUILDING_HOME_02, {
          components: {
            Building: { buildingType: BUILDING_HOME_02, tribe: 1, built: ONE, level: 2 },
            HomeQuality: { ...quality, piety: 0 },
          },
        }),
        {
          id: 99,
          components: { HouseholdGoodPolicy: { player: 0, cooking: true, rest: false, piety: false } },
        },
      ]),
      new Set([1]),
      sandboxCtx(),
    );
    if (dry.kind !== 'building') throw new Error('expected a building panel');
    expect(dry.homeQuality?.rows.find((row) => row.effect === 'piety')?.holyFireActive).toBe(false);
    expect(dry.homeQuality?.rows.find((row) => row.effect === 'rest')?.allowed).toBe(false);

    const retainedOil = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(1, BUILDING_HOME_02, {
          components: {
            Building: { buildingType: BUILDING_HOME_02, tribe: 1, built: ONE, level: 2 },
            HomeQuality: quality,
          },
        }),
        {
          id: 99,
          components: { HouseholdGoodPolicy: { player: 0, cooking: true, rest: true, piety: false } },
        },
      ]),
      new Set([1]),
      sandboxCtx(),
    );
    if (retainedOil.kind !== 'building') throw new Error('expected a building panel');
    expect(retainedOil.homeQuality?.rows.find((row) => row.effect === 'piety')).toMatchObject({
      value: 2000,
      allowed: false,
      holyFireActive: false,
    });

    const site = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(1, BUILDING_HOME_02, {
          built: 0,
          components: {
            Building: { buildingType: BUILDING_HOME_02, tribe: 1, built: 0, level: 2 },
            HomeQuality: quality,
            UnderConstruction: { labor: 0 },
          },
        }),
      ]),
      new Set([1]),
      sandboxCtx(),
    );
    if (site.kind !== 'building') throw new Error('expected a building panel');
    expect(site.homeQuality).toBeNull();

    // Another seat's home keeps its wares to itself; a whole-map viewer sees them but may not set
    // another owner's policy.
    const foreign = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_HOME_00, { components: { Owner: { player: 1 } } })]),
      new Set([1]),
      sandboxCtx(),
    );
    if (foreign.kind !== 'building') throw new Error('expected a building panel');
    expect(foreign.foreign).toBe(true);
    expect(foreign.homeQuality).toBeNull();
    const overseen = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_HOME_00, { components: { Owner: { player: 1 } } })]),
      new Set([1]),
      { ...sandboxCtx(), viewer: { seat: () => 0, wholeMap: () => true, version: () => 0 } },
    );
    if (overseen.kind !== 'building') throw new Error('expected a building panel');
    expect(overseen.homeQuality?.control).toBe(messages().hud.buildingPanel.policyForeign);
    expect(mature.homeQuality?.control).toBe(true);
    expect(mature.homeQuality?.player).toBe(0);
  });

  it('offers no Upgrade on a type without a higher tier', () => {
    const top = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_MILL)], 1),
      new Set([1]),
      sandboxCtx(),
    );
    if (top.kind !== 'building') throw new Error('expected a building panel');
    expect(top.orders?.upgrade).toBeNull();
  });

  it('offers Upgrade on a built chained home and Cancel in its place on a running upgrade site', () => {
    const built = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_HOME_00)], 1),
      new Set([1]),
      sandboxCtx(),
    );
    if (built.kind !== 'building') throw new Error('expected a building panel');
    expect(built.orders?.upgrade?.control).toBe(true);
    expect(built.orders?.cancelUpgrade).toBe(false);
    // The Upgrade button's tooltip lists the next tier's own bill (home level 1: wood 4, stone 3), not
    // the from-scratch cumulative cost - the level difference the sim actually charges.
    expect(built.orders?.upgrade?.cost).toEqual([
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
    if (upgrading.kind !== 'building') throw new Error('expected a building panel');
    // A running upgrade site offers Cancel in Upgrade's place; Upgrade itself waits for the house.
    expect(upgrading.orders?.upgrade?.control).toBe(messages().hud.buildingPanel.upgradeUnfinished);
    expect(upgrading.orders?.cancelUpgrade).toBe(true);
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

  it('labels a good by its catalog name, which an installed overlay replaces (Mąka, not "flour")', () => {
    const snapshot = snapshotOf(
      [buildingEntity(1, BUILDING_MILL, { components: { Stockpile: { amounts: [] } } })],
      1,
    );
    installNameOverlay(currentLocale(), { goods: { flour: 'Mąka' } });
    try {
      const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
      if (model.kind !== 'building') throw new Error('expected a building model');
      if (model.production?.kind !== 'recipe') throw new Error('expected a recipe');
      expect(model.production.rows[0]?.label).toBe('Mąka');
      expect(model.production.rows[0]?.goodId).toBe('flour'); // the icon key stays the machine id
    } finally {
      installNameOverlay(currentLocale(), {});
    }
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
    expect(model.staff?.groups.map((r) => `${r.label} ${r.people.length}/${r.capacity}`)).toEqual([
      'Druid 1/1',
      'Tragarz 0/1',
      'Zbieracz 0/1',
    ]);

    // Selecting that bound settler must name its trade, not fall back to "Civilian": its `jobType` is the
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
          Settler: { tribe: 1 },
          SettlerNeeds: {
            hunger: ONE / 4,
            fatigue: ONE / 2,
            enjoyment: 0,
            piety: (ONE * 9) / 10,
            asOf: 0,
            drain: 'none',
          },
          Health: { hitpoints: 300, max: 1000 },
        },
      },
      // The same needs without a Health component - the Health bar must be omitted, not zeroed.
      {
        id: 2,
        components: {
          Settler: { tribe: 1 },
          SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
        },
      },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // Pinned labels (deliberately diverging from the decoded humanwindow 12–14 stat names), in the
    // fixed Health → Food → Sleep → Company → Religion order.
    expect(model.bars.map((b) => b.label)).toEqual(['Zdrowie', 'Sytość', 'Sen', 'Towarzystwo', 'Religia']);
    // Health: gauge = hp/max percent, hover = the raw points.
    expect(model.bars[0]).toMatchObject({ pct: 30, hover: '300/1000' });
    // Needs: gauge = satisfaction level, hover = the same level as a percent.
    expect(model.bars[1]).toMatchObject({ pct: 75, hover: '75%' }); // hunger 25% → 75% sated
    expect(model.bars[2]).toMatchObject({ pct: 50, hover: '50%' });
    expect(model.bars[3]).toMatchObject({ pct: 100, hover: '100%' });
    expect(model.bars[4]).toMatchObject({ pct: 10, hover: '10%' });

    const bare = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    if (bare.kind !== 'settler') throw new Error('expected a settler model');
    expect(bare.bars.map((b) => b.label)).toEqual(['Sytość', 'Sen', 'Towarzystwo', 'Religia']);
  });

  it('drops every need bar while the needs rule is off, leaving only Zdrowie', () => {
    const settler = {
      Settler: { tribe: 1 },
      SettlerNeeds: {
        hunger: ONE / 4,
        fatigue: ONE / 2,
        enjoyment: 0,
        piety: (ONE * 9) / 10,
        asOf: 0,
        drain: 'none',
      },
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
    expect(kept.bars.map((b) => b.label)).toEqual(['Zdrowie', 'Sytość', 'Sen', 'Towarzystwo', 'Religia']);
  });

  it('shows a minor its age in years off the sim rate, and shows an adult none', () => {
    const snapshot = snapshotOf([
      // A four-year-old: exactly on the baby→child boundary, so the ramp must read a whole 4.
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE },
          SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
          Age: { ticks: systems.CHILD_AGE_TICKS },
        },
      },
      // One tick short of adulthood - the oldest age the panel can ever render.
      {
        id: 2,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE },
          SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
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
    expect(adult.meta).toBeNull();
  });

  it("names another seat's settler's civilization instead of printing its tribe code", () => {
    // A seat can field several tribes at once and tribe partitions the economy, so the owner line has
    // to say which one another seat's settler belongs to rather than showing a bare number.
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        { id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Owner: { player: 0 } } },
        { id: 2, components: { Settler: { tribe: 4, jobType: JOB_COLLECTOR }, Owner: { player: 0 } } },
      ],
    };
    const watcher = { ...sandboxCtx(), viewer: fixedViewerSeat(1) };
    const viking = buildUnitPanelModel(snapshot, new Set([1]), watcher);
    const saracen = buildUnitPanelModel(snapshot, new Set([2]), watcher);
    if (viking.kind !== 'settler' || saracen.kind !== 'settler') throw new Error('expected settlers');
    expect(viking.foreign).toBe(true);
    expect(viking.meta).toContain('Wikingowie');
    expect(saracen.meta).toContain('Saraceni');
    // The seat's own settler has nothing to say on that line.
    const own = buildUnitPanelModel(snapshot, new Set([1]), { ...sandboxCtx(), viewer: fixedViewerSeat(0) });
    if (own.kind !== 'settler') throw new Error('expected a settler');
    expect(own.meta).toBeNull();
  });

  it('hides the need bars for a cared-for baby (only Zdrowie), keeps them for a child', () => {
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        {
          id: 1,
          components: {
            Settler: { tribe: 1, jobType: JOB_BABY_MALE },
            SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
            Age: { ticks: 0 },
            Health: { hitpoints: 300, max: 300 },
          },
        },
        {
          id: 2,
          components: {
            Settler: { tribe: 1, jobType: JOB_CHILD_MALE },
            SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
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
      buildingEntity(9, BUILDING_HOME_00),
      // A housed adult: has a Residence, no Age - the remove button is live.
      { id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Residence: { home: 9 } } },
      // A homeless adult: no Residence - nothing to remove.
      { id: 2, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } } },
      // A housed child: it moves with its parents, never on its own.
      {
        id: 3,
        components: {
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE },
          SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
          Age: { ticks: systems.CHILD_AGE_TICKS },
          Residence: { home: 9 },
        },
      },
    ]);

    const housed = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (housed.kind !== 'settler') throw new Error('expected a settler model');
    expect(housed.home?.remove).toBe(true);

    const homeless = buildUnitPanelModel(snapshot, new Set([2]), sandboxCtx());
    if (homeless.kind !== 'settler') throw new Error('expected a settler model');
    expect(homeless.home?.target).toBeNull();
    expect(homeless.home?.remove).toBeNull();

    const child = buildUnitPanelModel(snapshot, new Set([3]), sandboxCtx());
    if (child.kind !== 'settler') throw new Error('expected a settler model');
    expect(child.home).toMatchObject({ assign: null, remove: null });
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
          Settler: { tribe: 1, jobType: JOB_CHILD_MALE },
          SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
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
      expect(model.workplace?.remove === true, `settler ${id}`).toBe(offered);
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

  it('lists every collector resource in the Produkcja section with its counter', () => {
    const snapshot = snapshotOf([
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          WorkFlag: { flag: 2, radius: 24 },
          ProductionCounters: {
            counters: [
              [GOOD_WOOD, 0],
              [GOOD_STONE, 3],
            ],
            cursor: 0,
          },
        },
      },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');

    expect(model.production?.kind).toBe('gather');
    expect(model.production?.rows.map((row) => row.goodType)).toEqual([
      GOOD_WOOD,
      GOOD_STONE,
      GOOD_MUD,
      GOOD_IRON,
      GOOD_GOLD,
      GOOD_MUSHROOM,
    ]);
    const open = PRODUCTION_UNLIMITED;
    expect(model.production?.rows.map((row) => row.count)).toEqual([0, 3, open, open, open, open]);
  });

  // `jobtypes.ini` marks the hunter `userCanChangeProductionFlag 0`: the sim ignores its counters, so
  // the panel lists no products for him, at his HQ post and at his flag alike.
  it('lists no products for the hunter, whose production the player cannot set', () => {
    const posted = snapshotOf([
      buildingEntity(2, BUILDING_HEADQUARTERS),
      { id: 1, components: { Settler: { tribe: 1, jobType: JOB_HUNTER }, JobAssignment: { workplace: 2 } } },
    ]);
    const model = buildUnitPanelModel(posted, new Set([1]), sandboxCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.workplace?.target?.id).toBe(2);
    expect(model.production).toBeNull();

    const flagged = snapshotOf([
      {
        id: 1,
        components: { Settler: { tribe: 1, jobType: JOB_HUNTER }, WorkFlag: { flag: 2, radius: 24 } },
      },
    ]);
    const atFlag = buildUnitPanelModel(flagged, new Set([1]), sandboxCtx());
    if (atFlag.kind !== 'settler') throw new Error('expected a settler model');
    expect(atFlag.production).toBeNull();
  });

  it('names the building the person stepped into, for the portrait to frame', () => {
    const inside = snapshotOf([
      buildingEntity(2, BUILDING_HEADQUARTERS),
      { id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Resting: { at: 2 } } },
    ]);
    const model = buildUnitPanelModel(inside, new Set([1]), sandboxCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.inside).toBe(2);

    const outside = snapshotOf([{ id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } } }]);
    const walking = buildUnitPanelModel(outside, new Set([1]), sandboxCtx());
    if (walking.kind !== 'settler') throw new Error('expected a settler model');
    expect(walking.inside).toBeNull();
  });

  it('locks a needforgood-gated ware in the gather list until the settler earns it', () => {
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
            Settler: { tribe: 1, jobType: JOB_COLLECTOR },
            SettlerProgress: { experience: [[DIG_TRACK, xp]] },
            WorkFlag: { flag: 2, radius: 24 },
          },
        },
      ]);

    const fresh = buildUnitPanelModel(collector(0), new Set([1]), ctx);
    if (fresh.kind !== 'settler') throw new Error('expected a settler model');
    const ironOf = (model: SettlerPanelModel) =>
      model.production?.rows.find((row) => row.goodType === GOOD_IRON);
    expect(ironOf(fresh)?.locked).toContain(`0/${IRON_REPEATS}`);

    const veteran = buildUnitPanelModel(collector(IRON_REPEATS), new Set([1]), ctx);
    if (veteran.kind !== 'settler') throw new Error('expected a settler model');
    expect(ironOf(veteran)?.locked).toBeNull();
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
      label: messages().goods.wheat,
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

  it('counts ripe map fields within a farm plot in its production panel', () => {
    const mapField = (id: number, tileX: number, tileY: number) => ({
      id,
      components: {
        Position: { x: tileX * ONE, y: tileY * ONE },
        Crop: { farm: null, goodType: GOOD_WHEAT, stage: 5, stages: 5 },
      },
    });
    // The farm stands on node (8, 8); a node is half a tile, so the 16-node plot reaches 8 tiles along an
    // axis, and the node distance sums both axes.
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_FARM, {
        components: { Position: { x: fx.fromInt(4), y: fx.fromInt(4) } },
      }),
      mapField(2, 5, 4),
      mapField(3, 30, 4), // far off the plot
      mapField(4, 12, 4), // node (24, 8): on the plot's edge
      mapField(5, 12.5, 4), // node (25, 8): one node past it
      mapField(6, 8, 8), // node (16, 16): the edge diagonally
      mapField(7, 8.5, 8), // node (17, 16): one node past it
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    expect(model.kind).toBe('building');
    if (model.kind !== 'building') return;
    expect(model.production).toMatchObject({ kind: 'fields', sown: 3, growing: 0, ripe: 3 });
  });

  it('shows a settler equipment section with labeled rows, worn goods, condition percentages and empty slots', () => {
    const { snapshot, ctx } = equipmentWorld();
    const bootsGood = (e: (typeof snapshot.entities)[number]): number | undefined =>
      num((e.components.Equipment as { boots?: { goodType?: unknown } } | undefined)?.boots?.goodType);
    const hasWeaponSlot = (e: (typeof snapshot.entities)[number]): boolean =>
      (e.components.Equipment as { weapon?: unknown } | undefined)?.weapon != null;
    const rowOf = (m: SettlerPanelModel, group: string) => m.equipmentRows.find((r) => r.group === group);

    // The equipped civilian: boots = shoes, no weapon slot → Shoes / Tools / Equipment rows only.
    const civ = snapshot.entities.find((e) => bootsGood(e) === GOOD_SHOES && !hasWeaponSlot(e));
    if (civ === undefined) throw new Error('equipment scene did not place the equipped civilian');
    const civModel = buildUnitPanelModel(snapshot, new Set([civ.id]), ctx);
    if (civModel.kind !== 'settler') throw new Error('expected a settler model');
    expect(civModel.name).toMatch(/^\S+$/);
    expect(civModel.name.length).toBeGreaterThan(0);
    expect(civModel.equipmentRows.map((r) => r.group)).toEqual(['boots', 'tool', 'misc']);
    // Each row names the sim Equipment field it shows - the slot address an equip order targets.
    expect(civModel.equipmentRows.map((r) => r.group)).toEqual(['boots', 'tool', 'misc']);
    expect(rowOf(civModel, 'boots')?.slots[0]).toMatchObject({
      goodId: 'shoes',
      conditionPct: 30,
      occupied: true,
    });
    expect(rowOf(civModel, 'boots')?.slots[0]?.label).toBeDefined();
    // The misc row holds the four consumable slots: a worn mead carries a condition percent, a permanent amulet
    // does not, and one slot stays empty.
    const misc = rowOf(civModel, 'misc')?.slots ?? [];
    expect(misc).toHaveLength(4);
    expect(misc.some((sl) => sl.goodId === 'mead' && sl.conditionPct === 50)).toBe(true);
    expect(misc.some((sl) => sl.goodId === 'amulet_strength' && sl.conditionPct === null)).toBe(true);
    expect(misc.filter((sl) => sl.goodId === undefined)).toHaveLength(1);
    expect(misc.filter((sl) => !sl.occupied)).toHaveLength(1);

    // The soldier additionally carries the Weapon + Armor rows, combat gear first - and no Tools
    // row: a fighter keeps no tool (the sim sheds one on enlisting), so the slot is not offered.
    const soldier = snapshot.entities.find(hasWeaponSlot);
    if (soldier === undefined) throw new Error('equipment scene did not place the equipped soldier');
    const solModel = buildUnitPanelModel(snapshot, new Set([soldier.id]), ctx);
    if (solModel.kind !== 'settler') throw new Error('expected a settler model');
    expect(solModel.equipmentRows.map((r) => r.group)).toEqual(['weapon', 'armor', 'boots', 'misc']);
    expect(rowOf(solModel, 'weapon')?.slots[0]?.goodId).toBe('sword_shord');
    expect(rowOf(solModel, 'armor')?.slots[0]?.goodId).toBe('armor_chain');

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

  it('gives a woman and a child a worker’s slots, none wearable, and no experience section', () => {
    const trained = { SettlerProgress: { experience: [[systems.FIGHT_EXPERIENCE_TYPE.FIST, 5]] } };
    const modelFor = (jobType: number, extra: Record<string, unknown>) => {
      const snapshot = snapshotOf([
        { id: 1, components: { Settler: { tribe: 1, jobType }, ...trained, ...extra } },
      ]);
      const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
      if (model.kind !== 'settler') throw new Error('expected a settler model');
      return model;
    };
    for (const model of [
      modelFor(JOB_WOMAN, { Female: { female: true } }),
      modelFor(JOB_COLLECTOR, { Age: { ticks: 0 } }),
    ]) {
      expect(model.equipmentRows.map((row) => row.group)).toEqual(['boots', 'tool', 'misc']);
      expect(model.equipmentRows.every((row) => !row.wearable)).toBe(true);
      expect(model.experience).toEqual([]);
    }
    expect(modelFor(JOB_COLLECTOR, {}).experience.length).toBeGreaterThan(0);
  });

  it('shows a hero without need bars and with a read-only permanent loadout', () => {
    const baseCtx = sandboxCtx();
    const ctx = {
      ...baseCtx,
      jobs: [
        ...baseCtx.jobs,
        {
          typeId: JOB_HERO_SABER,
          id: 'hero_saber_hatschi',
          allowedAtomics: [],
          forbiddenAtomics: [],
        },
      ],
    };
    const weaponGood = ctx.goods.find((good) => good.equip?.category === 'weapon');
    if (weaponGood === undefined) throw new Error('sandbox content has no weapon good');
    const armorGood = ctx.goods.find((good) => good.equip?.category === 'armor');
    if (armorGood === undefined) throw new Error('sandbox content has no armor good');
    const snapshot = snapshotOf([
      {
        id: 1,
        components: {
          Settler: {
            tribe: 1,
            jobType: JOB_HERO_SABER,
            experience: [],
          },
          SettlerNeeds: {
            hunger: ONE,
            fatigue: ONE,
            piety: ONE,
            enjoyment: ONE,
            asOf: 0,
            drain: 'none',
          },
          Health: { hitpoints: 300, max: 300 },
          Owner: { player: 0 },
          Equipment: {
            boots: null,
            tool: null,
            weapon: { goodType: weaponGood.typeId, degreeOfUse: 0 },
            armor: { goodType: armorGood.typeId, degreeOfUse: 0 },
            misc: [null, null, null, null],
          },
        },
      },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctx);
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.name).toBe('Hatchie');
    expect(model.profession).toBe('Bohater');
    expect(model.bars).toHaveLength(1);
    expect(model.equipmentRows.find((row) => row.group === 'weapon')?.slots[0]?.occupied).toBe(true);
    expect(model.equipmentRows.find((row) => row.group === 'armor')?.slots[0]?.occupied).toBe(true);
    expect(model.equipmentRows.every((row) => !row.wearable)).toBe(true);
  });

  it('uses a map-authored hero name ahead of the reused hero body name', () => {
    const baseCtx = sandboxCtx();
    const ctx = {
      ...baseCtx,
      jobs: [
        ...baseCtx.jobs,
        {
          typeId: JOB_HERO_SABER,
          id: 'hero_saber_hatschi',
          allowedAtomics: [],
          forbiddenAtomics: [],
        },
      ],
      mapText: (stringId: number) => (stringId === 100 ? 'Ykol' : undefined),
    };
    const snapshot = snapshotOf([
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_HERO_SABER },
          SettlerProgress: { experience: [] },
          ScriptedName: { stringId: 100 },
        },
      },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctx);
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.name).toBe('Ykol');
    expect(model.profession).toBe('Bohater');
  });

  it('shows empty equipment rows for a settler with no Equipment component', () => {
    const { snapshot, ctx } = equipmentWorld();
    const bare = snapshot.entities.find(
      (e) => e.components.Settler !== undefined && e.components.Equipment === undefined,
    );
    if (bare === undefined) throw new Error('equipment scene did not place an unequipped settler');
    const model = buildUnitPanelModel(snapshot, new Set([bare.id]), ctx);
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // The base rows still show (Shoes, Tools, Equipment), all empty; no weapon/armour row.
    expect(model.equipmentRows.map((r) => r.group)).toEqual(['boots', 'tool', 'misc']);
    expect(
      model.equipmentRows
        .flatMap((r) => r.slots)
        .every((sl) => sl.goodId === undefined && sl.conditionPct === null && !sl.occupied),
    ).toBe(true);
  });

  it('lists every trained specialization with repeats and bonus percent, own trade first', () => {
    // Two content tracks: a good-specific one (labels by the good) and a general one (labels by the job);
    // the third row is a fight bucket (sword, no content track - raw points ARE its repeats).
    const ctx = {
      ...sandboxCtx(),
      jobExperience: [
        {
          typeId: 3,
          id: 'collector_wood',
          jobType: JOB_COLLECTOR,
          goodTypes: [GOOD_WOOD],
          experienceFactor: 10,
          baseRepeatCounter: 10,
        },
        {
          typeId: 9,
          id: 'collector_general',
          jobType: JOB_COLLECTOR,
          goodTypes: [],
          experienceFactor: 100,
          baseRepeatCounter: 10,
        },
      ],
    };
    const snapshot = snapshotOf([
      {
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          SettlerProgress: {
            experience: [
              [3, 50], // 50 raw points at rate 10 → 5 wood gathered, half a curve point
              [9, 100], // 100 raw points at rate 100 → 1 repeat, one curve point
              [systems.FIGHT_EXPERIENCE_TYPE.SWORD, 4], // 4 hits: 100 * 200 / 196, so +2% damage
            ],
          },
        },
      },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), ctx);
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // The collector's own tracks lead, repeats descending; the percents read the curve in raw hundredths
    // (50 raw → 0%, 100 raw → 17%) and the fight bucket's own damage factor (4 hits: +2%).
    expect(model.experience.map((r) => ({ repeats: r.repeats, bonusPct: r.bonusPct, own: r.own }))).toEqual([
      { repeats: 5, bonusPct: 0, own: true },
      { repeats: 1, bonusPct: 17, own: true },
      { repeats: 4, bonusPct: 2, own: false },
    ]);
    expect(model.experience[0]?.label).toBe('Zbieracz Drewna'); // hand-translated trackLabels entry
    expect(model.experience[1]?.label).not.toMatch(/Specjalizacja/); // general track labels by its job
    expect(model.experience[2]?.label).toBe('Walka - Miecz'); // the sword fight bucket's weapon label
    // Both own rows show before the fold; the sword row waits behind "1 more".
    expect(experienceShown(model.experience)).toBe(2);
  });

  it('rounds the remaining-condition percent, with any wear below 100 and a live item above 0', () => {
    expect(remainingPct(undefined)).toBe(100); // fresh (absent degreeOfUse)
    expect(remainingPct(0)).toBe(100);
    // A barely-worn item must never claim freshness: taking it off would still destroy it.
    expect(remainingPct(1)).toBe(99);
    expect(remainingPct(Math.round(ONE * 0.004))).toBe(99);
    expect(remainingPct(ONE / 2)).toBe(50);
    expect(remainingPct(ONE - 1)).toBe(1);
    expect(remainingPct(ONE)).toBe(0);
  });

  it('reads a five-sip bottle in whole fifths, though each sip wears a hair over one', () => {
    const sip = Math.ceil(ONE / 5);
    expect([1, 2, 3, 4].map((sips) => remainingPct(sips * sip))).toEqual([80, 60, 40, 20]);
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
  const SEA_JOB = 26;
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
          goodTypes: [GOOD_WOOD],
          experienceFactor: 10,
          baseRepeatCounter: 10,
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
            // The sea trader needs a harbour the game has none of: never a promise, however near.
            {
              requirement: 'need',
              target: 'job',
              targetId: SEA_JOB,
              amount: 5,
              experienceTypes: [WOOD_TRACK],
            },
            // A ware gate on the same track: shown as a good's row after the nearer job row.
            {
              requirement: 'need',
              target: 'good',
              targetId: GOOD_IRON,
              amount: 20,
              experienceTypes: [WOOD_TRACK],
            },
          ],
        },
      ],
    };
  };
  const collector = (id: number) => ({
    id,
    components: {
      Settler: { tribe: 1, jobType: JOB_COLLECTOR },
      SettlerProgress: { experience: [[WOOD_TRACK, 40]] }, // 4 repeats
    },
  });

  it('shows repeats-progress toward reachable unmet gates only (no fighters, no met, no foreign, no sea)', () => {
    const model = buildUnitPanelModel(snapshotOf([collector(1)]), new Set([1]), unlockCtx());
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    // The in-progress civilian job gate and the ware gate survive, nearest first: the soldier target is
    // barracks territory, the met threshold has nothing left to promise, the foreign-track requirement
    // isn't this job's path, and the sea trade is off the profession roster.
    expect(
      model.upcomingUnlocks.map((r) => ({ unlocks: r.unlocks, current: r.current, required: r.required })),
    ).toEqual([
      { unlocks: jobDisplayName(unlockCtx(), GATED_JOB), current: 4, required: 10 },
      { unlocks: goodLabel(unlockCtx(), GOOD_IRON), current: 4, required: 20 },
    ]);
    expect(model.upcomingUnlocks[0]?.track).toBe('Zbieracz Drewna'); // the tracked path named
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

describe('the animal farm panel - the species rows are its herd', () => {
  it('keeps the herd rows out of Magazyn and makes them the Produkcja rows, counted', () => {
    const snapshot = snapshotOf([
      // The snapshot's stockpile is the sim's Map flattened to pairs, which is what the rows must read.
      buildingEntity(1, BUILDING_ANIMAL_FARM, { components: { Stockpile: { amounts: [[GOOD_SHEEP, 3]] } } }),
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), sandboxCtx());
    if (model.kind !== 'building') throw new Error('expected a building model');

    const stocked = model.stock.map((r) => r.goodType);
    expect(stocked).not.toContain(GOOD_SHEEP);
    expect(stocked).not.toContain(GOOD_CATTLE);
    expect(stocked).toContain(GOOD_WOOL);

    if (model.production?.kind !== 'recipe') throw new Error('expected recipe production');
    expect(model.production.rows.map((r) => r.goodType)).toEqual([GOOD_SHEEP, GOOD_CATTLE]);
    const [sheep, cattle] = model.production.rows;
    expect(sheep?.goodId).toBe('sheep'); // the species itself, not a ware its slaughter yields
    expect(sheep?.label).toContain('3/20'); // the herd attached to the farm against the row's cap
    expect(cattle?.label).toContain('0/20'); // no cattle attached yet
    expect(sheep?.inputs).toHaveLength(2); // what one breeding costs: water + wheat
  });

  it("a breeder's production rows offer the two herds it may tend", () => {
    const sim = createSceneSim(sandboxScene);
    const slot = sim.content.buildings.find((b) => b.typeId === BUILDING_ANIMAL_FARM)?.workers[0];
    if (slot === undefined) throw new Error('animal farm has no worker slots');
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_ANIMAL_FARM),
      { id: 2, components: { Settler: { jobType: slot.jobType }, JobAssignment: { workplace: 1 } } },
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([2]), ctxOf(sim));
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    expect(model.production?.kind).toBe('craft');
    expect(model.production?.rows.map((row) => row.goodType)).toEqual([GOOD_SHEEP, GOOD_CATTLE]);
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
    expect(tower.orders?.alarm).toEqual({ on: false });
    expect(workshop.orders?.alarm).toBeNull();
    // The barracks carries the source flag too (`houses.ini` logictype 39), so it raises the alarm.
    expect(barracks.orders?.alarm).toEqual({ on: false });
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
    expect(model.orders?.alarm).toEqual({ on: true });
    expect(model.status).toEqual({ label: 'Alarm', detail: `schronieni 2 / ${capacity}`, tone: 'trouble' });
    // The claimants show as their own group, those already inside first.
    expect(model.staff?.groups.find((group) => group.key === 'sheltered')).toMatchObject({
      capacity,
      people: [expect.objectContaining({ entity: 3 }), expect.objectContaining({ entity: 2 })],
    });
  });

  it('lists no sheltered group while nobody is sheltering', () => {
    const sim = createSceneSim(sandboxScene);
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_WATCHTOWER, { components: { DefenceMode: {} } }),
      { id: 2, components: { Settler: { jobType: JOB_COLLECTOR } } }, // at work, no claim
    ]);

    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxOf(sim));

    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.orders?.alarm).toEqual({ on: true });
    expect(model.staff?.groups.some((group) => group.key === 'sheltered')).toBe(false);
  });
});

describe('the joinery and its vehicle yard', () => {
  /** The level-3 joinery's ordinary wares, in its recipe order, beside the carts it raises on yards. */
  const JOINERY_02_WARES = [GOOD_TOOL_WOODEN, GOOD_TOOL_IRON, GOOD_FURNITURE];

  it('lists no production row for a vehicle good, whose yard never runs a cycle', () => {
    const sim = createSceneSim(sandboxScene);
    const snapshot = snapshotOf([buildingEntity(1, BUILDING_JOINERY_02)]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxOf(sim));
    if (model.kind !== 'building') throw new Error('expected a building model');
    if (model.production?.kind !== 'recipe') throw new Error('expected recipe production');
    expect(model.production.rows.map((r) => r.goodType)).toEqual(JOINERY_02_WARES);
  });

  it("keeps both carts among the joiner's craft choices, where the player orders them", () => {
    const sim = createSceneSim(sandboxScene);
    const slot = sim.content.buildings.find((b) => b.typeId === BUILDING_JOINERY_02)?.workers[0];
    if (slot === undefined) throw new Error('joinery has no worker slots');
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_JOINERY_02),
      { id: 2, components: { Settler: { jobType: slot.jobType }, JobAssignment: { workplace: 1 } } },
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([2]), ctxOf(sim));
    if (model.kind !== 'settler') throw new Error('expected a settler model');
    if (model.production?.kind !== 'craft') throw new Error('expected craft production');
    expect(model.production.rows.map((r) => r.goodType)).toEqual([
      ...JOINERY_02_WARES,
      GOOD_HANDCART,
      GOOD_OXCART,
    ]);
    expect(model.production.rows.slice(-2).map((r) => r.goodId)).toEqual(['handcart', 'oxcart']);
  });

  it('titles the yard site by the vehicle it becomes, through the locale table', () => {
    const sim = createSceneSim(sandboxScene);
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_HANDCART_YARD, { built: 0, components: { UnderConstruction: {} } }),
    ]);
    const model = buildUnitPanelModel(snapshot, new Set([1]), ctxOf(sim));
    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.title).toBe(messages().building.handcart);
    expect(model.title).not.toBe('handcart');
  });
});
