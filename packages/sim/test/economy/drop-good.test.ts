import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { Building, GroundDrop, Position, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, cellAnchorNode } from '../../src/index.js';
import { MAX_GROUND_STACK } from '../../src/systems/agents/effects-goods.js';

/**
 * `dropGood` — the "place this good on the ground" order. It drops a loose good pile as a bare
 * {@link Stockpile} + {@link Position} (NO {@link GroundDrop}/{@link Building} marker), so the pile draws as
 * a per-fill heap that GROWS with its contents and rests in place (not a felled-trunk pickup source). A
 * repeat drop of the same good on the same tile STACKS onto the existing pile, capped at
 * {@link MAX_GROUND_STACK}, so one-unit clicks pile up rather than littering an entity per click. Bad input
 * (an unknown good, a non-positive amount) is an id-neutral skip, still logged for faithful replay.
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
function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as { store: Map<unknown, unknown> }).store.clear();
    }
  }
}

beforeEach(clearComponentStores);

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: dropContent() });
}

/** The single loose ground pile (a bare Stockpile+Position with no building/trunk marker) in the world. */
function onlyPile(sim: Simulation): Entity {
  const piles = [...sim.world.query(Stockpile, Position)].filter(
    (e) => !sim.world.has(e, Building) && !sim.world.has(e, GroundDrop),
  );
  expect(piles).toHaveLength(1);
  return piles[0] as Entity;
}

describe('dropGood', () => {
  it('drops a loose bare-stockpile pile (no GroundDrop/Building) at the target tile', () => {
    const sim = fresh();
    // Command coords are half-cell nodes; cell (6,7)'s anchor node sits exactly on tile (6,7).
    const anchor = cellAnchorNode(6, 7);
    sim.enqueue({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 4 });
    sim.step();

    const pile = onlyPile(sim);
    // A loose pile: no felled-trunk marker (draws as a growing heap, rests in place), no building.
    expect(sim.world.has(pile, GroundDrop)).toBe(false);
    expect(sim.world.has(pile, Building)).toBe(false);
    // The pile holds exactly the dropped amount of the dropped good — nothing conjured, nothing lost.
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(4);
    const pos = sim.world.get(pile, Position);
    expect([pos.x, pos.y]).toEqual([6 * PIXELS_PER_TILE, 7 * PIXELS_PER_TILE]);
  });

  it('stacks a repeat drop of the same good on the same tile into ONE pile (one-unit clicks pile up)', () => {
    const sim = fresh();
    const anchor = cellAnchorNode(5, 5);
    for (let i = 0; i < 3; i++) {
      sim.enqueue({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 1 });
    }
    sim.step();

    const pile = onlyPile(sim); // one entity, not three
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(3);
  });

  it('caps a stacked pile at MAX_GROUND_STACK (extra drops are absorbed, not overflowed)', () => {
    const sim = fresh();
    const anchor = cellAnchorNode(2, 2);
    for (let i = 0; i < MAX_GROUND_STACK + 3; i++) {
      sim.enqueue({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 1 });
    }
    sim.step();

    const pile = onlyPile(sim);
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(MAX_GROUND_STACK);
  });

  it('does NOT merge a different good onto an existing pile (each good keeps its own heap)', () => {
    const sim = fresh();
    const anchor = cellAnchorNode(3, 3);
    sim.enqueue({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 2 });
    sim.enqueue({ kind: 'dropGood', good: STONE, x: anchor.hx, y: anchor.hy, amount: 2 });
    sim.step();

    const piles = [...sim.world.query(Stockpile, Position)].filter((e) => !sim.world.has(e, Building));
    expect(piles).toHaveLength(2); // two separate heaps on the same tile — neither overwritten
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

    clearComponentStores();
    const runB = fresh(7);
    drop(runB);
    const hashB = runB.hashState();

    expect(hashB).toBe(hashA);
  });
});
