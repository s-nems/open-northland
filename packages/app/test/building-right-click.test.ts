import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { Command, Entity, Fixed, GroupWorker, WorldSnapshot } from '@open-northland/sim';
import { components, fx, ONE, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { BUILD_HOUSE_ATOMIC } from '../src/catalog/atomics.js';
import { JOB_BUILDER, JOB_JOINER } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { BUILDING_BARRACKS, BUILDING_HOME_00, sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';

/**
 * The right-click ladder over an own building. A construction site is hired into by the rules of the
 * building it will become, with one rung on top: a builder joins its crew
 * instead. A family may reserve a home before it stands; drilling still requires a completed building.
 */

const { addPerson, Building, Female, Owner, Position, Stockpile, UnderConstruction } = components;

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
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

/** Right-click `building` with `settlers` selected and return the commands it enqueued. `content` overrides
 *  the sim's own content set - the routing decision is a pure function of (snapshot, content). */
function rightClick(
  sim: Simulation,
  settlers: readonly Entity[],
  building: Entity,
  content: ContentSet = sim.content,
): Command[] {
  return pressRightClick(sim, settlers, building, content).issued;
}

/** {@link rightClick} with the press's own verdict, which decides whether the click confirms. */
function pressRightClick(
  sim: Simulation,
  settlers: readonly Entity[],
  building: Entity,
  content: ContentSet = sim.content,
): { issued: Command[]; ordered: boolean } {
  const issued: Command[] = [];
  const snapshot = sim.snapshot();
  const pickable: Pickable = { ref: building, x: 0, y: 0 };
  const targets: UnitTargets = {
    owned: (kind) => (kind === 'building' ? [pickable] : []),
    buildings: () => [pickable],
    enemies: () => [],
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [],
    resources: () => [],
    wildlife: () => [],
    ownedSettlersIn: () => settlers.map((ref) => ({ ref, x: 0, y: 0 })),
  };
  const ordered = createUnitOrderController({
    selected: () => new Set<number>(settlers),
    targets,
    snapshot: (): WorldSnapshot => snapshot,
    content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
  }).issueRightClick(CLICK);
  return { issued, ordered };
}

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
  it('puts a builder on the foundation', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId);
    const builder = settlerAt(sim, JOB_BUILDER);

    expect(rightClick(sim, [builder], site)).toEqual([{ kind: 'assignBuilder', entity: builder, site }]);
  });

  it('does not turn a non-builder with the hammer atomic into a site builder', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId); // a bakery employs no joiner - nothing to post him into
    const joiner = settlerAt(sim, JOB_JOINER);

    const [posted] = postedWorkers(rightClick(sim, [joiner], site, alsoBuilds(sim, JOB_JOINER)), site);
    expect(posted?.entity).toBe(joiner);
    expect(posted?.jobPriority).not.toContain(JOB_BUILDER);
  });

  it('posts a craft worker into his future workshop to carry its materials', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { typeId, craftJob } = workplace(sim, JOINERY);
    const site = siteAt(sim, typeId);
    const joiner = settlerAt(sim, craftJob);

    const [posted] = postedWorkers(rightClick(sim, [joiner], site, alsoBuilds(sim, craftJob)), site);
    expect(posted?.entity).toBe(joiner);
    expect(posted?.jobPriority[0]).toBe(craftJob);
  });

  it('employs a builder at a STANDING building - the crew rung belongs to the foundation alone', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const standing = buildingAt(sim, bakery(sim).typeId, ONE);
    const builder = settlerAt(sim, JOB_BUILDER);

    expect(postedWorkers(rightClick(sim, [builder], standing), standing).map((w) => w.entity)).toEqual([
      builder,
    ]);
  });

  it('hires any other trade into the building the foundation will become', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { typeId, craftJob } = bakery(sim);
    const site = siteAt(sim, typeId);
    const idle = settlerAt(sim, null);

    const [posted] = postedWorkers(rightClick(sim, [idle], site), site);
    expect(posted?.entity).toBe(idle);
    // The craft slot leads the priority list - the carrier slot is only the fallback (assignmentPriority).
    expect(posted?.jobPriority[0]).toBe(craftJob);
  });

  it('staffs a barracks foundation instead of sending the settler to drill in it', () => {
    // Drilling needs the barracks standing (mayDrillAt), so the site takes the settler into its own
    // transport slot instead; the drill offer comes back the moment the barracks is finished.
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_BARRACKS);
    const idle = settlerAt(sim, null);

    expect(postedWorkers(rightClick(sim, [idle], site), site).map((w) => w.entity)).toEqual([idle]);
  });

  it('reserves a home foundation for the selected family', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_HOME_00);
    const idle = settlerAt(sim, null);

    expect(rightClick(sim, [idle], site)).toEqual([
      { kind: 'assignHouseGroup', members: [{ entity: idle }], house: site },
    ]);
  });
});

describe('right-clicking a standing building', () => {
  it('moves the family into a finished home', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const idle = settlerAt(sim, null);

    expect(rightClick(sim, [idle], home)).toEqual([
      { kind: 'assignHouseGroup', members: [{ entity: idle }], house: home },
    ]);
  });

  it('sends a whole group to a home as one order, so the sim houses the homeless first', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const group = [settlerAt(sim, null), settlerAt(sim, null), settlerAt(sim, null)];

    expect(rightClick(sim, group, home)).toEqual([
      { kind: 'assignHouseGroup', members: group.map((entity) => ({ entity })), house: home },
    ]);
  });

  it('posts a whole group to a workplace as one order, so the sim seats the unemployed first', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const standing = buildingAt(sim, bakery(sim).typeId, ONE);
    const group = [settlerAt(sim, null), settlerAt(sim, null)];

    expect(postedWorkers(rightClick(sim, group, standing), standing).map((w) => w.entity)).toEqual(group);
  });

  it('sends a trade the barracks does not employ to drill there', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const barracks = buildingAt(sim, BUILDING_BARRACKS, ONE);
    const idle = settlerAt(sim, null);

    expect(rightClick(sim, [idle], barracks)).toEqual([
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

  it('reports nothing when no selected settler may learn at the school', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const school = buildingAt(sim, schoolType(sim), ONE);
    const woman = settlerAt(sim, null);
    sim.world.add(woman, Female, { female: true });

    expect(pressRightClick(sim, [woman], school)).toEqual({ issued: [], ordered: false });
  });

  it('reports nothing when the foundation takes none of the selection', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, schoolType(sim)); // a school employs nobody and teaches only once it stands
    const idle = settlerAt(sim, null);

    expect(pressRightClick(sim, [idle], site)).toEqual({ issued: [], ordered: false });
  });

  it('reports the order a building did take', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);

    expect(pressRightClick(sim, [settlerAt(sim, null)], home).ordered).toBe(true);
  });
});
