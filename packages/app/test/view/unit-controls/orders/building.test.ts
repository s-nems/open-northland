import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { TargetFlashTone } from '@open-northland/render';
import type { Command, Entity, Fixed, GroupWorker, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { components, fx, nodeOfPosition, ONE, playerCommand, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { BUILD_HOUSE_ATOMIC } from '../../../../src/catalog/atomics.js';
import { JOB_ARCHER, JOB_BUILDER, JOB_JOINER, JOB_TRADER } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../../src/game/rules.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HOME_00,
  BUILDING_WATCHTOWER,
  GOOD_STONE,
  GOOD_WOOD,
  sandboxContent,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../../../../src/game/sandbox/index.js';
import type { Pickable } from '../../../../src/view/picking.js';
import { drillPick, sitePick } from '../../../../src/view/unit-controls/highlights/own-building-picks.js';
import { createAnsweredOrders } from '../../../../src/view/unit-controls/orders/answered.js';
import {
  createUnitOrderController,
  type UnitOrderDeps,
} from '../../../../src/view/unit-controls/orders/controller.js';
import { withPointHits } from '../../../support/point-hits.js';
import { rightClickRiders, rightClickSettlers } from '../../../support/right-click.js';
import { STILL_CAMERA } from '../../../support/still-camera.js';

/**
 * The right-click ladder over an own building. A construction site is hired into by the rules of the
 * building it will become, with one rung on top: a builder joins its crew instead, as it joins a damaged
 * building's repair crew while that has room. A family may reserve a home before it stands; drilling
 * still requires a completed building.
 */

const {
  addPerson,
  Building,
  Damaged,
  Female,
  HaulingCart,
  Health,
  MissionObjectId,
  Owner,
  Position,
  Rider,
  SiteAssignment,
  Stockpile,
  UnderConstruction,
  Vehicle,
} = components;

/** Another tribe's player, and the mission id the map stamps on its trading house. */
const NEIGHBOUR = HUMAN_PLAYER + 1;
const TRADING_POST_ID = 700;
/** A civilization other than the sandbox's own. */
const OTHER_TRIBE = PRIMARY_TRIBE + 1;

/** A bakery - the workplace whose craft slot the click should hire into. */
const BAKERY = 'work_bakery_00';
/** A joinery - a workplace whose own craft trade exposes the hammer atomic in content. */
const JOINERY = 'work_joinery_00';

function buildingAt(sim: Simulation, buildingType: number, built: Fixed): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
  sim.world.add(e, Building, { buildingType, tribe: PRIMARY_TRIBE, built, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

/** A standing building of `buildingType` a blow has taken hitpoints off. */
function damagedAt(sim: Simulation, buildingType: number): Entity {
  const e = buildingAt(sim, buildingType, ONE);
  sim.world.add(e, Health, { hitpoints: 10, max: 100 });
  sim.world.add(e, Damaged, { lastHitTick: 0 });
  return e;
}

/** A foundation of `buildingType`: no labor in it yet, and carrying the mark the ladder branches on. */
function siteAt(sim: Simulation, buildingType: number): Entity {
  const e = buildingAt(sim, buildingType, fx.fromInt(0));
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  return e;
}

function settlerAt(sim: Simulation, jobType: number | null): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(2), y: fx.fromInt(4) });
  addPerson(sim.world, e, {
    tribe: PRIMARY_TRIBE,
    jobType,
    hunger: ONE,
    fatigue: ONE,
    piety: ONE,
    enjoyment: ONE,
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

/** Right-click `building` with `settlers` selected and return the commands it enqueued. `content` overrides
 *  the sim's own content set - the routing decision is a pure function of (snapshot, content). */
async function rightClick(
  sim: Simulation,
  settlers: readonly Entity[],
  building: Entity,
  content: ContentSet = sim.content,
  owned = true,
  click: 'settlers' | 'riders' | 'marker' = 'settlers',
  shiftKey = false,
): Promise<Command[]> {
  return (await pressRightClick(sim, settlers, building, content, owned, click, shiftKey)).issued;
}

/** {@link rightClick} with the press's own verdict, which decides whether the click confirms. The orders
 *  a trader's route toggle waits on the sim for are in once its answer landed. */
async function pressRightClick(
  sim: Simulation,
  settlers: readonly Entity[],
  building: Entity,
  content: ContentSet = sim.content,
  owned = true,
  click: 'settlers' | 'riders' | 'marker' = 'settlers',
  shiftKey = false,
): Promise<{
  issued: Command[];
  ordered: boolean;
  flashed: [number, TargetFlashTone][];
  tradeRefused: number[];
}> {
  const issued: Command[] = [];
  const tradeRefused: number[] = [];
  const flashed: [number, TargetFlashTone][] = [];
  const snapshot = sim.snapshot();
  const pickable: Pickable = { ref: building, x: 0, y: 0 };
  const targets = withPointHits({
    owned: (kind) => (kind === 'building' && owned ? [pickable] : []),
    buildings: () => [pickable],
    enemies: () => [],
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [],
    resources: () => [],
    wildlife: () => [],
    claimableLivestock: () => [],
    ownedSettlersIn: () => settlers.map((ref) => ({ ref, x: 0, y: 0 })),
  });
  const deps = {
    answered: createAnsweredOrders(),
    camera: STILL_CAMERA,
    selected: () => new Set<number>(settlers),
    targets,
    snapshot: (): WorldSnapshot => snapshot,
    content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
    askAttachTradeHouse: (trader, house) =>
      Promise.resolve(sim.canAttachTradeHouse(trader as Entity, house as Entity)),
    onTradeRefused: (house) => tradeRefused.push(house),
    flashTarget: (entity, tone) => flashed.push([entity, tone]),
  } satisfies UnitOrderDeps;
  const controller = createUnitOrderController(deps);
  const event = { ...CLICK, shiftKey } as MouseEvent;
  const ordered =
    click === 'settlers'
      ? rightClickSettlers(controller, deps, event)
      : click === 'marker'
        ? rightClickSettlers(controller, deps, event, building)
        : rightClickRiders(controller, deps, event, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { issued, ordered, flashed, tradeRefused };
}

/** How far a one-man formation may step a walk's slot off an occupied node. */
const FORMATION_STEP_NODES = 2;

/** The sandbox watchtower's short-bow seats (`logicworker 40 3`). */
const TOWER_SHORT_BOW_POSTS = 3;

/** The click itself carries no information here - `toWorld` above pins the world point, and the
 *  controller reads nothing else off the event. Node has no DOM to mint a real one. */
const CLICK = { clientX: 0, clientY: 0 } as MouseEvent;

/** The sandbox catalog with `jobType` also exposing the hammer atomic. */
function alsoBuilds(sim: Simulation, jobType: number): ContentSet {
  const content = sim.content;
  return {
    ...content,
    jobs: content.jobs.map((job) =>
      job.typeId === jobType ? { ...job, allowedAtomics: [...job.allowedAtomics, BUILD_HOUSE_ATOMIC] } : job,
    ),
  };
}

/** A sandbox workplace by its stable id: its typeId and its first craft slot's job - what a hire into it
 *  must bind. Read off the content rather than assumed, since the sandbox rebases some slot job ids. */
function workplace(sim: Simulation, id: string): { typeId: number; craftJob: number } {
  const def = [...lastByTypeId(sim.content.buildings).values()].find((b) => b.id === id);
  const craftJob = def?.workers[0]?.jobType;
  if (def === undefined || craftJob === undefined) throw new Error(`${id} has no worker slot`);
  return { typeId: def.typeId, craftJob };
}

const bakery = (sim: Simulation): { typeId: number; craftJob: number } => workplace(sim, BAKERY);

/** The members of the one group order a right-click posted at `building`. */
function postedWorkers(issued: readonly Command[], building: Entity): readonly GroupWorker[] {
  expect(issued).toHaveLength(1);
  const order = issued[0];
  if (order?.kind !== 'assignWorkerGroup' || order.building !== building) {
    throw new Error(`expected one worker group order at ${building}, got ${JSON.stringify(issued)}`);
  }
  return order.members;
}

describe('right-clicking a construction site', () => {
  it('submits 1000 builders to a foundation in one selection envelope', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_HOME_00);
    const settlers = Array.from({ length: 1000 }, () => settlerAt(sim, JOB_BUILDER));
    expect(await rightClick(sim, settlers, site)).toEqual([
      {
        kind: 'unitActionGroup',
        members: settlers.map((entity) => ({ entity })),
        action: { kind: 'assignBuilder', site },
      },
    ]);
  });

  it('puts a builder on the foundation', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId);
    const builder = settlerAt(sim, JOB_BUILDER);

    expect(await rightClick(sim, [builder], site)).toEqual([
      { kind: 'assignBuilder', entity: builder, site },
    ]);
  });

  it('with Shift queues the builder behind its current order and walks the rest there', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_HOME_00);
    const builder = settlerAt(sim, JOB_BUILDER);
    const idle = settlerAt(sim, null);

    expect(await rightClick(sim, [builder, idle], site, sim.content, true, 'settlers', true)).toEqual([
      { kind: 'assignBuilder', entity: builder, site, queued: true },
      expect.objectContaining({ kind: 'moveUnit', entity: idle, queued: true }),
    ]);
  });

  it('with Shift walks to where a building stands when the click came from its marker', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const idle = settlerAt(sim, null);
    const { x, y } = sim.world.get(home, Position);
    const stands = nodeOfPosition(x, y);

    const [walk] = await rightClick(sim, [idle], home, sim.content, true, 'marker', true);
    if (walk?.kind !== 'moveUnit') throw new Error('expected a queued walk');
    expect(walk.queued).toBe(true);
    // The formation may step the slot off the building's own node, never back to the flag's ground.
    expect(Math.abs(walk.x - stands.hx)).toBeLessThanOrEqual(FORMATION_STEP_NODES);
    expect(Math.abs(walk.y - stands.hy)).toBeLessThanOrEqual(FORMATION_STEP_NODES);
  });

  it('pins the builders to a road site and walks the rest there, behind the current order with Shift', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const builder = settlerAt(sim, JOB_BUILDER);
    const idle = settlerAt(sim, null);
    const road = 999 as Entity;
    const snapshot = sim.snapshot();
    const press = (shiftKey: boolean): Command[] => {
      const issued: Command[] = [];
      const deps = {
        answered: createAnsweredOrders(),
        camera: STILL_CAMERA,
        selected: () => new Set<number>([builder, idle]),
        targets: withPointHits({
          owned: (kind) => (kind === 'roadsite' ? [{ ref: road, x: 0, y: 0 }] : []),
          buildings: () => [],
          enemies: () => [],
          flags: () => [],
          signposts: () => [],
          chests: () => [],
          goods: () => [],
          resources: () => [],
          wildlife: () => [],
          claimableLivestock: () => [],
          ownedSettlersIn: () => [builder, idle].map((ref) => ({ ref, x: 0, y: 0 })),
        }),
        snapshot: (): WorldSnapshot => snapshot,
        content: sim.content,
        mapSize: { width: 16, height: 16 },
        toWorld: () => ({ x: 0, y: 0 }),
        enqueue: (command) => issued.push(command),
        selectOwnSettler: () => {},
        openActions: () => {},
      } satisfies UnitOrderDeps;
      rightClickSettlers(createUnitOrderController(deps), deps, { ...CLICK, shiftKey } as MouseEvent);
      return issued;
    };

    expect(press(false)).toMatchObject([
      { kind: 'assignBuilder', entity: builder, site: road },
      { kind: 'moveUnit', entity: idle },
    ]);
    expect(press(true)).toMatchObject([
      { kind: 'assignBuilder', entity: builder, site: road, queued: true },
      { kind: 'moveUnit', entity: idle, queued: true },
    ]);
  });

  it('does not turn a non-builder with the hammer atomic into a site builder', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId); // a bakery employs no joiner - nothing to post him into
    const joiner = settlerAt(sim, JOB_JOINER);

    const [posted] = postedWorkers(await rightClick(sim, [joiner], site, alsoBuilds(sim, JOB_JOINER)), site);
    expect(posted?.entity).toBe(joiner);
    expect(posted?.jobPriority).not.toContain(JOB_BUILDER);
  });

  it('posts a craft worker into his future workshop to carry its materials', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { typeId, craftJob } = workplace(sim, JOINERY);
    const site = siteAt(sim, typeId);
    const joiner = settlerAt(sim, craftJob);

    const [posted] = postedWorkers(await rightClick(sim, [joiner], site, alsoBuilds(sim, craftJob)), site);
    expect(posted?.entity).toBe(joiner);
    expect(posted?.jobPriority[0]).toBe(craftJob);
  });

  it('employs a builder at a STANDING building - the crew rung belongs to the foundation alone', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const standing = buildingAt(sim, bakery(sim).typeId, ONE);
    const builder = settlerAt(sim, JOB_BUILDER);

    expect(postedWorkers(await rightClick(sim, [builder], standing), standing).map((w) => w.entity)).toEqual([
      builder,
    ]);
  });

  it('sends a builder to mend a damaged standing building rather than employing him there', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const damaged = damagedAt(sim, bakery(sim).typeId);
    const builder = settlerAt(sim, JOB_BUILDER);

    expect(await rightClick(sim, [builder], damaged)).toEqual([
      { kind: 'assignBuilder', entity: builder, site: damaged },
    ]);
  });

  it('sends the builder of a mixed selection to mend a damaged home and houses the rest', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = damagedAt(sim, BUILDING_HOME_00);
    const builder = settlerAt(sim, JOB_BUILDER);
    const idle = settlerAt(sim, null);

    expect(await rightClick(sim, [builder, idle], home)).toEqual([
      { kind: 'assignBuilder', entity: builder, site: home },
      { kind: 'assignHouseGroup', members: [{ entity: idle }], house: home },
    ]);
  });

  it('houses a builder in a damaged home whose repair crew is already full', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = damagedAt(sim, BUILDING_HOME_00);
    for (let i = 0; i < systems.REPAIR_CREW_LIMIT; i++) {
      sim.world.add(settlerAt(sim, JOB_BUILDER), SiteAssignment, { site: home, pinned: false });
    }
    const [spare, sixth] = [settlerAt(sim, JOB_BUILDER), settlerAt(sim, JOB_BUILDER)];

    expect(await rightClick(sim, [spare, sixth], home)).toEqual([
      { kind: 'assignHouseGroup', members: [{ entity: spare }, { entity: sixth }], house: home },
    ]);
  });

  it('hires any other trade into the building the foundation will become', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { typeId, craftJob } = bakery(sim);
    const site = siteAt(sim, typeId);
    const idle = settlerAt(sim, null);

    const [posted] = postedWorkers(await rightClick(sim, [idle], site), site);
    expect(posted?.entity).toBe(idle);
    // The craft slot leads the priority list - the carrier slot is only the fallback (assignmentPriority).
    expect(posted?.jobPriority[0]).toBe(craftJob);
  });

  it('sends a settler to drill at a barracks foundation, where it waits for the barracks to stand', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_BARRACKS);
    const idle = settlerAt(sim, null);

    expect(await rightClick(sim, [idle], site)).toEqual([
      { kind: 'trainSoldier', entity: idle, house: site },
    ]);
  });

  it('with Shift queues the drill at a barracks behind the current order', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_BARRACKS);
    const idle = settlerAt(sim, null);

    expect(await rightClick(sim, [idle], site, sim.content, true, 'settlers', true)).toEqual([
      { kind: 'trainSoldier', entity: idle, house: site, queued: true },
    ]);
  });

  it('reserves a home foundation for the selected family', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_HOME_00);
    const idle = settlerAt(sim, null);

    expect(await rightClick(sim, [idle], site)).toEqual([
      { kind: 'assignHouseGroup', members: [{ entity: idle }], house: site },
    ]);
  });
});

