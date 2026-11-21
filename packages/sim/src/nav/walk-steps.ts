import type { BlockOverlay } from './block-overlay.js';
import { hexDistanceBetween } from './halfcell.js';
import { NO_WALK } from './node-circle.js';
import { HEX_DX_EVEN, HEX_DX_ODD, HEX_DY } from './range-search.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/** Per-call scratch: each node's fewest steps over a window around the start, every slot
 *  {@link UNREACHED} between calls, and the open nodes as one linked stack per estimate (the first entry,
 *  then each entry's node, steps and successor), reset before use. */
let stepScratch = new Uint16Array(0);
let headScratch = new Int32Array(0);
let entryNodes = new Int32Array(0);
let entrySteps = new Int32Array(0);
let entryNext = new Int32Array(0);
const NO_ENTRY = -1;
/** A window slot no walk has reached yet: above every step count asked. */
const UNREACHED = 0xffff;
const INITIAL_ENTRIES = 1024;

function growEntries(): void {
  const size = Math.max(INITIAL_ENTRIES, 2 * entryNodes.length);
  const grown = [new Int32Array(size), new Int32Array(size), new Int32Array(size)] as const;
  grown[0].set(entryNodes);
  grown[1].set(entrySteps);
  grown[2].set(entryNext);
  [entryNodes, entrySteps, entryNext] = grown;
}

/**
 * The steps of the shortest walk from the open node `(fromX, fromY)` to `(toX, toY)` over the nodes a
 * step-counted `floodReach` enters, a node no walk stands on counted from the nearest neighbour one
 * does: what `enteredCost` and its neighbours tell off such a flood, found without flooding. A walk
 * longer than `within`, a finite step count, answers {@link NO_WALK}; undefined once the search has
 * settled `maxSettled` nodes, for a caller that then asks the flood.
 *
 * A search towards the goal: no walk is shorter than the hex distance, so a node is settled in order of
 * its steps plus its distance to the goal, the latest found first, which on open ground runs straight
 * there.
 */
export function walkStepsBetween(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  within: number,
  maxSettled: number,
): number | undefined {
  const direct = hexDistanceBetween(fromX, fromY, toX, toY);
  if (direct === 0) return 0;
  if (direct > within) return NO_WALK;
  // The walk ends one step past a neighbour of the goal, so a settled node lies fewer than `within`
  // steps out, and an estimate counts the steps to such a neighbour.
  const side = 2 * within + 1;
  const windowX = fromX - within;
  const windowY = fromY - within;
  if (stepScratch.length < side * side) stepScratch = new Uint16Array(side * side).fill(UNREACHED);
  const best = stepScratch;
  if (headScratch.length < within) headScratch = new Int32Array(within);
  const heads = headScratch;
  heads.fill(NO_ENTRY, 0, within);
  if (entryNodes.length === 0) growEntries();
  const resistances = terrain.walkableResistances();
  const mapWidth = terrain.width;
  const mapHeight = terrain.height;
  let entries = 0;
  best[within * side + within] = 0;
  entryNodes[0] = fromY * mapWidth + fromX;
  entrySteps[0] = 0;
  entryNext[0] = NO_ENTRY;
  heads[direct - 1] = entries++;
  let settled = 0;
  let found: number | undefined = NO_WALK;
  search: for (let estimate = direct - 1; estimate < within; estimate++) {
    // A push lands on this stack or a later one, so the stack is popped until it stays empty.
    for (let entry = heads[estimate] as number; entry !== NO_ENTRY; entry = heads[estimate] as number) {
      heads[estimate] = entryNext[entry] as number;
      const node = entryNodes[entry] as number;
      const steps = entrySteps[entry] as number;
      const x = node % mapWidth;
      const y = (node - x) / mapWidth;
      if (best[(y - windowY) * side + x - windowX] !== steps) continue;
      if (hexDistanceBetween(x, y, toX, toY) === 1) {
        found = steps + 1;
        break search;
      }
      if (++settled > maxSettled) {
        found = undefined;
        break search;
      }
      const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
      for (let k = 0; k < HEX_DY.length; k++) {
        const nx = x + (dxs[k] as number);
        const ny = y + (HEX_DY[k] as number);
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) continue;
        const slot = (ny - windowY) * side + nx - windowX;
        if (steps + 1 >= (best[slot] as number)) continue;
        const id = ny * mapWidth + nx;
        if ((resistances[id] as number) === 0 || blocked.has(id as NodeId)) continue;
        const onward = steps + hexDistanceBetween(nx, ny, toX, toY);
        if (onward >= within) continue;
        best[slot] = steps + 1;
        if (entries === entryNodes.length) growEntries();
        entryNodes[entries] = id;
        entrySteps[entries] = steps + 1;
        entryNext[entries] = heads[onward] as number;
        heads[onward] = entries++;
      }
    }
  }
  // Every slot written belongs to an entry: clearing those keeps the window unreached for the next
  // call at the cost of the nodes this search touched, not of the whole window.
  for (let entry = 0; entry < entries; entry++) {
    const node = entryNodes[entry] as number;
    const x = node % mapWidth;
    const y = (node - x) / mapWidth;
    best[(y - windowY) * side + x - windowX] = UNREACHED;
  }
  return found;
}
