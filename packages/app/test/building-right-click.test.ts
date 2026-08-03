import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { Command, Entity, Fixed, WorldSnapshot } from '@open-northland/sim';
import { components, fx, ONE, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_BUILDER, JOB_JOINER } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { BUILDING_BARRACKS, BUILDING_HOME_00, sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';

/**
 * The right-click ladder over an own building. A construction site is hired into by the rules of the
 * building it will become, with one rung on top: a trade that can raise a foundation joins its crew
 * instead. Moving in and drilling are the standing building's own rules - the sim honours neither on a
 * foundation - so a site drops through those to employment rather than answering with a dead click.
 */

const { Building, Owner, Position, Settler, Stockpile, UnderConstruction } = components;

/** A bakery - the workplace whose craft slot the click should hire into. */
const BAKERY = 'work_bakery_00';

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
  sim.world.add(e, Settler, {
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

/** Right-click `building` with `settler` selected and return the commands it enqueued. `content` overrides
 *  the sim's own content set - the routing decision is a pure function of (snapshot, content). */
function rightClick(
  sim: Simulation,
  settler: Entity,
  building: Entity,
  content: ContentSet = sim.content,
): Command[] {
  const issued: Command[] = [];
  const snapshot = sim.snapshot();
  const pickable: Pickable = { ref: building, x: 0, y: 0 };
  const targets: UnitTargets = {
    owned: (kind) => (kind === 'building' ? [pickable] : []),
    enemies: () => [],
    flags: () => [],
    signposts: () => [],
    ownedSettlersIn: () => [{ ref: settler, x: 0, y: 0 }],
  };
  createUnitOrderController({
    selected: new Set<number>([settler]),
    targets,
    snapshot: (): WorldSnapshot => snapshot,
    content,
    mapSize: { width: 16, height: 16 },
    toWorld: () => ({ x: 0, y: 0 }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
  }).issueRightClick(CLICK);
  return issued;
}

/** The click itself carries no information here - `toWorld` above pins the world point, and the
 *  controller reads nothing else off the event. Node has no DOM to mint a real one. */
const CLICK = { clientX: 0, clientY: 0 } as MouseEvent;

/** The sandbox bakery's typeId and its first craft slot's job - what a hire into it must bind. */
function bakery(sim: Simulation): { typeId: number; craftJob: number } {
  const def = [...lastByTypeId(sim.content.buildings).values()].find((b) => b.id === BAKERY);
  const craftJob = def?.workers[0]?.jobType;
  if (def === undefined || craftJob === undefined) throw new Error(`${BAKERY} has no worker slot`);
  return { typeId: def.typeId, craftJob };
}

describe('right-clicking a construction site', () => {
  it('puts a builder on the foundation', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId);
    const builder = settlerAt(sim, JOB_BUILDER);

    expect(rightClick(sim, builder, site)).toEqual([{ kind: 'assignBuilder', entity: builder, site }]);
  });

  it('puts ANY trade that may raise a foundation on it, not just the builder id', () => {
    // Real content gives the build-house atomic to the joiner and armorer as well as the builder; the
    // sandbox catalog gives it to the builder alone, so the case grants it to a second trade by hand.
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId);
    const joiner = settlerAt(sim, JOB_JOINER);
    const content = sim.content;
    const alsoBuilds: ContentSet = {
      ...content,
      jobs: content.jobs.map((job) =>
        job.typeId === JOB_JOINER
          ? { ...job, allowedAtomics: [...job.allowedAtomics, systems.BUILD_HOUSE_ATOMIC_ID] }
          : job,
      ),
    };

    expect(rightClick(sim, joiner, site, alsoBuilds)).toEqual([
      { kind: 'assignBuilder', entity: joiner, site },
    ]);
  });

  it('employs a builder at a STANDING building - the crew rung belongs to the foundation alone', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const standing = buildingAt(sim, bakery(sim).typeId, ONE);
    const builder = settlerAt(sim, JOB_BUILDER);

    const issued = rightClick(sim, builder, standing);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ kind: 'assignWorker', entity: builder, building: standing });
  });

  it('hires any other trade into the building the foundation will become', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { typeId, craftJob } = bakery(sim);
    const site = siteAt(sim, typeId);
    const idle = settlerAt(sim, null);

    const issued = rightClick(sim, idle, site);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ kind: 'assignWorker', entity: idle, building: site });
    // The craft slot leads the priority list - the carrier slot is only the fallback (assignmentPriority).
    expect((issued[0] as Extract<Command, { kind: 'assignWorker' }>).jobPriority[0]).toBe(craftJob);
  });

  it('staffs a barracks foundation instead of sending the settler to drill in it', () => {
    // Drilling needs the barracks standing (mayDrillAt), so the site takes the settler into its own
    // transport slot instead; the drill offer comes back the moment the barracks is finished.
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_BARRACKS);
    const idle = settlerAt(sim, null);

    const issued = rightClick(sim, idle, site);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ kind: 'assignWorker', entity: idle, building: site });
  });

  it('leaves a home foundation alone - no worker slots, and no family slot until it stands', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, BUILDING_HOME_00);
    const idle = settlerAt(sim, null);

    expect(rightClick(sim, idle, site)).toEqual([]);
  });
});

describe('right-clicking a standing building', () => {
  it('moves the family into a finished home', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const home = buildingAt(sim, BUILDING_HOME_00, ONE);
    const idle = settlerAt(sim, null);

    expect(rightClick(sim, idle, home)).toEqual([{ kind: 'assignHouse', entity: idle, house: home }]);
  });

  it('sends a trade the barracks does not employ to drill there', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const barracks = buildingAt(sim, BUILDING_BARRACKS, ONE);
    const idle = settlerAt(sim, null);

    expect(rightClick(sim, idle, barracks)).toEqual([
      { kind: 'trainSoldier', entity: idle, house: barracks },
    ]);
  });
});