describe('right-clicking a standing building', () => {
  it('moves the family into a finished home', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const idle = settlerAt(sim, null);

    expect(await rightClick(sim, [idle], home)).toEqual([
      { kind: 'assignHouseGroup', members: [{ entity: idle }], house: home },
    ]);
  });

  it('sends a whole group to a home as one order, so the sim houses the homeless first', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const group = [settlerAt(sim, null), settlerAt(sim, null), settlerAt(sim, null)];

    expect(await rightClick(sim, group, home)).toEqual([
      { kind: 'assignHouseGroup', members: group.map((entity) => ({ entity })), house: home },
    ]);
  });

  it('posts a whole group to a workplace as one order, so the sim seats the unemployed first', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const standing = buildingAt(sim, bakery(sim).typeId, ONE);
    const group = [settlerAt(sim, null), settlerAt(sim, null)];

    expect(postedWorkers(await rightClick(sim, group, standing), standing).map((w) => w.entity)).toEqual(
      group,
    );
  });

  it('mans a second tower from the selection without pulling the first garrison back', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const first = buildingAt(sim, BUILDING_WATCHTOWER, ONE);
    const second = buildingAt(sim, BUILDING_WATCHTOWER, ONE);
    const archers = Array.from({ length: 2 * TOWER_SHORT_BOW_POSTS + 1 }, () => settlerAt(sim, JOB_ARCHER));
    const manAndStep = async (tower: Entity): Promise<void> => {
      for (const command of await rightClick(sim, archers, tower)) {
        sim.enqueue(playerCommand(HUMAN_PLAYER, command as PlayerCommand));
      }
      sim.step();
    };
    const posts = (): (Entity | undefined)[] =>
      archers.map((e) => sim.world.tryGet(e, components.JobAssignment)?.workplace);

    await manAndStep(first);
    await manAndStep(second);

    const manned = posts();
    expect(manned.filter((post) => post === first)).toHaveLength(TOWER_SHORT_BOW_POSTS);
    expect(manned.filter((post) => post === second)).toHaveLength(TOWER_SHORT_BOW_POSTS);
    expect(manned.filter((post) => post === undefined)).toHaveLength(1);
  });

  it('sends a trade the barracks does not employ to drill there', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const barracks = buildingAt(sim, BUILDING_BARRACKS, ONE);
    const idle = settlerAt(sim, null);

    expect(await rightClick(sim, [idle], barracks)).toEqual([
      { kind: 'trainSoldier', entity: idle, house: barracks },
    ]);
  });
});

