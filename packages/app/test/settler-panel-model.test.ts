import { type EntitySnapshot, systems, type TraderView } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_BUILDER,
  JOB_CARRIER,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_HERO_SWORD,
  JOB_HUNTER,
  JOB_SCOUT,
  JOB_SOLDIER,
  JOB_TRADER,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_WAREHOUSE_00,
  GOOD_IRON,
  GOOD_WOOD,
  VEHICLE_HANDCART,
} from '../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { holdsHaulFlagPost } from '../src/game/snapshot.js';
import { vehicleLabel } from '../src/game/technology.js';
import { fixedViewerSeat } from '../src/game/viewer-seat.js';
import { goodLabel } from '../src/hud/details-panel/model/context.js';
import {
  buildUnitPanelModel,
  PRODUCTION_UNLIMITED,
  type SettlerPanelModel,
  type SettlerWorkStatus,
  type UnitPanelModelContext,
} from '../src/hud/details-panel/model/index.js';
import { formatMessage, messages } from '../src/i18n/index.js';
import { buildingEntity, sandboxCtx, snapshotOf } from './support/sandbox.js';

const SETTLER = 1;
const PARTNER = 2;
const CHILD = 3;
const HOME = 10;
const WORKSHOP = 11;
const OTHER_SEAT = 3;
const CART = 12;
const WOOD_ABOARD = 3;
const IRON_ABOARD = 2;
/** An import mark's fill ceiling and source reserve, in units. */
const IRON_CEILING = 10;
const IRON_RESERVE = 2;

const owned = (components: Record<string, unknown>): Record<string, unknown> => ({
  Owner: { player: HUMAN_PLAYER },
  ...components,
});

function settlerModel(
  entities: readonly EntitySnapshot[],
  ctx: UnitPanelModelContext = sandboxCtx(),
  id = SETTLER,
): SettlerPanelModel {
  const model = buildUnitPanelModel(snapshotOf(entities), new Set([id]), ctx);
  if (model.kind !== 'settler') throw new Error(`expected a settler model, got ${model.kind}`);
  return model;
}

/** A sandbox workshop with at least two products whose operator crafts (no gather drive): its type,
 *  the operator trade and the products in recipe order. */
function workshop(ctx: UnitPanelModelContext): { type: number; operator: number; products: number[] } {
  const carrier = (jobType: number) =>
    ctx.jobs.some((j) => j.typeId === jobType && systems.isCarrierJobRow(j));
  for (const def of ctx.buildings) {
    const products = def.recipes.flatMap((recipe) =>
      recipe.outputs[0] === undefined ? [] : [recipe.outputs[0].goodType],
    );
    const operator = def.workers.find((slot) => !carrier(slot.jobType))?.jobType;
    if (products.length < 2 || operator === undefined) continue;
    const probe = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(WORKSHOP, def.typeId),
        {
          id: SETTLER,
          components: owned({
            Settler: { tribe: 1, jobType: operator },
            JobAssignment: { workplace: WORKSHOP },
          }),
        },
      ]),
      new Set([SETTLER]),
      ctx,
    );
    if (probe.kind === 'settler' && probe.production?.kind === 'craft')
      return { type: def.typeId, operator, products };
  }
  throw new Error('the sandbox has no two-product workshop');
}

