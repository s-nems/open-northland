import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Owner, Position, Settler } from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { assignWorker } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The `assignWorker` command — the player-directed twin of the JobSystem's automatic assignment: bind
 * an OWNED settler to a SPECIFIC building as a worker (set its `jobType` to the building's open slot +
 * stamp its {@link JobAssignment} binding), through the same per-building openness gate the JobSystem
 * applies. So a hand assignment can never reach a state the economy wouldn't.
 *
 * The shared fixture's sawmill (type 2) declares one carpenter slot; the HQ (type 1) declares three
 * woodcutter slots — mirrors job-system.test.ts.
 */

const VIKING = 1;
const HUMAN = 0;
const CARPENTER = 2; // the sawmill's worker job
const SAWMILL = 2; // building type

function placeBuilding(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  return e;
}

/** An OWNED, idle viking settler (assignWorker only touches a player's own units). */
function settler(sim: Simulation, owner: number | null = HUMAN): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  if (owner !== null) sim.world.add(e, Owner, { player: owner });
  return e;
}

// The sawmill offers only CARPENTER; the priority list carries it (plus the HQ's woodcutter, which the
// sawmill doesn't offer — proving the building-doesn't-offer entry is skipped, not bound).
const WOODCUTTER = 1;
const assign = (entity: Entity, building: Entity): Command => ({
  kind: 'assignWorker',
  entity,
  building,
  jobPriority: [WOODCUTTER, CARPENTER],
});

describe('assignWorker — bind an owned settler to a chosen building', () => {
  it('sets the building’s worker job and binds the settler to THAT building', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5);
    const worker = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(worker, mill));

    expect(sim.world.get(worker, Settler).jobType).toBe(CARPENTER);
    expect(sim.world.get(worker, JobAssignment).workplace).toBe(mill);
  });

  it('binds to the CHOSEN building, not the first open one the economy would pick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    placeBuilding(sim, SAWMILL, 5, 5); // an earlier, also-open sawmill
    const chosen = placeBuilding(sim, SAWMILL, 9, 9); // the one the player clicks
    const worker = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(worker, chosen));

    expect(sim.world.get(worker, JobAssignment).workplace).toBe(chosen);
  });

  it('is a no-op at a FULL building (its one slot already staffed) — capacity is respected', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5); // count 1
    const first = settler(sim);
    const second = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(first, mill)); // fills the one slot
    assignWorker(sim.world, ctxOf(sim), assign(second, mill)); // building now full

    expect(sim.world.get(first, JobAssignment).workplace).toBe(mill);
    expect(sim.world.get(second, Settler).jobType).toBeNull(); // rejected: no open slot
    expect(sim.world.has(second, JobAssignment)).toBe(false);
  });

  it('re-binds an already-employed settler to a different building', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const millA = placeBuilding(sim, SAWMILL, 5, 5);
    const millB = placeBuilding(sim, SAWMILL, 9, 9);
    const worker = settler(sim);

    assignWorker(sim.world, ctxOf(sim), assign(worker, millA));
    assignWorker(sim.world, ctxOf(sim), assign(worker, millB));

    expect(sim.world.get(worker, JobAssignment).workplace).toBe(millB); // moved off A onto B
  });

  it('skips a NEUTRAL (unowned) settler — only a player’s own unit is assignable', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5);
    const neutral = settler(sim, null); // no Owner

    assignWorker(sim.world, ctxOf(sim), assign(neutral, mill));

    expect(sim.world.get(neutral, Settler).jobType).toBeNull();
    expect(sim.world.has(neutral, JobAssignment)).toBe(false);
  });

  it('binds the FIRST job in the priority list that the building actually offers', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hq = placeBuilding(sim, 1, 5, 5); // the HQ offers WOODCUTTER (job 1), not CARPENTER (job 2)
    const worker = settler(sim);

    // Priority prefers CARPENTER, but the HQ doesn't offer it — so the walk skips to WOODCUTTER.
    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: worker,
      building: hq,
      jobPriority: [CARPENTER, WOODCUTTER],
    });

    expect(sim.world.get(worker, Settler).jobType).toBe(WOODCUTTER);
    expect(sim.world.get(worker, JobAssignment).workplace).toBe(hq);
  });

  it('is a no-op when the priority list offers no job the building employs (or is empty)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = placeBuilding(sim, SAWMILL, 5, 5); // offers CARPENTER only
    const a = settler(sim);
    const b = settler(sim);

    // A list that names only jobs the sawmill doesn't offer → no bind.
    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: a,
      building: mill,
      jobPriority: [WOODCUTTER],
    });
    // An empty preference list → no bind.
    assignWorker(sim.world, ctxOf(sim), { kind: 'assignWorker', entity: b, building: mill, jobPriority: [] });

    for (const s of [a, b]) {
      expect(sim.world.get(s, Settler).jobType).toBeNull();
      expect(sim.world.has(s, JobAssignment)).toBe(false);
    }
  });

  it('skips a non-building target (a stale/hostile command)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const worker = settler(sim);
    const other = settler(sim); // a settler id, not a building

    assignWorker(sim.world, ctxOf(sim), assign(worker, other));

    expect(sim.world.get(worker, Settler).jobType).toBeNull();
    expect(sim.world.has(worker, JobAssignment)).toBe(false);
  });
});