describe('a right-click that orders nobody', () => {
  const schoolType = (sim: Simulation): number => {
    const school = sim.content.buildings.find((row) => systems.isSchoolType(row));
    if (school === undefined) throw new Error('the sandbox has no school');
    return school.typeId;
  };

  it('reports nothing when no selected settler may learn at the school', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const school = buildingAt(sim, schoolType(sim), ONE);
    const woman = settlerAt(sim, null);
    sim.world.add(woman, Female, { female: true });

    expect(await pressRightClick(sim, [woman], school)).toEqual({
      issued: [],
      ordered: false,
      flashed: [],
      tradeRefused: [],
    });
  });

  it('reports nothing when the foundation takes none of the selection', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, schoolType(sim)); // a school employs nobody and teaches no woman
    const woman = settlerAt(sim, null);
    sim.world.add(woman, Female, { female: true });

    expect(await pressRightClick(sim, [woman], site)).toEqual({
      issued: [],
      ordered: false,
      flashed: [],
      tradeRefused: [],
    });
  });

  it('takes no hero into a home, a workplace or a barracks, and still posts the man beside him', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    // The sandbox catalog holds no hero trade; the served content names every one of them `hero*`.
    const heroContent = {
      ...sim.content,
      jobs: sim.content.jobs.map((job) => (job.typeId === JOB_JOINER ? { ...job, id: 'hero_test' } : job)),
    };
    const hero = settlerAt(sim, JOB_JOINER);
    const idle = settlerAt(sim, null);
    const standing = buildingAt(sim, bakery(sim).typeId, ONE);

    for (const building of [
      buildingAt(sim, BUILDING_HOME_00, ONE),
      standing,
      buildingAt(sim, BUILDING_BARRACKS, ONE),
    ]) {
      expect(await pressRightClick(sim, [hero], building, heroContent)).toEqual({
        issued: [],
        ordered: false,
        flashed: [],
        tradeRefused: [],
      });
    }
    const posted = postedWorkers(await rightClick(sim, [hero, idle], standing, heroContent), standing);
    expect(posted.map((w) => w.entity)).toEqual([idle]);
  });

  it('reports the order a building did take and flashes the building green', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);

    const press = await pressRightClick(sim, [settlerAt(sim, null)], home);
    expect(press.ordered).toBe(true);
    expect(press.flashed).toEqual([[home, 'assign']]);
  });

  it('flashes a foundation green once a builder takes it', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId);

    expect((await pressRightClick(sim, [settlerAt(sim, JOB_BUILDER)], site)).flashed).toEqual([
      [site, 'assign'],
    ]);
  });
});

