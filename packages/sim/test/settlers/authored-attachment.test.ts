import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Residence,
  Settler,
  WALK_RANGE_NODES,
  WorkFlag,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import { type Entity, Simulation } from '../../src/index.js';
import { assignWorker } from '../../src/systems/orders/work/employment.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * A decoded map's `attachtohouse`, applied as the settler spawns: it moves into the home and takes the post
 * standing on each anchor half-cell the verb names.
 */

const VIKING = 1;
const SMITH = 5;
const COLLECTOR = 6;
const CHILD = 7;
const CARRIER = 8;
const HOME = 2;
const SMITHY = 3;
const CHAPEL = 4;
const YARD = 5;
const WOOD_HARVEST_ATOMIC = 24;

/** Far enough apart that a confined civilian's walk range cannot reach across. */
const NEAR_X = 4;
const FAR_X = NEAR_X + 2 * WALK_RANGE_NODES;

function attachContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: 1, id: 'wood', atomics: { harvest: WOOD_HARVEST_ATOMIC }, gathering: { bioLandscape: true } },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SMITH, id: 'smith' },
      { typeId: COLLECTOR, id: 'collector', allowedAtomics: [WOOD_HARVEST_ATOMIC] },
      { typeId: CHILD, id: 'child_male' },
      { typeId: CARRIER, id: 'carrier' },
    ],
    buildings: [
      { typeId: HOME, id: 'home', kind: 'home', homeSize: 1 },
      // The carrier slot every real workplace offers - the demotion an authored post must never take.
      {
        typeId: SMITHY,
        id: 'smithy',
        kind: 'workplace',
        workers: [
          { jobType: SMITH, count: 2 },
          { jobType: CARRIER, count: 2 },
        ],
      },
      // The `frank church` shape: a workplace kind that employs nobody.
      { typeId: CHAPEL, id: 'chapel', kind: 'workplace' },
      // A collector post, so an authored gatherer can be both flag-capable and employable.
      { typeId: YARD, id: 'yard', kind: 'storage', workers: [{ jobType: COLLECTOR, count: 1 }] },
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
  });
}

type SpawnFields = Omit<Extract<Command, { kind: 'spawnSettler' }>, 'kind'>;

/** A world with signpost confinement on, like every playable world, then one building and the settlers. */
function attachWorld(building: { type: number; x: number }, ...spawns: SpawnFields[]): Simulation {
  const sim = new Simulation({
    seed: 1,
    content: attachContent(),
    map: grassNodeMap(FAR_X + 8, 8),
  });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: building.type,
    x: building.x,
    y: 2,
    tribe: VIKING,
    owner: 0,
    force: true,
  });
  for (const spawn of spawns) sim.enqueueSetup({ kind: 'spawnSettler', ...spawn });
  sim.run(1);
  return sim;
}

const settler = (jobType: number, x: number, extra: Partial<SpawnFields> = {}): SpawnFields => ({
  jobType,
  x,
  y: 2,
  tribe: VIKING,
  owner: 0,
  ...extra,
});

const only = (sim: Simulation, component: Parameters<Simulation['world']['query']>[0]): Entity => {
  const [first, ...rest] = [...sim.world.query(component)];
  if (first === undefined || rest.length > 0) throw new Error('expected exactly one match');
  return first;
};

const settlers = (sim: Simulation): Entity[] => [...sim.world.query(Settler)];

