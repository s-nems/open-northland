import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { GroundDrop, Position, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, cellAnchorNode } from '../../src/index.js';

/**
 * `dropGood` — the "place this good on the ground" order. It drops a loose good pile (a bare
 * {@link Stockpile} + {@link Position} + {@link GroundDrop}) at a tile, the SAME on-the-ground shape a
 * felled trunk / chipped ore takes, so the existing pickup/porter/delivery machinery hauls it off
 * unchanged. Bad input (an unknown good, a non-positive amount) is an id-neutral skip, still logged for
 * faithful replay — the same stance as an unknown building/resource id.
 */

const WOOD = 5;
const STONE = 3;
const UNKNOWN_GOOD = 99;
const PIXELS_PER_TILE = 65536; // ONE — the fixed-point tile unit a Position uses.

function dropContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood' },
      { typeId: STONE, id: 'stone' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    tribes: [{ typeId: 1, id: 'viking' }],
  });
}

/** Clear the WHOLE component namespace (module-level singletons) so runs can't leak into each other —
 *  a hand-picked subset would miss a component a future system adds (sim AGENTS.md). */
function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as { store: Map<unknown, unknown> }).store.clear();
    }
  }
}

beforeEach(clearStores);

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: dropContent() });
}

describe('dropGood', () => {
  it('drops a loose good pile: a Stockpile + GroundDrop + Position at the target tile', () => {
    const sim = fresh();
    // Command coords are half-cell nodes; cell (6,7)'s anchor node sits exactly on tile (6,7).
    const anchor = cellAnchorNode(6, 7);
    sim.enqueue({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 4 });
    sim.step();

    const piles = [...sim.world.query(GroundDrop)];
    expect(piles).toHaveLength(1);
    const pile = piles[0] as Entity;
    expect(sim.world.get(pile, GroundDrop).goodType).toBe(WOOD);
    // The pile holds exactly the dropped amount of the dropped good — nothing conjured, nothing lost.
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(4);
    const pos = sim.world.get(pile, Position);
    expect([pos.x, pos.y]).toEqual([6 * PIXELS_PER_TILE, 7 * PIXELS_PER_TILE]);
  });

  it('skips a non-positive amount (id-neutral, still logged for faithful replay)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'dropGood', good: WOOD, x: 0, y: 0, amount: 0 });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.entityCount).toBe(0); // no entity id burned
    expect(sim.commands.log).toHaveLength(1); // but recorded so replay stays faithful
  });

  it('skips a good absent from the catalog (recoverable bad input — no throw, still logged)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'dropGood', good: UNKNOWN_GOOD, x: 0, y: 0, amount: 3 });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.entityCount).toBe(0);
    expect(sim.commands.log).toHaveLength(1);
  });

  it('is deterministic: same seed + same commands on the same ticks => byte-identical state', () => {
    const drop = (sim: Simulation): void => {
      sim.enqueue({ kind: 'dropGood', good: WOOD, x: 4, y: 4, amount: 2 });
      sim.enqueue({ kind: 'dropGood', good: STONE, x: 6, y: 4, amount: 5 });
      sim.run(20);
    };
    const runA = fresh(7);
    drop(runA);
    const hashA = runA.hashState();

    clearStores();
    const runB = fresh(7);
    drop(runB);
    const hashB = runB.hashState();

    expect(hashB).toBe(hashA);
  });
});
