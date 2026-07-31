import {
  Building,
  CurrentAtomic,
  Livestock,
  LivestockVisit,
  MoveGoal,
  Owner,
  Position,
  Settler,
  StayPoint,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { headquartersOf } from '../ai-player/shared.js';
import type { System, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { isLivestockWorkplaceType, stayPointRangeOf } from '../readviews/index.js';
import { canonicalById, entityNode, isTravelling, manhattan } from '../spatial/nodes.js';

/** Re-anchoring cadence (ticks). A slow sweep, not an event chain: claims, new farms, and demolitions
 *  all converge within a period. Approximated (the original's herding cadence is not readable). */
export const LIVESTOCK_ASSIGN_PERIOD_TICKS = 25;

/** Node offsets ringing an anchor door - each herd member takes its own grazing spot BESIDE the
 *  workplace instead of the doorway itself (user feedback: the herd stacked in the entrance and made
 *  it unclickable). Mixed radii 3-6 read as loose grazing, not a formation. */
const GRAZE_OFFSETS: readonly (readonly [number, number])[] = [
  [3, 1],
  [-3, -1],
  [1, 3],
  [-1, -3],
  [4, -1],
  [-4, 1],
  [-1, 4],
  [1, -4],
  [5, 2],
  [-5, -2],
  [2, 5],
  [-2, -5],
  [6, 0],
  [-6, 0],
  [0, 6],
  [0, -6],
];

/** Upper bound (node Manhattan) on how far a grazing spot sits from its door - the widest
 *  {@link GRAZE_OFFSETS} entry; scene checks and tests assert against it. */
export const LIVESTOCK_GRAZE_RANGE_NODES = 7;

/**
 * LivestockAssignmentSystem - claimed animals herd themselves home. Each period, every player's owned
 * {@link Livestock} creatures re-anchor their {@link StayPoint} leash onto grazing spots ringing the
 * player's built livestock workplaces - split round-robin across the farm doors in canonical id order
 * (so a two-farm player's stock spreads evenly), each member on its own {@link GRAZE_OFFSETS} spot -
 * or ringing the headquarters door while no farm stands. An idle animal still
 * beyond its own leash walks straight home (a {@link MoveGoal} on the anchor - the original's claimed
 * stock marches to the HQ/farm rather than drifting); inside the leash the grazing drive
 * (`animalWanderSystem`) takes over. No farm and no HQ leaves the current territory untouched.
 * Species are not matched to farms (the extracted animal farm feeds both; even split is a named
 * approximation).
 *
 * Source basis: observed original behaviour - claimed animals walk to the HQ area, then distribute
 * around breeding farms. Determinism: canonical member and farm order; per-player groups are disjoint,
 * so player iteration order cannot change the result. No-ops in a mapless sim.
 */
export const livestockAssignmentSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  if (ctx.tick % LIVESTOCK_ASSIGN_PERIOD_TICKS !== 0) return;
  const terrain = ctx.terrain;
  const byPlayer = new Map<number, Entity[]>();
  for (const e of canonicalById(world.query(Livestock, Owner, Settler, Position))) {
    if (world.has(e, LivestockVisit)) continue; // booked by a batch - herding resumes on release
    const player = world.get(e, Owner).player;
    const herd = byPlayer.get(player);
    if (herd === undefined) byPlayer.set(player, [e]);
    else herd.push(e);
  }
  for (const [player, herd] of byPlayer) {
    const anchors = anchorNodes(world, ctx, terrain, player);
    if (anchors.length === 0) continue;
    herd.forEach((e, i) => {
      const door = anchors[i % anchors.length];
      if (door === undefined) return; // unreachable: i % length indexes a non-empty array
      // Each member grazes on its own ring spot beside the door, never IN the doorway - the door
      // node stays clear for the summoned visitor and the operators.
      const cell = grazeAnchor(terrain, door, Math.floor(i / anchors.length));
      const stay = world.tryGet(e, StayPoint);
      if (stay === undefined) world.add(e, StayPoint, { cell });
      else if (stay.cell !== cell) {
        world.write(e, StayPoint, (s) => {
          s.cell = cell;
        });
      }
      // March home: an idle animal beyond its own territory leash heads straight for the anchor
      // (re-issued each period until it arrives - self-healing against a refused route). The
      // herding-system guards: never yank a running atomic or fight an in-flight walk.
      if (world.has(e, CurrentAtomic) || isTravelling(world, e)) return;
      const range = stayPointRangeOf(ctx.content, world.get(e, Settler).tribe);
      if (manhattan(terrain, entityNode(world, terrain, e), cell) <= range) return;
      world.add(e, MoveGoal, { cell });
    });
  }
};

/** The `k`-th grazing spot around `door`: the first walkable same-component ring offset starting at
 *  `k` (wrapping - a herd deeper than the ring reuses spots), falling back to the door itself when
 *  nothing beside it is standable (an island doorway). */
function grazeAnchor(terrain: TerrainGraph, door: NodeId, k: number): NodeId {
  const at = terrain.coordsOf(door);
  for (let i = 0; i < GRAZE_OFFSETS.length; i++) {
    const offset = GRAZE_OFFSETS[(k + i) % GRAZE_OFFSETS.length];
    if (offset === undefined) continue; // unreachable: the index is taken modulo the table length
    if (!terrain.inBounds(at.x + offset[0], at.y + offset[1])) continue;
    const node = terrain.nodeAt(at.x + offset[0], at.y + offset[1]);
    if (!terrain.isWalkable(node)) continue;
    if (terrain.componentOf(node) !== terrain.componentOf(door)) continue;
    return node;
  }
  return door;
}

/** The player's leash anchors: its built livestock-workplace doors (canonical id order), else its HQ
 *  door, else none. */
function anchorNodes(world: World, ctx: SystemContext, terrain: TerrainGraph, player: number): NodeId[] {
  const doors: NodeId[] = [];
  for (const e of canonicalById(world.query(Building, Owner))) {
    if (world.get(e, Owner).player !== player) continue;
    const b = world.get(e, Building);
    if (b.built < ONE || !isLivestockWorkplaceType(ctx.content, b.buildingType)) continue;
    const door = interactionNodeId(world, ctx, terrain, e);
    if (door !== null) doors.push(door);
  }
  if (doors.length > 0) return doors;
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return [];
  const door = interactionNodeId(world, ctx, terrain, hq);
  return door === null ? [] : [door];
}
