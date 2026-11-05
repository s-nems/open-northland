import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { WeaponBand } from './weapon-band.js';

// The static half of a besieged target's encircle band, held across ticks. Derived state, never hashed.

/** Held targets past which a newly held one first drops the dead targets; the bound then doubles off
 *  what survives, so the sweep is amortized over the targets it holds. */
const HELD_TARGETS_BEFORE_SWEEP = 64;

/** One target's held geometry: the body it was derived for and, per weapon band, its cells. */
interface HeldTarget {
  readonly body: readonly NodeId[];
  readonly bands: Map<string, { readonly band: WeaponBand; readonly cells: readonly NodeId[] }>;
}

/**
 * Per target and weapon band, the statically walkable cells whose reach to the body's nearest wall lies in
 * the band, row by row. The dynamic walk block is left to the reader, so a held band reads only the
 * target's body: a body that differs from the held one re-derives it.
 */
class EncircleBands {
  private readonly targets = new Map<Entity, HeldTarget>();
  private sweepAbove = HELD_TARGETS_BEFORE_SWEEP;

  constructor(
    private readonly world: World,
    readonly terrain: TerrainGraph,
  ) {}

  /** The held band of `target` with `body` for `band`, derived on first ask or after the body changed. */
  cellsOf(target: Entity, body: readonly NodeId[], band: WeaponBand): readonly NodeId[] {
    let held = this.targets.get(target);
    if (held === undefined || !sameNodes(held.body, body)) {
      held = { body, bands: new Map() };
      this.targets.set(target, held);
      if (this.targets.size > this.sweepAbove) this.dropDead();
    }
    const key = `${band.minRange}:${band.maxRange}`;
    const cached = held.bands.get(key);
    if (cached !== undefined) return cached.cells;
    const cells = bandGeometry(this.terrain, body, band);
    held.bands.set(key, { band: { minRange: band.minRange, maxRange: band.maxRange }, cells });
    return cells;
  }

  private dropDead(): void {
    for (const target of [...this.targets.keys()]) {
      if (!this.world.isAlive(target)) this.targets.delete(target);
    }
    this.sweepAbove = Math.max(HELD_TARGETS_BEFORE_SWEEP, 2 * this.targets.size);
  }

  /** Every held band must match a fresh derivation from the body it was held for. */
  verify(): string[] {
    for (const [target, held] of this.targets) {
      for (const { band, cells } of held.bands.values()) {
        if (!sameNodes(cells, bandGeometry(this.terrain, held.body, band))) {
          return [`encircleBands holds a stale band for target ${target}`];
        }
      }
    }
    return [];
  }
}

const bandsByWorld = new WeakMap<World, EncircleBands>();

/** The world's {@link EncircleBands} on `terrain`. */
export function encircleBands(world: World, terrain: TerrainGraph): EncircleBands {
  const held = bandsByWorld.get(world);
  if (held !== undefined && held.terrain === terrain) return held;
  const created = new EncircleBands(world, terrain);
  bandsByWorld.set(world, created);
  world.registerCacheVerifier('encircleBands', () => created.verify());
  return created;
}

/** Marks a node of the sweep box no wall has reached yet. */
const UNREACHED = -1;

/**
 * {@link EncircleBands.cellsOf} derived fresh, row by row and ascending within a row: a breadth-first sweep of
 * map-point steps from every wall at once, out to the band's far edge, reaches each node of the box around
 * the body once, at its distance to the nearest wall, the reach the combat check measures. Map points are the
 * lattice's step metric and a shortest step path stays inside the box its two ends span, so clipping the
 * sweep to the box and the map loses no node.
 */
export function bandGeometry(
  terrain: TerrainGraph,
  body: readonly NodeId[],
  band: WeaponBand,
): readonly NodeId[] {
  if (body.length === 0) return [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const wall of body) {
    const x = terrain.xOf(wall);
    const y = terrain.yOf(wall);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const x0 = Math.max(0, minX - band.maxRange);
  const y0 = Math.max(0, minY - band.maxRange);
  const width = Math.min(terrain.width - 1, maxX + band.maxRange) - x0 + 1;
  const height = Math.min(terrain.height - 1, maxY + band.maxRange) - y0 + 1;
  const reach = new Int32Array(width * height).fill(UNREACHED);
  const queue = new Int32Array(width * height);
  let tail = 0;
  for (const wall of body) {
    const at = (terrain.yOf(wall) - y0) * width + (terrain.xOf(wall) - x0);
    if (reach[at] !== UNREACHED) continue;
    reach[at] = 0;
    queue[tail++] = at;
  }
  const reachOut = (x: number, y: number, distance: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = y * width + x;
    if (reach[at] !== UNREACHED) return;
    reach[at] = distance;
    queue[tail++] = at;
  };
  for (let head = 0; head < tail; head++) {
    const at = queue[head] ?? 0;
    const distance = reach[at] ?? 0;
    if (distance >= band.maxRange) continue;
    const x = at % width;
    const y = (at - x) / width;
    const next = distance + 1;
    reachOut(x - 1, y, next);
    reachOut(x + 1, y, next);
    // A step to the next row up or down lands on the node above or below and on one neighbour of it: east
    // when that row is even, west when it is odd, as `stepHex` turns.
    const side = ((y + 1 + y0) & 1) === 0 ? x + 1 : x - 1;
    reachOut(x, y - 1, next);
    reachOut(side, y - 1, next);
    reachOut(x, y + 1, next);
    reachOut(side, y + 1, next);
  }
  const cells: NodeId[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = reach[y * width + x] ?? UNREACHED;
      if (distance < band.minRange) continue; // an unreached node reads below every band
      const cell = terrain.nodeAt(x + x0, y + y0);
      if (terrain.isWalkable(cell)) cells.push(cell);
    }
  }
  return cells;
}

function sameNodes(a: readonly NodeId[], b: readonly NodeId[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
