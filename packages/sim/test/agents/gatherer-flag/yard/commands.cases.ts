import { describe, expect, it } from 'vitest';
import {
  DeliveryFlag,
  Owner,
  Position,
  Settler,
  Stockpile,
  WorkFlag,
} from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { setWorkFlag } from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf, grassMap, makeWoodcutter, VIKING } from '../support.js';

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
