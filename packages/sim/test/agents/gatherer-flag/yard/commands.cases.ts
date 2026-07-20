import { describe, expect, it } from 'vitest';
import {
  Building,
  DeliveryFlag,
  MoveGoal,
  Owner,
  PathRequest,
  Position,
  Resource,
  Settler,
  Stockpile,
  WorkFlag,
} from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../../src/index.js';
import { setGatherGood, setWorkFlag } from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf, grassMap, makeWoodcutter, riverMap, VIKING, WOOD, WOODCUTTER } from '../support.js';

describe('setWorkFlag command — place / move a gatherer flag (Ctrl+Right-Click)', () => {
  const PLAYER = 0;
  // A node at half-cell coords of tile (t,0): node (2t, 0).
  const nodeOfTile = (t: number): { x: number; y: number } => ({ x: 2 * t, y: 0 });

  function ownedGatherer(sim: Simulation, x: number, y: number): Entity {
    const e = makeWoodcutter(sim, x, y);
    sim.world.add(e, Owner, { player: PLAYER });
    return e;
  }
  const cmd = (entity: Entity, tile: number): Extract<Command, { kind: 'setWorkFlag' }> => ({
    kind: 'setWorkFlag',
    entity,
    ...nodeOfTile(tile),
  });

  it('creates a bound, DeliveryFlag-marked flag at the target for a gatherer with none', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const g = ownedGatherer(sim, 0, 0);
    expect(sim.world.has(g, WorkFlag)).toBe(false);

    setWorkFlag(sim.world, ctxOf(sim), cmd(g, 6));

    expect(sim.world.has(g, WorkFlag)).toBe(true);
    const wf = sim.world.get(g, WorkFlag);
    expect(sim.world.has(wf.flag, DeliveryFlag)).toBe(true); // marked so render draws the flag above goods
    expect(sim.world.has(wf.flag, Stockpile)).toBe(false); // a PURE marker — it stores nothing
    expect(fx.toInt(sim.world.get(wf.flag, Position).x)).toBe(6);
    expect(wf.radius).toBeGreaterThan(0);
  });

  it('RELOCATES the existing flag (same entity, new position) rather than making a second', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const g = ownedGatherer(sim, 0, 0);
    setWorkFlag(sim.world, ctxOf(sim), cmd(g, 5));
    const flag = sim.world.get(g, WorkFlag).flag;

    setWorkFlag(sim.world, ctxOf(sim), cmd(g, 11));

    expect(sim.world.get(g, WorkFlag).flag).toBe(flag); // same flag entity…
    expect(fx.toInt(sim.world.get(flag, Position).x)).toBe(11); // …moved to the new tile
    expect([...sim.world.query(DeliveryFlag)]).toHaveLength(1); // no second flag littered
  });

  it('SNAPS off an occupied resource/building field rather than dropping the order', () => {
    // Clicking the patch to work means clicking the body that blocks its own cells — the click the
    // player actually makes. Dropping it left the gatherer at its old flag with no feedback.
    const sim = new Simulation({ seed: 2, content: testContent(), map: grassMap(40, 1) });
    const gatherer = ownedGatherer(sim, 0, 0);
    const resource = sim.world.create();
    sim.world.add(resource, Position, { x: fx.fromInt(6), y: fx.fromInt(0) });
    sim.world.add(resource, Resource, { goodType: WOOD, remaining: 1, harvestAtomic: 24 });

    setWorkFlag(sim.world, ctxOf(sim), cmd(gatherer, 6));

    expect(sim.world.has(gatherer, WorkFlag)).toBe(true);
    const onResource = fx.toInt(sim.world.get(sim.world.get(gatherer, WorkFlag).flag, Position).x);
    expect(onResource).not.toBe(6); // never on the blocked cell itself…
    expect(Math.abs(onResource - 6)).toBeLessThanOrEqual(3); // …but beside the patch it was aimed at

    sim.world.destroy(resource);
    const building = sim.world.create();
    sim.world.add(building, Position, { x: fx.fromInt(12), y: fx.fromInt(0) });
    sim.world.add(building, Building, { buildingType: 1, tribe: VIKING, built: ONE, level: 0 });

    setWorkFlag(sim.world, ctxOf(sim), cmd(gatherer, 12));

    const onBuilding = fx.toInt(sim.world.get(sim.world.get(gatherer, WorkFlag).flag, Position).x);
    expect(onBuilding).not.toBe(12);
    expect(Math.abs(onBuilding - 12)).toBeLessThanOrEqual(3);
  });

  it('rejects a click with no walkable node in snapping range (mid-lake)', () => {
    // A water band wider than the snap radius: there is no nearby ground to mean, so the order stands
    // rejected — the snap is a click tolerance, not a licence to relocate the yard anywhere.
    const lake = [...Array(21).keys()].map((i) => i + 5); // half-cell columns 5..25
    const water = new Simulation({ seed: 1, content: testContent(), map: riverMap(40, 1, lake) });
    const gatherer = ownedGatherer(water, 0, 0);

    setWorkFlag(water.world, ctxOf(water), cmd(gatherer, 7)); // node x=14, deep inside the band

    expect(water.world.has(gatherer, WorkFlag)).toBe(false);
  });

  it('clears a stale failed route when the flag moves, so delivery replans', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const gatherer = ownedGatherer(sim, 0, 0);
    setWorkFlag(sim.world, ctxOf(sim), cmd(gatherer, 5));
    sim.world.add(gatherer, MoveGoal, { cell: 10 });
    sim.world.add(gatherer, PathRequest, { start: 0, goal: 10, failed: true });

    setWorkFlag(sim.world, ctxOf(sim), cmd(gatherer, 11));

    expect(sim.world.has(gatherer, MoveGoal)).toBe(false);
    expect(sim.world.has(gatherer, PathRequest)).toBe(false);
  });

  it('accepts only harvestable goods for the gatherer filter, with null meaning all', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const gatherer = ownedGatherer(sim, 0, 0);
    setWorkFlag(sim.world, ctxOf(sim), cmd(gatherer, 5));

    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: WOOD });
    expect(sim.world.get(gatherer, WorkFlag).goodType).toBe(WOOD);
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: 4 });
    expect(sim.world.get(gatherer, WorkFlag).goodType).toBe(WOOD); // stone atomic is not allowed by this job
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: null });
    expect(sim.world.get(gatherer, WorkFlag).goodType).toBeUndefined();
  });

  it('skips an UNOWNED gatherer, a jobless settler, and a non-settler (only an owned gatherer gets a flag)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const unowned = makeWoodcutter(sim, 0, 0); // a gatherer, but no Owner
    const jobless = sim.world.create();
    sim.world.add(jobless, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(jobless, Settler, {
      tribe: VIKING,
      jobType: null, // employed at nothing → cannot harvest → no flag
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    sim.world.add(jobless, Owner, { player: PLAYER });
    const rock = sim.world.create(); // a non-settler entity

    setWorkFlag(sim.world, ctxOf(sim), cmd(unowned, 6));
    setWorkFlag(sim.world, ctxOf(sim), cmd(jobless, 6));
    setWorkFlag(sim.world, ctxOf(sim), cmd(rock, 6));

    expect(sim.world.has(unowned, WorkFlag)).toBe(false);
    expect(sim.world.has(jobless, WorkFlag)).toBe(false);
    expect([...sim.world.query(DeliveryFlag)]).toHaveLength(0); // nothing planted
  });

  it('routes through the command dispatch (enqueue → step) end to end', () => {
    const sim = new Simulation({ seed: 4, content: testContent(), map: grassMap(40, 1) });
    const g = ownedGatherer(sim, 0, 0);
    sim.enqueue(cmd(g, 6));
    sim.step();
    expect(sim.world.has(g, WorkFlag)).toBe(true);
    expect(fx.toInt(sim.world.get(sim.world.get(g, WorkFlag).flag, Position).x)).toBe(6);
  });
});