describe('authored attachtohouse on spawn', () => {
  it('moves the settler into the home standing on the named anchor', () => {
    const sim = attachWorld({ type: HOME, x: NEAR_X }, settler(SMITH, 0, { home: { x: NEAR_X, y: 2 } }));
    const house = only(sim, Building);
    expect(sim.world.get(settlers(sim)[0] as Entity, Residence).home).toBe(house);
  });

  it('posts the settler to the workplace on the named anchor, keeping its own trade', () => {
    const sim = attachWorld(
      { type: SMITHY, x: NEAR_X },
      settler(SMITH, 0, { workplace: { x: NEAR_X, y: 2 } }),
    );
    const smithy = only(sim, Building);
    const e = settlers(sim)[0] as Entity;
    expect(sim.world.get(e, JobAssignment).workplace).toBe(smithy);
    expect(sim.world.get(e, Settler).jobType).toBe(SMITH);
  });

  // The regression guard for the confinement trap: 32 of the corpus's 180 resolvable attachments sit
  // outside their settler's walk range, so routing this through the player's order would drop them
  // silently. The two `assignWorker` calls bracket the cause - the far one is refused while the slot is
  // provably still open, the near one takes it.
  it('attaches a target the player’s own assignWorker order would refuse as out of area', () => {
    const sim = attachWorld(
      { type: SMITHY, x: FAR_X },
      settler(SMITH, NEAR_X, { workplace: { x: FAR_X, y: 2 } }),
      settler(SMITH, NEAR_X),
      settler(SMITH, FAR_X - 2),
    );
    const smithy = only(sim, Building);
    const [attached, far, near] = settlers(sim) as [Entity, Entity, Entity];
    expect(sim.world.get(attached, JobAssignment).workplace).toBe(smithy);

    const post = (e: Entity): void =>
      assignWorker(sim.world, ctxOf(sim), {
        kind: 'assignWorker',
        entity: e,
        building: smithy,
        jobPriority: [SMITH],
      });
    post(far);
    expect(sim.world.has(far, JobAssignment)).toBe(false);
    post(near); // the second of two smith slots, so the refusal above was distance and not staffing
    expect(sim.world.get(near, JobAssignment).workplace).toBe(smithy);
  });

  it('leaves the settler unposted at a building that employs nobody', () => {
    const sim = attachWorld(
      { type: CHAPEL, x: NEAR_X },
      settler(SMITH, 0, { workplace: { x: NEAR_X, y: 2 } }),
    );
    expect(sim.world.has(settlers(sim)[0] as Entity, JobAssignment)).toBe(false);
  });

  it('leaves the settler unposted rather than demoting it when its trade’s slots are full', () => {
    const sim = attachWorld(
      { type: SMITHY, x: NEAR_X },
      ...[0, 1, 3].map((x) => settler(SMITH, x, { workplace: { x: NEAR_X, y: 2 } })),
    );
    const posted = settlers(sim).filter((e) => sim.world.has(e, JobAssignment));
    expect(posted).toHaveLength(2); // the type's two smith slots
    // The third smith stays a smith rather than taking one of the two free carrier slots.
    for (const e of settlers(sim)) expect(sim.world.get(e, Settler).jobType).toBe(SMITH);
  });

  it('leaves no home slot for a second family beyond homeSize', () => {
    const sim = attachWorld(
      { type: HOME, x: NEAR_X },
      settler(SMITH, 0, { home: { x: NEAR_X, y: 2 } }),
      settler(SMITH, 1, { home: { x: NEAR_X, y: 2 } }),
    );
    const [first, second] = settlers(sim) as [Entity, Entity];
    expect(sim.world.has(first, Residence)).toBe(true);
    expect(sim.world.has(second, Residence)).toBe(false); // homeSize 1, one family
  });

  // Housing moves a whole household, so a minor cannot claim a family slot on its own - the same rule
  // the player's `assignHouse` applies.
  it('refuses to house a settler spawned as a child', () => {
    const sim = attachWorld(
      { type: HOME, x: NEAR_X },
      settler(CHILD, 0, { home: { x: NEAR_X, y: 2 } }),
      settler(SMITH, 1, { home: { x: NEAR_X, y: 2 } }),
    );
    const [child, adult] = settlers(sim) as [Entity, Entity];
    expect(sim.world.has(child, Residence)).toBe(false);
    expect(sim.world.has(adult, Residence)).toBe(true); // the slot the child did not take
  });

  it('drops an attachment naming an anchor no building stands on', () => {
    const sim = attachWorld(
      { type: SMITHY, x: NEAR_X },
      settler(SMITH, 0, { workplace: { x: NEAR_X + 1, y: 2 } }),
    );
    expect(sim.world.has(settlers(sim)[0] as Entity, JobAssignment)).toBe(false);
  });

  // Employment retires the work flag a bound gatherer no longer works, so its authored `setproducedgood`
  // has nothing left to narrow.
  it('retires an employed gatherer’s work flag, and with it the authored gather pick', () => {
    const sim = attachWorld(
      { type: YARD, x: NEAR_X },
      settler(COLLECTOR, 0, { gatherGood: 1 }),
      settler(COLLECTOR, 1, { gatherGood: 1, workplace: { x: NEAR_X, y: 2 } }),
    );
    const [unposted, posted] = settlers(sim) as [Entity, Entity];
    expect(sim.world.get(unposted, WorkFlag).goodType).toBe(1);
    expect(sim.world.has(posted, JobAssignment)).toBe(true);
    expect(sim.world.has(posted, WorkFlag)).toBe(false);
  });
});