describe('the settler panel model', () => {
  it('names a settler by the player-given name over the generated one, and the map name over both', () => {
    const named = settlerModel([
      {
        id: SETTLER,
        components: owned({ Settler: { tribe: 1, jobType: JOB_COLLECTOR }, GivenName: { name: 'Bjorn' } }),
      },
    ]);
    expect(named.name).toBe('Bjorn');

    const scripted = settlerModel(
      [
        {
          id: SETTLER,
          components: owned({
            Settler: { tribe: 1, jobType: JOB_COLLECTOR },
            GivenName: { name: 'Bjorn' },
            ScriptedName: { stringId: 7 },
          }),
        },
      ],
      { ...sandboxCtx(), mapText: (id) => (id === 7 ? 'Ykol' : undefined) },
    );
    expect(scripted.name).toBe('Ykol');
  });

  it('links the workplace, the home, the spouse and the growing child by entity id', () => {
    const model = settlerModel([
      buildingEntity(HOME, BUILDING_HOME_00),
      buildingEntity(WORKSHOP, BUILDING_JOINERY),
      {
        id: SETTLER,
        components: owned({
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          JobAssignment: { workplace: WORKSHOP },
          Residence: { home: HOME },
          Marriage: { spouse: PARTNER, child: CHILD },
        }),
      },
      {
        id: PARTNER,
        components: owned({ Settler: { tribe: 1, jobType: JOB_WOMAN }, Female: { female: true } }),
      },
      { id: CHILD, components: owned({ Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Age: { ticks: 0 } }) },
    ]);
    expect(model.role).toBe('worker');
    expect(model.workplace).toMatchObject({ target: { id: WORKSHOP }, assign: true, remove: true });
    expect(model.home).toMatchObject({ target: { id: HOME }, assign: true, remove: true });
    expect(model.family?.partner?.id).toBe(PARTNER);
    expect(model.family?.child?.id).toBe(CHILD);
    expect(model.family?.marry).toBeNull();
  });

  it("offers to centre on a flag gatherer's flag from the work row", () => {
    const gatherer = (components: Record<string, unknown>): SettlerPanelModel =>
      settlerModel([
        { id: SETTLER, components: owned({ Settler: { tribe: 1, jobType: JOB_COLLECTOR }, ...components }) },
      ]);
    expect(gatherer({ WorkFlag: { flag: 77, radius: 32 } }).workplace?.centreFlag).toBe(77);
    expect(gatherer({}).workplace?.centreFlag).toBeNull();
  });

  it('gives a warehouse carrier the work area row, with the remove button once a flag stands', () => {
    const content = sandboxContent();
    const ctx: UnitPanelModelContext = {
      ...sandboxCtx(),
      holdsHaulFlagPost: (snapshot, ent) => holdsHaulFlagPost(content, snapshot, ent),
    };
    const carrier = (components: Record<string, unknown>): EntitySnapshot[] => [
      buildingEntity(WORKSHOP, BUILDING_WAREHOUSE_00),
      {
        id: SETTLER,
        components: owned({
          Settler: { tribe: 1, jobType: JOB_CARRIER },
          JobAssignment: { workplace: WORKSHOP },
          ...components,
        }),
      },
    ];
    expect(settlerModel(carrier({}), ctx).workArea).toEqual({ flag: null, assign: true, remove: null });
    expect(settlerModel(carrier({ HaulFlag: { flag: 99, radius: 32 } }), ctx).workArea).toEqual({
      flag: 99,
      assign: true,
      remove: true,
    });
    const collector = settlerModel(
      [
        buildingEntity(WORKSHOP, BUILDING_WAREHOUSE_00),
        {
          id: SETTLER,
          components: owned({
            Settler: { tribe: 1, jobType: JOB_COLLECTOR },
            JobAssignment: { workplace: WORKSHOP },
          }),
        },
      ],
      ctx,
    );
    expect(collector.workArea).toBeNull();
  });

  it("tells both spouses what holds the wife's child order", () => {
    const couple = (blocked: string | undefined): EntitySnapshot[] => [
      {
        id: SETTLER,
        components: owned({
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          Marriage: { spouse: PARTNER, child: null },
        }),
      },
      {
        id: PARTNER,
        components: owned({
          Settler: { tribe: 1, jobType: JOB_WOMAN },
          Female: { female: true },
          Marriage: { spouse: SETTLER, child: null },
          ChildOrder: { child: 'female', ...(blocked === undefined ? {} : { blocked }) },
        }),
      },
    ];
    const copy = messages().userMessages.familyBlocked;
    const husband = settlerModel(couple('husbandAway'));
    expect(husband.family?.childOnHold?.label).toBe(copy.short.husbandAway);
    expect(husband.family?.childOnHold?.tooltip).toContain(husband.name);
    const wife = settlerModel(couple('husbandAway'), sandboxCtx(), PARTNER);
    expect(wife.family?.childOnHold?.tooltip.startsWith(wife.name)).toBe(true);
    expect(wife.status.detail).toBe(copy.short.husbandAway); // what she stands idle for
    expect(settlerModel(couple(undefined)).family?.childOnHold).toBeNull();
  });

  it('offers the partner search to a free grown man, fades it while he weds, keeps it from a soldier', () => {
    const single = settlerModel([
      { id: SETTLER, components: owned({ Settler: { tribe: 1, jobType: JOB_COLLECTOR } }) },
    ]);
    expect(single.family).toEqual({ partner: null, child: null, marry: true, childOnHold: null });

    const wedding = settlerModel([
      {
        id: SETTLER,
        components: owned({
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          Wedding: { partner: PARTNER, kissing: false },
        }),
      },
    ]);
    expect(wedding.family?.marry).toBe(messages().hud.settlerPanel.weddingUnderWay);

    const soldier = settlerModel([
      { id: SETTLER, components: owned({ Settler: { tribe: 1, jobType: JOB_SOLDIER } }) },
    ]);
    expect(soldier.role).toBe('soldier');
    expect(soldier.family?.marry).toBeNull();
    expect(soldier.workplace).toBeNull();
    expect(soldier.military).toEqual({ stance: null, regeneration: true });
  });

  it('reads a soldier whose eating and sleeping is forbidden', () => {
    const model = settlerModel([
      {
        id: SETTLER,
        components: owned({
          Settler: { tribe: 1, jobType: JOB_SOLDIER },
          Stance: { mode: systems.MILITARY_MODE.DEFEND },
          NoRegeneration: { prohibited: true },
        }),
      },
    ]);
    expect(model.military).toEqual({ stance: systems.MILITARY_MODE.DEFEND, regeneration: false });
  });

  it("shows a builder's road or wall run, and none for another seat's builder", () => {
    const builder = (buildMode: Record<string, unknown>, owner = HUMAN_PLAYER) => ({
      id: SETTLER,
      components: {
        Owner: { player: owner },
        Settler: { tribe: 1, jobType: JOB_BUILDER },
        ...buildMode,
      },
    });
    expect(settlerModel([builder({ BuildMode: { kind: 'roads' } })]).buildRun).toBe('roads');
    expect(settlerModel([builder({ BuildMode: { kind: 'walls' } })]).buildRun).toBe('walls');
    expect(settlerModel([builder({})]).buildRun).toBeNull();
    expect(settlerModel([builder({ BuildMode: { kind: 'roads' } }, OTHER_SEAT)]).buildRun).toBeNull();
  });

  it('gives a man without a trade no workplace row', () => {
    const model = settlerModel([
      { id: SETTLER, components: owned({ Settler: { tribe: 1, jobType: JOB_CIVILIST } }) },
    ]);
    expect(model.role).toBe('civilian');
    expect(model.workplace).toBeNull();
    // Idle with no trade: the line says why, in amber.
    expect(model.status).toMatchObject({ state: 'idle', trouble: true });
    expect(model.status.detail).toBe(messages().hud.settlerPanel.idleReasons.noJob);
  });

  it('reads the craft counters, a missing product never stopping', () => {
    const ctx = sandboxCtx();
    const { type, operator, products } = workshop(ctx);
    const [first, second] = products;
    if (first === undefined || second === undefined) throw new Error('the workshop needs two products');
    const model = settlerModel(
      [
        buildingEntity(WORKSHOP, type),
        {
          id: SETTLER,
          components: owned({
            Settler: { tribe: 1, jobType: operator },
            JobAssignment: { workplace: WORKSHOP },
            ProductionCounters: { counters: [[first, 3]], cursor: 0 },
          }),
        },
      ],
      ctx,
    );
    expect(model.production?.kind).toBe('craft');
    const count = (good: number) => model.production?.rows.find((row) => row.goodType === good)?.count;
    expect(count(first)).toBe(3);
    expect(count(second)).toBe(PRODUCTION_UNLIMITED);
  });

  it('locks a product the technology tree has not opened, with the reason', () => {
    const ctx = sandboxCtx();
    const { type, operator, products } = workshop(ctx);
    const [locked] = products;
    const model = settlerModel(
      [
        buildingEntity(WORKSHOP, type),
        {
          id: SETTLER,
          components: owned({
            Settler: { tribe: 1, jobType: operator },
            JobAssignment: { workplace: WORKSHOP },
          }),
        },
      ],
      {
        ...ctx,
        technologyReason: (kind, typeId) => (kind === 'good' && typeId === locked ? 'Wymaga pieca' : null),
      },
    );
    expect(model.production?.rows.find((row) => row.goodType === locked)?.locked).toBe('Wymaga pieca');
  });

  it('names the product being made and the reason an idle tradesman waits, from the work status', () => {
    const ctx = sandboxCtx();
    const { type, operator, products } = workshop(ctx);
    const [good] = products;
    if (good === undefined) throw new Error('the workshop needs a product');
    const tradesman = (live: Record<string, unknown>): EntitySnapshot => ({
      id: SETTLER,
      components: owned({
        Settler: { tribe: 1, jobType: operator },
        JobAssignment: { workplace: WORKSHOP },
        ...live,
      }),
    });
    const withStatus = (status: SettlerWorkStatus): UnitPanelModelContext => ({
      ...ctx,
      workStatus: () => status,
    });
    const world = (live: Record<string, unknown>) => [buildingEntity(WORKSHOP, type), tradesman(live)];

    const working = settlerModel(
      world({ CurrentAtomic: {} }),
      withStatus({ kind: 'crafting', goodType: good }),
    );
    expect(working.status).toMatchObject({ state: 'working', trouble: false });
    const def = ctx.goods.find((g) => g.typeId === good);
    expect(working.status.detail).toBe(def?.name ?? def?.id);

    const full = settlerModel(
      world({}),
      withStatus({
        kind: 'outputFull',
        outputs: [{ goodType: good, available: 20, capacity: 20, required: 1, destination: 'inReach' }],
      }),
    );
    expect(full.status).toMatchObject({ state: 'idle', trouble: true });
    expect(full.status.detail).toContain('20/20');
    expect(full.status.detail).toContain(def?.name ?? def?.id);

    const waiting = {
      kind: 'waitingInput',
      goodType: good,
      missingInputs: [
        { goodType: GOOD_WOOD, available: 1, required: 3, missing: 2, source: 'inReach', gatheredBy: null },
        { goodType: GOOD_IRON, available: 0, required: 1, missing: 1, source: 'inReach', gatheredBy: null },
      ],
    } as const;
    const waitingModel = settlerModel(world({}), withStatus(waiting));
    expect(waitingModel.status.detail).toBe(
      `${goodLabel(ctx, good)}: brakuje w warsztacie ${goodLabel(ctx, GOOD_WOOD)} ×2 (jest 1/3), ${goodLabel(ctx, GOOD_IRON)} ×1 (jest 0/1)`,
    );
    const fetching = settlerModel(world({ MoveGoal: { cell: 5 } }), withStatus(waiting));
    expect(fetching.status.state).toBe('walking');
    expect(fetching.status.detail).toBeNull();
  });

  it('shows another seat’s person read-only: health, workplace, owner line, no controls', () => {
    const model = settlerModel(
      [
        buildingEntity(WORKSHOP, BUILDING_JOINERY),
        {
          id: SETTLER,
          components: {
            Owner: { player: OTHER_SEAT },
            Settler: { tribe: 1, jobType: JOB_COLLECTOR },
            SettlerNeeds: { hunger: 0, fatigue: 0, enjoyment: 0, piety: 0, asOf: 0, drain: 'none' },
            Health: { hitpoints: 10, max: 10 },
            JobAssignment: { workplace: WORKSHOP },
            Residence: { home: HOME },
          },
        },
      ],
      { ...sandboxCtx(), diplomacyStance: () => 'neutral' },
    );
    expect(model.foreign).toBe(true);
    expect(model.renamable).toBe(false);
    expect(model.bars.map((bar) => bar.label)).toEqual([messages().hud.health]);
    expect(model.workplace).toMatchObject({ target: { id: WORKSHOP }, assign: null, remove: null });
    expect(model.home).toBeNull();
    expect(model.family).toBeNull();
    expect(model.production).toBeNull();
    expect(model.equipmentRows).toEqual([]);
    expect(model.meta).toContain(`${OTHER_SEAT}`);
    expect(model.meta).toContain(messages().hud.diplomacyStances.neutral);
  });

  it('fades the controls of a settler a mission holds, with the reason', () => {
    const model = settlerModel([
      buildingEntity(HOME, BUILDING_HOME_00),
      {
        id: SETTLER,
        components: owned({
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          Residence: { home: HOME },
          MissionBehaviour: { flags: 0xffff },
        }),
      },
    ]);
    expect(model.home?.assign).toBe(messages().hud.settlerPanel.scripted);
    expect(model.home?.remove).toBe(messages().hud.settlerPanel.scripted);
    expect(model.family?.marry).toBeNull();
  });

  it('gives a trader its route, its agreements as goods and the stop it heads to', () => {
    const ctx = sandboxCtx();
    const [giveGood, takeGood] = ctx.goods;
    if (giveGood === undefined || takeGood === undefined) throw new Error('sandbox has no goods');
    const view: TraderView = {
      stops: [
        { slot: 0, house: HOME as never, foreign: false, imports: [], offers: [] },
        {
          slot: 1,
          house: WORKSHOP as never,
          foreign: true,
          imports: [],
          offers: [
            { index: 0, giveGood: giveGood.typeId, giveAmount: 2, takeGood: takeGood.typeId, takeAmount: 1 },
          ],
        },
      ],
      current: 1,
      agreement: 0,
      agreementHolds: true,
      given: 0,
      received: 0,
      cart: null,
      cargo: [],
    };
    const model = settlerModel(
      [
        buildingEntity(HOME, BUILDING_HOME_00),
        buildingEntity(WORKSHOP, BUILDING_JOINERY, { components: { Owner: { player: OTHER_SEAT } } }),
        { id: SETTLER, components: owned({ Settler: { tribe: 1, jobType: JOB_TRADER }, MoveGoal: {} }) },
      ],
      { ...ctx, traderView: () => view },
    );
    expect(model.trade?.offers).toMatchObject([
      {
        index: 0,
        give: {
          amount: 2,
          goodType: giveGood.typeId,
          goodId: giveGood.id,
          label: giveGood.name ?? giveGood.id,
        },
        take: {
          amount: 1,
          goodType: takeGood.typeId,
          goodId: takeGood.id,
          label: takeGood.name ?? takeGood.id,
        },
        selected: true,
      },
    ]);
    expect(model.trade?.stops.map((stop) => stop.heading)).toEqual([false, true]);
    expect(model.trade?.foreign).toBe(true);
    expect(model.trade?.stock).toBeNull();
    expect(model.trade?.transfers).toEqual([]);
    expect(model.status.state).toBe('walking');
    expect(model.status.detail).toContain(model.trade?.stops[1]?.label ?? '?');
  });

  it('gives a route of two own houses both stock tables and one transfer per marked good', () => {
    const ctx = sandboxCtx();
    const view: TraderView = {
      stops: [
        {
          slot: 0,
          house: HOME as never,
          foreign: false,
          imports: [{ good: GOOD_IRON, upTo: IRON_CEILING, keep: IRON_RESERVE }],
          offers: [],
        },
        {
          slot: 1,
          house: WORKSHOP as never,
          foreign: false,
          imports: [{ good: GOOD_WOOD, upTo: 0, keep: 0 }],
          offers: [],
        },
      ],
      current: 0,
      agreement: -1,
      agreementHolds: false,
      given: 0,
      received: 0,
      cart: null,
      cargo: [],
    };
    // Wood marked at A too: balanced, so it carries no limits.
    const both: TraderView = {
      ...view,
      stops: view.stops.map((stop) =>
        stop.slot === 0
          ? { ...stop, imports: [...stop.imports, { good: GOOD_WOOD, upTo: 0, keep: 0 }] }
          : stop,
      ),
    };
    const world = [
      buildingEntity(HOME, BUILDING_WAREHOUSE_00, {
        components: { Stockpile: { amounts: [[GOOD_WOOD, WOOD_ABOARD]] } },
      }),
      buildingEntity(WORKSHOP, BUILDING_WAREHOUSE_00),
      { id: SETTLER, components: owned({ Settler: { tribe: 1, jobType: JOB_TRADER } }) },
    ];
    const model = settlerModel(world, { ...ctx, traderView: () => view });
    const stock = model.trade?.stock;
    if (stock == null) throw new Error('expected both houses’ stock');
    const woodAtA = stock.a.find((row) => row.goodType === GOOD_WOOD);
    expect(woodAtA).toMatchObject({ amount: WOOD_ABOARD, label: goodLabel(ctx, GOOD_WOOD) });
    expect(woodAtA?.capacity).toBeGreaterThan(0);
    expect(stock.b.find((row) => row.goodType === GOOD_WOOD)?.amount).toBe(0);
    expect(model.trade?.transfers).toMatchObject(
      [
        { goodType: GOOD_WOOD, direction: 'toB', upTo: 0, keep: 0 },
        { goodType: GOOD_IRON, direction: 'toA', upTo: IRON_CEILING, keep: IRON_RESERVE },
      ].sort((x, y) => x.goodType - y.goodType),
    );
    const balanced = settlerModel(world, { ...ctx, traderView: () => both }).trade?.transfers;
    expect(balanced?.find((transfer) => transfer.goodType === GOOD_WOOD)?.direction).toBe('both');

    // Upgrading, a house shows the stock stashed on the marker, not the site's build goods.
    const [home, ...rest] = world;
    if (home === undefined) throw new Error('expected the home');
    const upgrading = {
      ...home,
      components: {
        ...home.components,
        Stockpile: { amounts: [[GOOD_IRON, 1]] },
        Upgrading: { savedStock: [[GOOD_WOOD, WOOD_ABOARD]], seeded: [] },
      },
    };
    const site = settlerModel([upgrading, ...rest], { ...ctx, traderView: () => view }).trade?.stock?.a;
    expect(site?.find((row) => row.goodType === GOOD_WOOD)?.amount).toBe(WOOD_ABOARD);
    expect(site?.find((row) => row.goodType === GOOD_IRON)?.amount).toBe(0);
  });

  it('carries the good in hand to the status line', () => {
    const ctx = sandboxCtx();
    const [good] = ctx.goods;
    if (good === undefined) throw new Error('sandbox has no goods');
    const model = settlerModel(
      [
        {
          id: SETTLER,
          components: owned({
            Settler: { tribe: 1, jobType: JOB_COLLECTOR },
            Carrying: { goodType: good.typeId, amount: 2 },
          }),
        },
      ],
      ctx,
    );
    expect(model.status.carrying).toMatchObject({ goodId: good.id, amount: 2 });
  });

  it('treats the whole-map viewer as owning everyone', () => {
    const model = settlerModel(
      [
        {
          id: SETTLER,
          components: { Owner: { player: OTHER_SEAT }, Settler: { tribe: 1, jobType: JOB_COLLECTOR } },
        },
      ],
      { ...sandboxCtx(), viewer: { seat: () => HUMAN_PLAYER, wholeMap: () => true, version: () => 0 } },
    );
    expect(model.foreign).toBe(false);
    const watched = settlerModel(
      [
        {
          id: SETTLER,
          components: { Owner: { player: OTHER_SEAT }, Settler: { tribe: 1, jobType: JOB_COLLECTOR } },
        },
      ],
      { ...sandboxCtx(), viewer: fixedViewerSeat(HUMAN_PLAYER) },
    );
    expect(watched.foreign).toBe(true);
  });
});