describe("spawnSettler gatherGood — a decoded map's authored setproducedgood", () => {
  const CARPENTER = 2; // a non-gathering trade: syncWorkFlagToJob plants it no flag
  const STONE = 4; // a fixture good whose harvest atomic (25) the woodcutter is NOT granted

  /** The first canonical (ascending-id) entity — a spawn command returns no id. */
  const spawned = (sim: Simulation): Entity => {
    const e = sim.world.canonicalEntities()[0];
    if (e === undefined) throw new Error('nothing spawned');
    return e;
  };

  function spawn(sim: Simulation, jobType: number, gatherGood?: number): Entity {
    sim.enqueue({
      kind: 'spawnSettler',
      jobType,
      x: 2,
      y: 0,
      tribe: VIKING,
      ...(gatherGood !== undefined ? { gatherGood } : {}),
    });
    sim.step();
    return spawned(sim);
  }

  it('narrows the auto-planted work flag to the authored good (an imported wood collector stays one)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const g = spawn(sim, WOODCUTTER, WOOD);
    expect(sim.world.get(g, WorkFlag).goodType).toBe(WOOD);
  });

  it('leaves the gather-everything default when the map authors no pick', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const g = spawn(sim, WOODCUTTER);
    expect(sim.world.get(g, WorkFlag).goodType).toBeUndefined();
  });

  it('ignores a good the trade cannot harvest, and a trade with no flag at all', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const g = spawn(sim, WOODCUTTER, STONE);
    expect(sim.world.get(g, WorkFlag).goodType).toBeUndefined(); // bad pick ⇒ gathers everything

    const other = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const c = spawn(other, CARPENTER, WOOD);
    expect(other.world.has(c, WorkFlag)).toBe(false); // no flag to narrow — no crash, no stamp
  });
});
