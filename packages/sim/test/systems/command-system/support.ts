import { Position } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type ScriptLandscapeType, Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';

/**
 * Tests for CommandSystem + the serializable command queue + the snapshot read-view (the
 * only-way-state-mutates seam). A command enqueued via `sim.enqueue` is applied on the next
 * `step()`'s CommandSystem pass, appended to the command log, and surfaced through events; the
 * snapshot is a plain, canonical, non-aliasing read-view render consumes instead of live stores.
 *
 * Fixture (fixtures/content.ts): building type 1 = HEADQUARTERS (storage, stock wood init 10 / plank
 * init 0), job 1 = woodcutter.
 */

export const HEADQUARTERS = 1;
export const SAWMILL = 2; // a workplace (one carpenter slot, a plank recipe) - its operator gets bound
export const SMITHY = 4; // tech-gated: viking `jobEnablesHouse 2 4` locks it behind a carpenter (job 2)
export const WOODCUTTER = 1;
export const CARPENTER = 2; // the job that unlocks the SMITHY for the viking tribe
export const WOOD = 1;
export const PLANK = 2; // the sawmill recipe's output - an HQ stock slot whose `initial` is 0
export const VIKING = 1;
export const FRANK = 2; // a tribe absent from the fixture's tribe table - its tech-graph gates nothing

/** The map catalog's wall rows these cases place: a one-post wall and a five-wide gate, closed and open. */
export const WALL_ROW = 691;
export const GATE_ROW = 696;
const OPEN_GATE_ROW = 700;
const WALL_POST = { dx: 0, dy: 0 };
const GATE_SPAN = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));

function wallRow(
  typeId: number,
  walk: ScriptLandscapeType['walk'],
  gate?: { open: boolean; counterpartGfxIndex: number },
): ScriptLandscapeType {
  return {
    typeId,
    walk,
    build: walk,
    groups: [],
    wall: {
      maxHitpoints: 100,
      repairPerStrike: 1,
      construction: [{ goodType: WOOD, amount: 1 }],
      ...(gate === undefined ? {} : { gate }),
    },
  };
}

export const WALL_ROWS: readonly ScriptLandscapeType[] = [
  wallRow(WALL_ROW, [WALL_POST]),
  wallRow(GATE_ROW, GATE_SPAN, { open: false, counterpartGfxIndex: OPEN_GATE_ROW }),
  wallRow(OPEN_GATE_ROW, [GATE_SPAN[0] ?? WALL_POST, GATE_SPAN[4] ?? WALL_POST], {
    open: true,
    counterpartGfxIndex: GATE_ROW,
  }),
];

export function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

/** The nth canonical (ascending-id) entity, asserting it exists - keeps tests free of `!`. */
export function nthEntity(sim: Simulation, n: number): Entity {
  const ids = sim.world.canonicalEntities().filter((entity) => sim.world.has(entity, Position));
  const e = ids[n];
  if (e === undefined) throw new Error(`no entity at index ${n} (have ${ids.length})`);
  return e;
}
