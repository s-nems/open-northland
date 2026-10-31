import { type Fixed, fx } from '../../../core/fixed.js';
import type { World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBaseOf } from '../base.js';
import { WalkFlood, walkLowerBound, walkSeedNear } from '../walk-distance.js';

/** How many times its straight-line walk a building spot's walk from the base door may cost, beyond
 *  {@link SPOT_WALK_SLACK_TILES} (authored). On ciezka_wspolpraca seed 7 every building on the base's
 *  side of the river walked at most 2 x its line + 1.1 tiles from the base door, and the six raised
 *  across it 2 x + 36 to 2 x + 85 tiles: close as the crow flies, half the map round the river on foot. */
export const SPOT_WALK_LINE_RATIO = 2;

/** The detour a spot near the base may take on top of {@link SPOT_WALK_LINE_RATIO}, in tiles (authored):
 *  round a pond or a grove beside the door, where the line is too short for the ratio alone. */
export const SPOT_WALK_SLACK_TILES = 8;

const SLACK: Fixed = fx.fromInt(SPOT_WALK_SLACK_TILES);

/** How far from the base door its walk seed may lie, in Manhattan nodes. */
const DOOR_SEED_RADIUS_NODES = 8;

/** The terrain alone: the test weighs the river bends a spot lies behind, which never move, so one
 *  flood serves the seat for the whole match. Buildings in the way are the acceptor's concern. */
const STATIC_GROUND: BlockOverlay = { size: 0, has: () => false };

interface HeldWalk {
  readonly terrain: TerrainGraph;
  readonly seed: NodeId;
  readonly flood: WalkFlood;
}

/** Each seat's walk flood out of its base door over {@link STATIC_GROUND}. It is lazy and its settle
 *  order never depends on the asks, so a held flood answers as a fresh one would; derived, never hashed. */
const heldWalks = new WeakMap<World, Map<number, HeldWalk>>();

function baseWalkOf(terrain: TerrainGraph, world: World, player: number, seed: NodeId): WalkFlood {
  let seats = heldWalks.get(world);
  if (seats === undefined) {
    seats = new Map();
    heldWalks.set(world, seats);
  }
  const held = seats.get(player);
  if (held !== undefined && held.terrain === terrain && held.seed === seed) return held.flood;
  // The whole map as budget: a flood only settles as far as the dearest walk asked of it.
  const flood = new WalkFlood(terrain, STATIC_GROUND, [seed], terrain.width * terrain.height);
  seats.set(player, { terrain, seed, flood });
  return flood;
}

/**
 * Whether a building spot lies within a fair walk of the seat's base door: at most
 * {@link SPOT_WALK_LINE_RATIO} times the straight-line walk plus {@link SPOT_WALK_SLACK_TILES}, over the
 * terrain. A spot off the door's land or on ground no one walks is left to the rules that own those.
 * Null for a seat with no base. Each ask floods the held walk on only as far as its own cap.
 */
export function baseWalkTest(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): ((x: number, y: number) => boolean) | null {
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return null;
  const door = interactionCell(world, ctx, terrain, base);
  const seed = terrain.isWalkable(door)
    ? door
    : walkSeedNear(
        terrain,
        STATIC_GROUND,
        { hx: terrain.xOf(door), hy: terrain.yOf(door) },
        DOOR_SEED_RADIUS_NODES,
      );
  if (seed === null) return null;
  const flood = baseWalkOf(terrain, world, player, seed);
  const land = terrain.componentOf(seed);
  const sx = terrain.xOf(seed);
  const sy = terrain.yOf(seed);
  return (x, y) => {
    const node = terrain.nodeAt(x, y);
    if (!terrain.isWalkable(node) || terrain.componentOf(node) !== land) return true;
    const cap = fx.add(fx.mulInt(walkLowerBound(sx, sy, x, y), SPOT_WALK_LINE_RATIO), SLACK);
    return flood.costWithin(node, cap) !== undefined;
  };
}