describe("the action ring's site pick", () => {
  it('offers a damaged building to a builder until its repair crew is full', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const byType = lastByTypeId(sim.content.buildings);
    const home = damagedAt(sim, BUILDING_HOME_00);
    const builder = settlerAt(sim, JOB_BUILDER);
    expect(sitePick.assignableAt(sim.snapshot(), home, builder, byType)).toBe(true);

    for (let i = 0; i < systems.REPAIR_CREW_LIMIT; i++) {
      sim.world.add(settlerAt(sim, JOB_BUILDER), SiteAssignment, { site: home, pinned: false });
    }
    expect(sitePick.assignableAt(sim.snapshot(), home, builder, byType)).toBe(false);
  });
  it("offers its seat's foundation of another tribe to a builder", () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const foundation = siteAt(sim, BUILDING_HOME_00);
    sim.world.mut(foundation, Building).tribe = OTHER_TRIBE;
    const builder = settlerAt(sim, JOB_BUILDER);
    const byType = lastByTypeId(sim.content.buildings);
    expect(sitePick.assignableAt(sim.snapshot(), foundation, builder, byType)).toBe(true);
  });

  it("offers its seat's barracks of another tribe to the drill pick", () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const barracks = siteAt(sim, BUILDING_BARRACKS);
    const settler = settlerAt(sim, null);
    const byType = lastByTypeId(sim.content.buildings);
    sim.world.mut(barracks, Building).tribe = OTHER_TRIBE;
    expect(drillPick.assignableAt(sim.snapshot(), barracks, settler, byType)).toBe(true);
  });
});

