import type { Entity, PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_ARCHER, JOB_CARRIER } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_MILL,
  BUILDING_WATCHTOWER,
} from '../src/game/sandbox/ids/index.js';
import { fixedViewerSeat } from '../src/game/viewer-seat.js';
import { buildUnitPanelModel } from '../src/hud/details-panel/index.js';
import {
  type BuildingPanelModel,
  type BuildingStatusInputs,
  buildingStatus,
  raisingCrew,
  type StaffGroup,
  type StockRow,
  shelteringIn,
} from '../src/hud/details-panel/model/building.js';
import {
  DEMOLISH_CONFIRM_MS,
  demolishConfirmed,
  orderViews,
} from '../src/hud/dom/building-panel/portrait.js';
import { STAFF_WELLS_MAX, staffWells } from '../src/hud/dom/building-panel/staff.js';
import { openingStockTab } from '../src/hud/dom/building-panel/stock.js';
import { messages } from '../src/i18n/index.js';
import { buildingPanelActions, buildingPeers } from '../src/view/unit-controls/building-panel.js';
import { buildingEntity, snapshotOf as panelSnapshotOf, sandboxCtx } from './support/sandbox.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

const BUILDING = 100;
const OTHER = 200;

/** A settler entity carrying exactly the components a case needs (bare `Settler` marks it a worker). */
function sett(id: number, components: Record<string, unknown> = {}): Ent {
  return { id, components: { Settler: {}, ...components } };
}

function buildingModel(entities: Parameters<typeof panelSnapshotOf>[0], id: number): BuildingPanelModel {
  const model = buildUnitPanelModel(panelSnapshotOf(entities), new Set([id]), sandboxCtx());
  if (model.kind !== 'building') throw new Error('expected a building model');
  return model;
}

