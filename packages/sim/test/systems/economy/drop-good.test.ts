import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, GroundDrop, Position, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, Simulation } from '../../../src/index.js';
import { nodeOfPosition } from '../../../src/nav/halfcell.js';
import { dynamicBlockOverlay } from '../../../src/systems/footprint/index.js';
import { MAX_GROUND_STACK } from '../../../src/systems/stores/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/**
 * `dropGood` - the "place this good on the ground" order. It drops a loose good pile as a bare
 * {@link Stockpile} + {@link Position} (NO {@link GroundDrop}/{@link Building} marker), so the pile draws as
 * a per-fill heap that GROWS with its contents and rests in place (not a felled-trunk pickup source). A
 * repeat drop of the same good on the same tile STACKS onto the existing pile, capped at
 * {@link MAX_GROUND_STACK}, so one-unit clicks pile up rather than littering an entity per click. Bad input
 * (an unknown good, a non-positive amount) is an id-neutral skip, still logged for faithful replay. A drop
 * aimed at a building body lands beside it.
 */

const WOOD = 5;
const STONE = 3;
const UNKNOWN_GOOD = 99;
const HALL = 7;
/** The hall's anchor, a node of its walk-blocked body. */
const HALL_NODE = { x: 12, y: 4 } as const;
const PIXELS_PER_TILE = 65536; // ONE - the fixed-point tile unit a Position uses.

function dropContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood' },
      { typeId: STONE, id: 'stone' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    tribes: [{ typeId: 1, id: 'viking' }],
  });
}

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
    sim.enqueueSetup({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 4 });
    sim.step();

    const pile = onlyPile(sim);
    // A loose pile: no felled-trunk marker (draws as a growing heap, rests in place), no building.
    expect(sim.world.has(pile, GroundDrop)).toBe(false);
    expect(sim.world.has(pile, Building)).toBe(false);
    // The pile holds exactly the dropped amount of the dropped good - nothing conjured, nothing lost.
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(4);
    const pos = sim.world.get(pile, Position);
    expect([pos.x, pos.y]).toEqual([6 * PIXELS_PER_TILE, 7 * PIXELS_PER_TILE]);
  });

  it('stacks a repeat drop of the same good on the same tile into ONE pile (one-unit clicks pile up)', () => {
    const sim = fresh();
    const anchor = cellAnchorNode(5, 5);
    for (let i = 0; i < 3; i++) {
      sim.enqueueSetup({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 1 });
    }
    sim.step();

    const pile = onlyPile(sim); // one entity, not three
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(3);
  });

  it('caps a stacked pile at MAX_GROUND_STACK (extra drops are absorbed, not overflowed)', () => {
    const sim = fresh();
    const anchor = cellAnchorNode(2, 2);
    for (let i = 0; i < MAX_GROUND_STACK + 3; i++) {
      sim.enqueueSetup({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 1 });
    }
    sim.step();

    const pile = onlyPile(sim);
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(MAX_GROUND_STACK);
  });

  it('does NOT merge a different good onto an existing pile (each good keeps its own heap)', () => {
    const sim = fresh();
    const anchor = cellAnchorNode(3, 3);
    sim.enqueueSetup({ kind: 'dropGood', good: WOOD, x: anchor.hx, y: anchor.hy, amount: 2 });
    sim.enqueueSetup({ kind: 'dropGood', good: STONE, x: anchor.hx, y: anchor.hy, amount: 2 });
    sim.step();

    const piles = [...sim.world.query(Stockpile, Position)].filter((e) => !sim.world.has(e, Building));
    expect(piles).toHaveLength(2); // two separate heaps on the same tile - neither overwritten
  });

  it('skips a non-positive amount (id-neutral, still logged for faithful replay)', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'dropGood', good: WOOD, x: 0, y: 0, amount: 0 });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.entityCount).toBe(0); // no entity id burned
    expect(sim.commands.log).toHaveLength(1); // but recorded so replay stays faithful
  });

  it('skips a good absent from the catalog (recoverable bad input - no throw, still logged)', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'dropGood', good: UNKNOWN_GOOD, x: 0, y: 0, amount: 3 });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.entityCount).toBe(0);
    expect(sim.commands.log).toHaveLength(1);
  });

  it('lands a drop aimed at a building body on open ground beside it', () => {
    const base = dropContent();
    const content = parseContentSet({
      ...base,
      landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
      buildings: [
        {
          typeId: HALL,
          id: 'hall',
          kind: 'workplace',
          footprint: { blocked: [-1, 0, 1].map((dx) => ({ dx, dy: 0 })), door: { dx: 2, dy: 0 } },
        },
      ],
    });
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(24, 8) });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HALL, x: HALL_NODE.x, y: HALL_NODE.y, tribe: 1 });
    sim.enqueueSetup({ kind: 'dropGood', good: WOOD, x: HALL_NODE.x, y: HALL_NODE.y, amount: 1 });
    sim.step();

    const pile = onlyPile(sim);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: terrain missing');
    const pos = sim.world.get(pile, Position);
    const node = nodeOfPosition(pos.x, pos.y);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(node.hx, node.hy))).toBe(
      false,
    );
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(1);
  });
});
