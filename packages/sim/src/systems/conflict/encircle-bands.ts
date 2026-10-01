import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { forEachNodeInBand, type WeaponBand } from './weapon-band.js';

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
 * the band, in the order the wall discs first visit them. The dynamic walk block is left to the reader,
 * so a held band reads only the target's body: a body that differs from the held one re-derives it.
 */
export class EncircleBands {
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

/** {@link EncircleBands.cellsOf} derived fresh: O(body × disc) ring visits and O(cells × body) distances. */
function bandGeometry(terrain: TerrainGraph, body: readonly NodeId[], band: WeaponBand): readonly NodeId[] {
  const visited = new Set<NodeId>();
  const cells: NodeId[] = [];
  const disc = { minRange: 0, maxRange: band.maxRange };
  for (const wall of body) {
    forEachNodeInBand(terrain, wall, disc, (cell) => {
      if (visited.has(cell)) return true; // adjacent walls' discs overlap - evaluate each cell once
      visited.add(cell);
      if (!terrain.isWalkable(cell)) return true;
      const reach = distanceToBody(terrain, cell, body); // to the NEAREST wall, as the reach check measures
      if (reach >= band.minRange && reach <= band.maxRange) cells.push(cell);
      return true;
    });
  }
  return cells;
}

/** Map-point distance from `cell` to the nearest cell of `body` - how the combat reach to a building is
 *  measured. */
function distanceToBody(terrain: TerrainGraph, cell: NodeId, body: readonly NodeId[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const wall of body) min = Math.min(min, hexNodeDistance(terrain, cell, wall));
  return min;
}

function sameNodes(a: readonly NodeId[], b: readonly NodeId[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