describe("the builder site pick's highlight", () => {
  it("lights the seat's damaged buildings and sites, and drops one once repaired or another seat's", () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const byType = lastByTypeId(sim.content.buildings);
    const home = damagedAt(sim, BUILDING_HOME_00);
    const foundation = siteAt(sim, BUILDING_HOME_00);
    const standing = buildingAt(sim, BUILDING_HOME_00, ONE);
    const foreign = damagedAt(sim, BUILDING_HOME_00);
    sim.world.mut(foreign, Owner).player = NEIGHBOUR;
    const builder = settlerAt(sim, JOB_BUILDER);
    const lit = () => sitePick.highlight(sim.snapshot(), [builder], byType).map((item) => item.id);

    expect(lit()).toEqual([home, foundation]);
    expect(lit()).not.toContain(standing);
    sim.world.remove(home, Damaged);
    expect(lit()).toEqual([foundation]);
  });
});

/** Where {@link riddenVehicle} stands its vehicle; the click never reads it. */
const VEHICLE_AT = { x: 2, y: 2 } as const;

/** A vehicle of `vehicleType` with `rider` in its first seat, still walking to the door. */
function riddenVehicle(sim: Simulation, vehicleType: number, rider: Entity): Entity {
  const vehicle = spawnVehicleDirect(sim, vehicleType, VEHICLE_AT.x, VEHICLE_AT.y);
  sim.world.mut(vehicle, Vehicle).passengers[0] = { entity: rider, inside: false };
  sim.world.add(rider, Rider, { vehicle, boarding: false, leaving: null });
  return vehicle;
}

