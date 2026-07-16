import type { ContentSet, GoodType, JobType, TribeType } from '@open-northland/data';
import { checkInvariants, components, halfCellMapFromCells, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The gathering cycle end-to-end over the MERGED REAL content — the same geometry the sandbox twin
 * proves (`test/map-gatherer-cycle.test.ts`), but with every id resolved from whatever the pipeline
 * emitted instead of the clean-room tables. This is the net for the "sandbox green, real content
 * collapses" class (raw job-id spaces, tribe-wide base atomics, zeroed balance): a stall shows up as
 * wood never banked, a divergence as a same-seed hash mismatch. Skips without generated content.
 */

const { GroundDrop, Stockpile, WorkFlag } = components;

const SEED = 11;
/** Plenty of time for several full fell → pick up → bank cycles (mirrors the sandbox twin). */
const CYCLE_TICKS = 3000;
const MAP_CELLS = 40;
/** Spawn node + tree cluster in half-cell coords — the exact proven layout of the sandbox twin. */
const SPAWN = { x: 40, y: 40 } as const;
const CLUSTER = { x0: 44, x1: 52, y0: 34, y1: 42, step: 2 } as const;

/** An all-grass CELL map; the merge injects the sim nav classes so `TERRAIN_OPEN` resolves on real content. */
function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

/** Resolve wood + a trade granted its harvest + a playable tribe from the content, never from pinned ids. */
function resolveActors(content: ContentSet): {
  wood: GoodType;
  gathering: NonNullable<GoodType['gathering']>;
  harvest: number;
  gatherer: JobType;
  tribe: TribeType;
} {
  const wood = content.goods.find((g) => g.id === 'wood');
  if (wood?.gathering === undefined || wood.atomics.harvest === undefined)
    throw new Error('real content ships no gatherable wood');
  const harvest = wood.atomics.harvest;
  // Lowest typeId wins so the pick is deterministic across runs on the same content.
  const gatherer = [...content.jobs]
    .sort((a, b) => a.typeId - b.typeId)
    .find((j) => j.allowedAtomics.includes(harvest) && !j.forbiddenAtomics.includes(harvest));
  if (gatherer === undefined) throw new Error('no trade is granted the wood harvest atomic');
  const tribe = [...content.tribes]
    .sort((a, b) => a.typeId - b.typeId)
    .find((t) => t.jobEnables.length > 0 && t.hitpoints > 0);
  if (tribe === undefined) throw new Error('no playable tribe with hitpoints');
  return { wood, gathering: wood.gathering, harvest, gatherer, tribe };
}

/** Build the scenario sim: one wood gatherer (flag auto-planted at its feet) beside a dense tree cluster. */
function buildScenario(content: ContentSet): Simulation {
  const { wood, gathering, harvest, gatherer, tribe } = resolveActors(content);
  const sim = new Simulation({ seed: SEED, content, map: grassMap(MAP_CELLS) });
  sim.enqueue({
    kind: 'spawnSettler',
    jobType: gatherer.typeId,
    x: SPAWN.x,
    y: SPAWN.y,
    tribe: tribe.typeId,
    owner: HUMAN_PLAYER,
  });
  sim.step();
  expect([...sim.world.query(WorkFlag)].length, 'the gatherer spawn planted no work flag').toBeGreaterThan(0);
  for (let ty = CLUSTER.y0; ty <= CLUSTER.y1; ty += CLUSTER.step) {
    for (let tx = CLUSTER.x0; tx <= CLUSTER.x1; tx += CLUSTER.step) {
      const node = systems.createResourceNode(sim.world, content, {
        good: wood.typeId,
        x: tx,
        y: ty,
        remaining: gathering.yieldPerNode,
        harvestAtomic: harvest,
        ...(gathering.chopsToFell > 0 ? { felling: { chopsLeft: gathering.chopsToFell } } : {}),
      });
      expect(node, `real wood could not footprint a node at (${tx},${ty})`).not.toBeNull();
    }
  }
  return sim;
}

/** Total of `good` lying in loose ground drops (an unfinished cycle leaves the trunk here). */
function looseGood(sim: Simulation, good: number): number {
  let sum = 0;
  for (const e of sim.world.query(GroundDrop, Stockpile)) {
    sum += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return sum;
}

/** Total of `good` banked in NON-drop stockpiles (the flag-side heaps a finished cycle produces). */
function bankedGood(sim: Simulation, good: number): number {
  let sum = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (sim.world.has(e, GroundDrop)) continue;
    sum += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return sum;
}

describe.runIf(hasRealIr())('gathering cycle over merged real content', () => {
  it('fells, banks wood at the flag, and holds the core invariants every tick', async () => {
    const { merge } = await loadContentUnderTest();
    const { wood, gathering } = resolveActors(merge.content);
    const sim = buildScenario(merge.content);
    for (let t = 0; t < CYCLE_TICKS; t++) {
      sim.step();
      const violations = checkInvariants(sim.world);
      expect(violations, `invariant broke at tick ${t + 1}`).toEqual([]);
    }
    expect(bankedGood(sim, wood.typeId), 'no wood ever banked — the cycle stalled').toBeGreaterThan(0);
    // After this long with one gatherer and a near flag, at most the one active carry lies loose.
    expect(looseGood(sim, wood.typeId)).toBeLessThanOrEqual(gathering.yieldPerNode);
  });

  it('is deterministic on real content: two same-seed runs end byte-identical', async () => {
    const { merge } = await loadContentUnderTest();
    const a = buildScenario(merge.content);
    const b = buildScenario(merge.content);
    for (let t = 0; t < CYCLE_TICKS; t++) {
      a.step();
      b.step();
    }
    expect(a.hashState()).toBe(b.hashState());
  });
});
