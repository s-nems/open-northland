import type { World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { WalkBlockMask } from '../footprint/walk-block-mask.js';
import { WalkFlood } from './walk-distance.js';

/** Floods a world keeps between spot searches; the least recently asked goes first. Authored: about a
 *  seat's worth of origins, a few hundred kilobytes of cost pages each. */
const HELD_FLOODS = 8;

interface HeldFlood {
  readonly flood: WalkFlood;
  /** The mask version the flood's reads were last proved current at. */
  version: number;
}

/**
 * The carriers' walk floods out of an origin, held across spot searches and ticks while every overlay
 * answer they read still holds, so an origin whose candidates all lie past the flood's budget pays the
 * full flood once rather than on every search. A resumed flood is the one a fresh flood grows into, so a
 * held one answers exactly as a fresh one would. Derived state, never hashed.
 */
export class HeldFloods {
  private readonly floods = new Map<string, HeldFlood>();

  constructor(
    readonly terrain: TerrainGraph,
    readonly mask: WalkBlockMask,
  ) {}

  floodOf(seed: NodeId, budget: number): WalkFlood {
    const key = `${seed}:${budget}`;
    const version = this.mask.version;
    const held = this.floods.get(key);
    this.floods.delete(key);
    let entry: HeldFlood;
    if (held?.flood.readsHoldOn(this.mask, held.version) === true) {
      held.version = version;
      entry = held;
    } else {
      entry = { flood: new WalkFlood(this.terrain, this.mask, [seed], budget), version };
    }
    this.floods.set(key, entry);
    if (this.floods.size > HELD_FLOODS) {
      const oldest = this.floods.keys().next().value;
      if (oldest !== undefined) this.floods.delete(oldest);
    }
    return entry.flood;
  }
}

const heldByWorld = new WeakMap<World, HeldFloods>();

/** The world's held floods over `mask`. */
export function heldFloodsOf(world: World, terrain: TerrainGraph, mask: WalkBlockMask): HeldFloods {
  let held = heldByWorld.get(world);
  if (held === undefined || held.terrain !== terrain || held.mask !== mask) {
    held = new HeldFloods(terrain, mask);
    heldByWorld.set(world, held);
  }
  return held;
}
