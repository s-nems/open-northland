import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentAtomic, MoveGoal, Position, Resource, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { clearComponentStores } from '../../src/harness/stores.js';
import { fx, Simulation } from '../../src/index.js';
import { aiSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * Unit tests for the AISystem harvest planner's `needforgood` XP-THRESHOLD gate — the *who-may-do-it*
 * progression gate, the per-settler sibling of the production-side tribe-presence `jobEnablesGood`
 * gate. A settler may only harvest a resource whose harvested good its accrued XP clears (`needforgood
 * <good> <amount> <expType…>`); a settler that hasn't reached the threshold won't even pick the node.
 *
 * The shared fixture's only `needforgood` is on PLANK (good 2) — never a harvestable good — so it
 * leaves the harvest planner inert. To exercise the gate we inject a `needforgood` on WOOD (the
 * fixture's one harvestable good) into the in-memory IR: producing/harvesting wood (good 1) needs 20
 * XP in the wood track (typeId 1). The woodcutter accrues that very track by harvesting wood, so the
 * gate is self-consistent — a fresh woodcutter is held out until pre-seeded XP clears it.
 */

const WOOD = 1;
const WOOD_TRACK = 1; // the wood-specific humanjobexperiencetype typeId in the fixture
const WOODCUTTER = 1;
const VIKING = 1;
const HARVEST_ATOMIC = 24;

beforeEach(() => {
  clearComponentStores();
});

/**
 * A content set whose viking tribe gates harvesting WOOD behind `needforgood 1 20 [1]` — a wood-track
 * XP threshold on a harvestable good (the shared fixture only thresholds PLANK, which is never
 * harvested). The IR is plain post-parse data, so a test may author the requirement directly.
 */
function woodGatedContent(): ReturnType<typeof testContent> {
  const content = testContent();
  content.tribes[0].jobRequirements.push({
    requirement: 'need',
    target: 'good',
    targetId: WOOD,
    amount: 20,
    experienceTypes: [WOOD_TRACK],
  });
  return content;
}

/** Spawn a woodcutter at (x,y) carrying the given pre-seeded wood-track XP. */
function woodcutterAt(sim: Simulation, x: number, y: number, woodXp: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(woodXp > 0 ? [[WOOD_TRACK, woodXp]] : []),
  });
  return e;
}

function woodAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: HARVEST_ATOMIC });
  return e;
}

describe('AISystem harvest planner — needforgood XP-threshold gate', () => {
  it('does not target a wood node when the settler is below the wood threshold', () => {
    const sim = new Simulation({ seed: 1, content: woodGatedContent(), map: grassMap(4, 1) });
    const cutter = woodcutterAt(sim, 0, 0, 19); // one short of the 20-XP threshold
    woodAt(sim, 1, 0);

    aiSystem(sim.world, {
      content: sim.content,
      rng: sim.rng,
      tick: sim.tick,
      events: sim.events,
      ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
    });

    // Below threshold: the planner picks no harvest target (no MoveGoal toward the node, no atomic).
    expect(sim.world.has(cutter, MoveGoal)).toBe(false);
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
  });

  it('targets the wood node once the settler clears the wood threshold', () => {
    const sim = new Simulation({ seed: 1, content: woodGatedContent(), map: grassMap(4, 1) });
    const cutter = woodcutterAt(sim, 0, 0, 20); // exactly at the 20-XP threshold
    woodAt(sim, 1, 0);

    aiSystem(sim.world, {
      content: sim.content,
      rng: sim.rng,
      tick: sim.tick,
      events: sim.events,
      ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
    });

    // Cleared: the planner heads for the (distant) node — a MoveGoal toward the wood cell.
    expect(sim.world.has(cutter, MoveGoal)).toBe(true);
  });

  it('an unthresholded good leaves the planner inert (the shared fixture: WOOD ungated)', () => {
    // The shared fixture has no `needforgood` on WOOD, so even a zero-XP woodcutter may harvest it.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const cutter = woodcutterAt(sim, 0, 0, 0);
    woodAt(sim, 1, 0);

    aiSystem(sim.world, {
      content: sim.content,
      rng: sim.rng,
      tick: sim.tick,
      events: sim.events,
      ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
    });

    expect(sim.world.has(cutter, MoveGoal)).toBe(true); // ungated: harvests freely from 0 XP
  });
});