/** A standing house of {@link NEIGHBOUR} stamped as the map's trading post, its owner a friend both ways. */
function tradingPost(sim: Simulation): Entity {
  const post = buildingAt(sim, BUILDING_HOME_00, ONE);
  sim.world.mut(post, Owner).player = NEIGHBOUR;
  sim.world.add(post, MissionObjectId, { id: TRADING_POST_ID });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: NEIGHBOUR, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR, to: HUMAN_PLAYER, state: 'friend' });
  sim.step();
  return post;
}

describe('right-clicking a standing house with a trader', () => {
  it('puts the house on the trade route instead of hiring or housing the trader', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);

    expect(await rightClick(sim, [trader], home)).toEqual([
      { kind: 'attachTradeHouse', entity: trader, house: home },
    ]);
  });

  it('with Shift walks the trader there queued, a trade stop being a standing setting', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);

    expect(await rightClick(sim, [trader], home, sim.content, true, 'settlers', true)).toEqual([
      expect.objectContaining({ kind: 'moveUnit', entity: trader, queued: true }),
    ]);
  });

  it('puts the house on the route of a trader waiting inside a house', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);
    sim.world.remove(trader, Position);

    expect(await rightClick(sim, [trader], home, sim.content, true, 'riders')).toEqual([
      { kind: 'attachTradeHouse', entity: trader, house: home },
    ]);
    // Inside a house it has nowhere to walk, so Shift still toggles the stop.
    expect(await rightClick(sim, [trader], home, sim.content, true, 'riders', true)).toEqual([
      { kind: 'attachTradeHouse', entity: trader, house: home },
    ]);
  });

  it("puts the house on the route of a selected cart's trader standing beside it", async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);
    const cart = riddenVehicle(sim, VEHICLE_HANDCART, trader);

    expect(await rightClick(sim, [cart], home, sim.content, true, 'riders')).toEqual([
      { kind: 'attachTradeHouse', entity: trader, house: home },
    ]);
  });

  it('puts the house on the route of the trader pulling a selected cart', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);
    const cart = spawnVehicleDirect(sim, VEHICLE_HANDCART, VEHICLE_AT.x, VEHICLE_AT.y);
    sim.world.mut(cart, Vehicle).hauler = trader;
    sim.world.add(trader, HaulingCart, { vehicle: cart, taken: false, parked: true, lift: null });

    expect(await rightClick(sim, [cart], home, sim.content, true, 'riders')).toEqual([
      { kind: 'attachTradeHouse', entity: trader, house: home },
    ]);
  });

  it('leaves a Shift click to the cart, which drives there queued, a trade stop being a standing setting', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);
    const cart = riddenVehicle(sim, VEHICLE_HANDCART, trader);

    expect(await pressRightClick(sim, [cart], home, sim.content, true, 'riders', true)).toEqual({
      issued: [],
      ordered: false,
      flashed: [],
      tradeRefused: [],
    });
  });

  it('orders a trader selected together with its cart only once', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);
    const cart = riddenVehicle(sim, VEHICLE_HANDCART, trader);
    sim.world.remove(trader, Position);
    expect(await rightClick(sim, [trader, cart], home, sim.content, true, 'riders')).toEqual([
      { kind: 'attachTradeHouse', entity: trader, house: home },
    ]);
  });

  it('groups 1000 fresh host-approved trade-route changes at the answer boundary', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const traders = Array.from({ length: 1000 }, () => settlerAt(sim, JOB_TRADER));
    expect(await rightClick(sim, traders, home)).toEqual([
      {
        kind: 'unitActionGroup',
        members: traders.map((entity) => ({ entity })),
        action: { kind: 'attachTradeHouse', house: home },
      },
    ]);
  });

  it("leaves a selected ship's trader passenger alone, so the ship takes the click", async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const ship = riddenVehicle(sim, VEHICLE_SHIP_SMALL, settlerAt(sim, JOB_TRADER));

    expect(await pressRightClick(sim, [ship], home, sim.content, true, 'riders')).toEqual({
      issued: [],
      ordered: false,
      flashed: [],
      tradeRefused: [],
    });
  });

  it('takes a house the route already names off it', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);
    components.addTradeStop(sim.world, trader, home);

    expect(await rightClick(sim, [trader], home)).toEqual([
      { kind: 'detachTradeHouse', entity: trader, house: home },
    ]);
  });

  it('leaves the rest of the selection to the usual ladder', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const shop = bakery(sim);
    const house = buildingAt(sim, shop.typeId, ONE);
    const trader = settlerAt(sim, JOB_TRADER);
    const baker = settlerAt(sim, shop.craftJob);

    const issued = await rightClick(sim, [trader, baker], house);
    const route = issued.filter((order) => order.kind === 'attachTradeHouse');
    const rest = issued.filter((order) => order.kind !== 'attachTradeHouse');

    expect(route).toEqual([{ kind: 'attachTradeHouse', entity: trader, house }]);
    expect(postedWorkers(rest, house).map((member) => member.entity)).toEqual([baker]);
  });

  it("walks the rest of the selection to another tribe's house the trader routes", async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const post = tradingPost(sim);
    const trader = settlerAt(sim, JOB_TRADER);
    const builder = settlerAt(sim, JOB_BUILDER);
    components.addTradeAgreement(sim.world, {
      missionId: TRADING_POST_ID,
      giveGood: GOOD_WOOD,
      giveAmount: 1,
      takeGood: GOOD_STONE,
      takeAmount: 1,
    });

    const issued = await rightClick(sim, [trader, builder], post, sim.content, false);

    const route = issued.filter((order) => order.kind === 'attachTradeHouse');
    const rest = issued.filter((order) => order.kind !== 'attachTradeHouse');
    expect(route).toEqual([{ kind: 'attachTradeHouse', entity: trader, house: post }]);
    expect(rest.map((order) => ('entity' in order ? order.entity : undefined))).toEqual([builder]);
  });

  it("walks a trader to another tribe's house that offers no agreement", async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const post = tradingPost(sim);
    const trader = settlerAt(sim, JOB_TRADER);

    const issued = await rightClick(sim, [trader], post, sim.content, false);

    expect(issued.map((order) => order.kind)).toEqual(['moveUnit']);
  });

  it('reports the house a route refused, and nothing when the route took it', async () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const post = tradingPost(sim);
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const trader = settlerAt(sim, JOB_TRADER);

    expect((await pressRightClick(sim, [trader], post, sim.content, false)).tradeRefused).toEqual([post]);
    expect((await pressRightClick(sim, [trader], home)).tradeRefused).toEqual([]);
  });
});