describe('the settler panel’s Pojazd row', () => {
  const person = (jobType: number, components: Record<string, unknown> = {}): EntitySnapshot => ({
    id: SETTLER,
    components: owned({ Settler: { tribe: 1, jobType }, ...components }),
  });
  const cart = (lines: readonly [number, number][]): EntitySnapshot => ({
    id: CART,
    components: owned({
      Vehicle: {
        vehicleType: VEHICLE_HANDCART,
        passengers: [{ entity: SETTLER, inside: false }],
        vehicles: [],
      },
      VehicleStock: {
        lines: lines.map(([good, current]) => [good, { current, wanted: 0, reserved: 0 }]),
      },
    }),
  });
  const cartName = (ctx: UnitPanelModelContext): string => {
    const name = vehicleLabel({ vehicles: ctx.vehicles }, VEHICLE_HANDCART);
    if (name === undefined) throw new Error('the sandbox names no handcart');
    return name;
  };

  it('shows the row to the carrier, the trader, the soldier and the hero only', () => {
    // The sandbox declares no hero, so one is added the way a mission map's content carries it.
    const base = sandboxCtx();
    const soldier = base.jobs.find((job) => job.typeId === JOB_SOLDIER);
    if (soldier === undefined) throw new Error('the sandbox has no soldier');
    const ctx = {
      ...base,
      jobs: [...base.jobs, { ...soldier, id: 'hero_sword_bjarni', typeId: JOB_HERO_SWORD }],
    };
    for (const job of [JOB_CARRIER, JOB_TRADER, JOB_SOLDIER, JOB_HERO_SWORD]) {
      expect(settlerModel([person(job)], ctx).vehicle, `job ${job}`).toEqual({
        target: null,
        assign: true,
        remove: null,
      });
    }
    for (const job of [JOB_COLLECTOR, JOB_SCOUT, JOB_HUNTER, JOB_CIVILIST]) {
      expect(settlerModel([person(job)], ctx).vehicle, `job ${job}`).toBeNull();
    }
  });

  it('links the vehicle ridden, with its hold in the tooltip, and offers the way off', () => {
    const ctx = sandboxCtx();
    const loaded = settlerModel(
      [
        person(JOB_CARRIER, { Rider: { vehicle: CART, boarding: false } }),
        cart([
          [GOOD_WOOD, WOOD_ABOARD],
          [GOOD_IRON, IRON_ABOARD],
        ]),
      ],
      ctx,
    );
    const copy = messages().hud.settlerPanel;
    const goods = [
      formatMessage(copy.vehicleLoadGood, { amount: WOOD_ABOARD, good: goodLabel(ctx, GOOD_WOOD) }),
      formatMessage(copy.vehicleLoadGood, { amount: IRON_ABOARD, good: goodLabel(ctx, GOOD_IRON) }),
    ].join(', ');
    expect(loaded.vehicle).toEqual({
      target: {
        id: CART,
        label: cartName(ctx),
        load: formatMessage(copy.vehicleLoad, { vehicle: cartName(ctx), goods }),
      },
      assign: true,
      remove: true,
    });

    const empty = settlerModel(
      [person(JOB_TRADER, { Rider: { vehicle: CART, boarding: true } }), cart([[GOOD_WOOD, 0]])],
      ctx,
    );
    expect(empty.vehicle?.target?.load).toBe(
      formatMessage(copy.vehicleLoad, { vehicle: cartName(ctx), goods: copy.vehicleEmpty }),
    );
  });

  it('hides the row from another seat and fades it for a settler a mission holds', () => {
    const foreign = settlerModel([
      {
        id: SETTLER,
        components: { Owner: { player: OTHER_SEAT }, Settler: { tribe: 1, jobType: JOB_SOLDIER } },
      },
    ]);
    expect(foreign.vehicle).toBeNull();
    const held = settlerModel([person(JOB_SOLDIER, { MissionBehaviour: { flags: 0xffff } })]);
    expect(held.vehicle?.assign).toBe(messages().hud.settlerPanel.scripted);
  });
});