describe('building staff readers', () => {
  it('lists the crew raising a site once each: builders, hands at it, suppliers', () => {
    const snap = snapshotOf([
      sett(1, { SiteAssignment: { site: BUILDING } }),
      sett(2, { CurrentAtomic: { targetEntity: BUILDING } }),
      sett(3, { SupplyRun: { site: BUILDING } }),
      sett(4, { SiteAssignment: { site: BUILDING }, SupplyRun: { site: BUILDING } }),
      sett(5, { SiteAssignment: { site: OTHER } }),
    ]);
    expect(raisingCrew(snap, BUILDING).map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });

  it('lists the sheltering crowd, the ones already inside first', () => {
    const hiding = (id: number, shelter: number, inside: boolean): Ent =>
      sett(id, { Sheltering: { shelter }, ...(inside ? { Resting: { at: shelter } } : {}) });
    const snap = snapshotOf([hiding(1, BUILDING, false), hiding(2, BUILDING, true), hiding(3, OTHER, true)]);
    expect(shelteringIn(snap, BUILDING).map((e) => e.id)).toEqual([2, 1]);
  });

  it('reads the crew off the standing indexes, not a walk over the map', () => {
    const SCENERY = 400;
    const { snapshot, visits } = visitCountingSnapshot(
      snapshotOf([
        sett(1, { SiteAssignment: { site: BUILDING } }),
        ...Array.from({ length: SCENERY }, (_, i) => ({
          id: i + 10,
          components: { Resource: { goodType: 1 } },
        })),
      ]),
    );
    expect(raisingCrew(snapshot, OTHER)).toEqual([]); // builds the indexes a mirror maintains
    const built = visits();
    expect(raisingCrew(snapshot, BUILDING).map((e) => e.id)).toEqual([1]);
    expect(visits()).toBe(built);
  });

  it("groups a tower's garrison under its slot and the sheltering crowd apart", () => {
    const model = buildingModel(
      [
        buildingEntity(1, BUILDING_WATCHTOWER, { components: { DefenceMode: {} } }),
        { id: 2, components: { Settler: { jobType: JOB_ARCHER }, JobAssignment: { workplace: 1 } } },
        { id: 3, components: { Settler: { jobType: 0 }, Sheltering: { shelter: 1 }, Resting: { at: 1 } } },
      ],
      1,
    );
    const garrison = model.staff?.groups.find((group) => group.key === `job:${JOB_ARCHER}`);
    expect(garrison?.people.map((person) => [person.entity, person.look])).toEqual([[2, 'soldier']]);
    expect(
      model.staff?.groups.find((group) => group.key === 'sheltered')?.people.map((p) => p.entity),
    ).toEqual([3]);
    // The seat count on the rule counts the posts, never the crowd.
    expect(model.staff?.count?.filled).toBe(1);
  });

  it('lists a worker who shelters where it works on its trade line only', () => {
    const model = buildingModel(
      [
        buildingEntity(1, BUILDING_HEADQUARTERS, { components: { DefenceMode: {} } }),
        {
          id: 2,
          components: {
            Settler: { jobType: JOB_CARRIER },
            JobAssignment: { workplace: 1 },
            Sheltering: { shelter: 1 },
          },
        },
      ],
      1,
    );
    const people = model.staff?.groups.flatMap((group) => group.people.map((person) => person.entity));
    expect(people).toEqual([2]);
    expect(model.staff?.groups.some((group) => group.key === 'sheltered')).toBe(false);
  });

  it('reads a tower by its garrison posts, whatever its carriers do', () => {
    const tower = (entities: Parameters<typeof panelSnapshotOf>[0]) =>
      buildingModel([buildingEntity(1, BUILDING_WATCHTOWER), ...entities], 1).status.label;
    const status = messages().hud.buildingPanel.status;
    const carrier = {
      id: 2,
      components: { Settler: { jobType: JOB_CARRIER }, JobAssignment: { workplace: 1 } },
    };
    const archer = {
      id: 3,
      components: { Settler: { jobType: JOB_ARCHER }, JobAssignment: { workplace: 1 } },
    };
    expect(tower([carrier])).toBe(status.noGarrison);
    expect(tower([carrier, archer])).toBe(status.manned);
  });
});

describe('building status', () => {
  const idle: BuildingStatusInputs = {
    site: null,
    alarm: null,
    crafting: null,
    seats: null,
    garrison: null,
    work: undefined,
    workGood: null,
    families: null,
  };
  const status = messages().hud.buildingPanel.status;

  it('names the first state that holds, the site before the alarm before the work', () => {
    expect(
      buildingStatus({
        ...idle,
        site: { upgrade: true, pct: 40, stall: 'delivery-en-route' },
        alarm: { sheltered: 1, capacity: 4 },
      }),
    ).toEqual({ label: status.upgrading, detail: `40% · ${status.stalls['delivery-en-route']}`, tone: 'ok' });
    expect(buildingStatus({ ...idle, alarm: { sheltered: 1, capacity: 4 }, crafting: 'Deska' }).label).toBe(
      status.alarm,
    );
    expect(buildingStatus({ ...idle, crafting: 'Deska', seats: 0 })).toEqual({
      label: status.working,
      detail: 'Deska',
      tone: 'ok',
    });
  });

  it('reads amber for missing hands and for the stall a posted worker reports', () => {
    expect(buildingStatus({ ...idle, seats: 0 })).toMatchObject({
      label: status.noWorkers,
      tone: 'trouble',
    });
    expect(buildingStatus({ ...idle, seats: 1, garrison: 0 }).label).toBe(status.noGarrison);
    expect(buildingStatus({ ...idle, seats: 3, garrison: 2 })).toMatchObject({
      label: status.manned,
      tone: 'ok',
    });
    expect(
      buildingStatus({
        ...idle,
        seats: 1,
        work: { kind: 'waitingInput', goodType: 3 },
        workGood: 'Żelazo',
      }),
    ).toEqual({
      label: status.idle,
      detail: messages().hud.settlerPanel.idleReasons.waitingInput.replace('{good}', 'Żelazo'),
      tone: 'trouble',
    });
    expect(buildingStatus({ ...idle, seats: 1 })).toMatchObject({
      label: status.working,
      tone: 'ok',
    });
  });

  it('says whether a home is lived in, and a house without work only stands', () => {
    expect(buildingStatus({ ...idle, families: 0 })).toMatchObject({ label: status.empty, tone: 'neutral' });
    expect(buildingStatus({ ...idle, families: 2 })).toMatchObject({ label: status.lived, tone: 'ok' });
    expect(buildingStatus(idle)).toMatchObject({ label: status.standing, tone: 'neutral' });
  });
});

describe('building panel model', () => {
  it("shows another seat's house with its owner line and no orders, staff or stock", () => {
    const model = buildingModel(
      [
        buildingEntity(1, BUILDING_MILL, {
          components: { Owner: { player: 1 }, Stockpile: { amounts: [[1, 3]] } },
        }),
      ],
      1,
    );
    expect(model.foreign).toBe(true);
    expect(model.meta).not.toBeNull();
    expect(model.orders).toBeNull();
    expect(model.staff).toBeNull();
    expect(model.production).toBeNull();
    expect(model.stock).toEqual([]);
  });

  it("reads another seat's home as lived in while a family lives there", () => {
    const model = buildingModel(
      [
        buildingEntity(1, BUILDING_HOME_00, { components: { Owner: { player: 1 } } }),
        { id: 2, components: { Settler: { jobType: JOB_CARRIER }, Residence: { home: 1 } } },
      ],
      1,
    );
    expect(model.staff).toBeNull();
    expect(model.status.label).toBe(messages().hud.buildingPanel.status.lived);
  });

  it('names the civilization only while the seat keeps houses of several', () => {
    const one = buildingModel([buildingEntity(1, BUILDING_MILL), buildingEntity(2, BUILDING_MILL)], 1);
    expect(one.meta).toBeNull();
    const other = buildingEntity(2, BUILDING_MILL);
    const mixed = buildingModel(
      [
        buildingEntity(1, BUILDING_MILL),
        {
          ...other,
          components: { ...other.components, Building: { buildingType: BUILDING_MILL, tribe: 2 } },
        },
      ],
      1,
    );
    expect(mixed.meta).not.toBeNull();
  });

  it('lists the agreements a trade house offers from the read seam', () => {
    const model = buildUnitPanelModel(panelSnapshotOf([buildingEntity(1, BUILDING_MILL)]), new Set([1]), {
      ...sandboxCtx(),
      tradeOffersAt: () => [{ index: 0, giveGood: 1, giveAmount: 2, takeGood: 3, takeAmount: 4 }],
    });
    if (model.kind !== 'building') throw new Error('expected a building model');
    expect(model.offers).toEqual([
      {
        give: expect.objectContaining({ amount: 2, goodType: 1 }),
        take: expect.objectContaining({ amount: 4, goodType: 3 }),
      },
    ]);
  });

  it("browses the owner's buildings of the shown one's type, ascending", () => {
    const snapshot = panelSnapshotOf([
      buildingEntity(5, BUILDING_MILL),
      buildingEntity(2, BUILDING_MILL),
      buildingEntity(3, BUILDING_JOINERY),
      buildingEntity(9, BUILDING_MILL, { components: { Owner: { player: 1 } } }),
    ]);
    expect(buildingPeers(snapshot, 5)).toEqual([2, 5]);
    expect(buildingPeers(snapshot, 9)).toEqual([9]);
    expect(buildingPeers(snapshot, 77)).toEqual([]);
  });
});

describe('building orders', () => {
  const copy = messages().hud.buildingPanel;

  it('offers the tier with its bill or refusal, the alarm lit while up, the demolition last in red', () => {
    const views = orderViews(
      {
        upgrade: { control: true, cost: [{ goodType: 1, label: 'Drewno', amount: 4 }] },
        cancelUpgrade: false,
        alarm: { on: true },
      },
      false,
    );
    expect(views.map((view) => view.order)).toEqual(['upgrade', 'alarm', 'demolish']);
    expect(views[0]?.tooltip).toBe(copy.upgradeCost.replace('{cost}', '4 Drewno'));
    expect(views[1]).toMatchObject({ lit: true, label: copy.orders.alarmOff });
    expect(views[2]).toMatchObject({ danger: true, lit: false, tooltip: copy.orders.demolish });

    const refused = orderViews(
      {
        upgrade: { control: 'Wymaga zbieracza', cost: [] },
        cancelUpgrade: true,
        alarm: null,
      },
      true,
    );
    expect(refused.map((view) => view.order)).toEqual(['upgrade', 'cancelUpgrade', 'demolish']);
    expect(refused[0]).toMatchObject({ enabled: false, tooltip: 'Wymaga zbieracza' });
    expect(refused[2]).toMatchObject({ lit: true, tooltip: copy.demolishConfirm });
  });

  it('demolishes only on a second press on the same house while the first is fresh', () => {
    const armed = { building: 4, at: 1000 };
    expect(demolishConfirmed(armed, 4, 1000 + DEMOLISH_CONFIRM_MS - 1)).toBe(true);
    expect(demolishConfirmed(armed, 4, 1000 + DEMOLISH_CONFIRM_MS)).toBe(false);
    expect(demolishConfirmed(armed, 5, 1001)).toBe(false);
    expect(demolishConfirmed(null, 4, 1001)).toBe(false);
  });

  it("turns the presses into the building's commands and refuses another seat's house", () => {
    const sent: PlayerCommand[] = [];
    const cues: string[] = [];
    const snapshot = panelSnapshotOf([
      buildingEntity(1, BUILDING_HEADQUARTERS),
      buildingEntity(2, BUILDING_HEADQUARTERS, { components: { Owner: { player: 1 } } }),
    ]);
    const actions = buildingPanelActions({
      snapshot: () => snapshot,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      enqueue: (command) => sent.push(command),
      cue: (cue) => cues.push(cue),
    });
    actions.setAlarm(1, true);
    actions.demolish(2);
    actions.setHouseholdGoodUse(HUMAN_PLAYER, 'rest', false);
    actions.setHouseholdGoodUse(1, 'rest', false);
    expect(sent).toEqual([
      { kind: 'setDefenceMode', building: 1 as Entity, enabled: true },
      { kind: 'setHouseholdGoodUse', player: HUMAN_PLAYER, effect: 'rest', allowed: false },
    ]);
    expect(cues).toEqual(['confirm', 'fail', 'confirm', 'fail']);
  });
});

describe('building staff wells', () => {
  const person = (entity: number) => ({ entity, name: 'A', job: 'B', look: 'man' as const });

  it('follows the people with the free seats, and counts the rest past the cap in the last well', () => {
    const slot: StaffGroup = { key: 'a', label: 'Kowal', people: [person(1)], capacity: 3 };
    expect(staffWells(slot).map((well) => well.kind)).toEqual(['person', 'seat', 'seat']);
    const crowd: StaffGroup = {
      key: 'b',
      label: '',
      people: Array.from({ length: STAFF_WELLS_MAX + 4 }, (_, i) => person(i)),
      capacity: null,
    };
    const wells = staffWells(crowd);
    expect(wells).toHaveLength(STAFF_WELLS_MAX);
    expect(wells.at(-1)).toEqual({ kind: 'more', count: 5 });
    // A large shelter with few inside cuts its free seats, never a person, and counts nobody extra.
    const shelter: StaffGroup = {
      key: 'c',
      label: 'S',
      people: [person(1), person(2), person(3)],
      capacity: 30,
    };
    const cut = staffWells(shelter);
    expect(cut).toHaveLength(STAFF_WELLS_MAX);
    expect(cut.filter((well) => well.kind === 'person')).toHaveLength(3);
    expect(cut.some((well) => well.kind === 'more')).toBe(false);
  });
});

describe('building stock tabs', () => {
  const row = (goodType: number, category: number, amount: number): StockRow => ({
    goodType,
    label: `g${goodType}`,
    amount,
    category,
  });

  it('opens on the first category holding anything, else the first stored', () => {
    expect(openingStockTab([row(1, 1, 0), row(2, 4, 3), row(3, 6, 1)], 8)).toBe(4);
    expect(openingStockTab([row(1, 3, 0), row(2, 5, 0)], 8)).toBe(3);
    expect(openingStockTab([], 8)).toBe(0);
  });
});
