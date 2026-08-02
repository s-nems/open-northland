import { lastByTypeId } from '@open-northland/data';
import type { Command, Entity, WorldSnapshot } from '@open-northland/sim';
import { components, fx, ONE, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_BUILDER } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';

/**
 * Right-clicking a construction site splits by trade: a BUILDER is put on the foundation
 * (`assignBuilder`), and anyone else is hired into the building it will become (`assignWorker`) - a
 * building takes its staff from the moment the foundation is placed, and that staff waits at the site.
 */

const { Building, Owner, Position, Settler, Stockpile, UnderConstruction } = components;

/** A bakery foundation - a workplace whose craft slot the click should hire into. */
const SITE_BUILDING = 'work_bakery_00';

function siteAt(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: PRIMARY_TRIBE, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

function settlerAt(sim: Simulation, jobType: number | null, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
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

/** Right-click `site` with `settler` selected and return the commands it enqueued. */
function rightClickSite(sim: Simulation, settler: Entity, site: Entity): Command[] {
  const issued: Command[] = [];
  const snapshot = sim.snapshot();
  const pickable: Pickable = { ref: site, x: 0, y: 0 };
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
    content: sim.content,
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
  const def = [...lastByTypeId(sim.content.buildings).values()].find((b) => b.id === SITE_BUILDING);
  const craftJob = def?.workers[0]?.jobType;
  if (def === undefined || craftJob === undefined) throw new Error(`${SITE_BUILDING} has no worker slot`);
  return { typeId: def.typeId, craftJob };
}

describe('right-clicking a construction site', () => {
  it('puts a builder on the foundation', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const site = siteAt(sim, bakery(sim).typeId, 4, 4);
    const builder = settlerAt(sim, JOB_BUILDER, 2, 4);

    expect(rightClickSite(sim, builder, site)).toEqual([{ kind: 'assignBuilder', entity: builder, site }]);
  });

  it('hires any other trade into the building the foundation will become', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { typeId, craftJob } = bakery(sim);
    const site = siteAt(sim, typeId, 4, 4);
    const idle = settlerAt(sim, null, 2, 4);

    const issued = rightClickSite(sim, idle, site);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ kind: 'assignWorker', entity: idle, building: site });
    // The craft slot leads the priority list - the carrier slot is only the fallback (assignmentPriority).
    expect((issued[0] as Extract<Command, { kind: 'assignWorker' }>).jobPriority[0]).toBe(craftJob);
  });
});
