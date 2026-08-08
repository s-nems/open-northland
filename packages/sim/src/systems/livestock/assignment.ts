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
import { seatBaseOf } from '../ai-player/base.js';
import type { System, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { isLivestockWorkplaceType, stayPointRangeOf } from '../readviews/index.js';
import { manhattan } from '../spatial/metric.js';
import { canonicalById, entityNode, isTravelling } from '../spatial/nodes.js';

/** Re-anchoring cadence (ticks): a slow sweep, so claims, new farms, and demolitions converge within a
 *  period. Approximated; the original's herding cadence is not readable. */
export const LIVESTOCK_ASSIGN_PERIOD_TICKS = 25;

/** Node offsets ringing an anchor door - each herd member grazes beside the workplace rather than in the
 *  doorway, which must stay clear and clickable. Mixed radii 3-6 read as loose grazing, not a formation. */
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

/** Upper bound (node Manhattan) on how far a grazing spot sits from its door: the widest
 *  {@link GRAZE_OFFSETS} entry. */
export const LIVESTOCK_GRAZE_RANGE_NODES = 7;

/** How far (node Manhattan) a claimed animal may drift from its grazing spot before it is walked home.
 *  Overrides the species' wider wild-territory radius, which reads as straying next to a farm. */
export const LIVESTOCK_GRAZE_LEASH_NODES = 3;

/** A claimed animal's effective leash: its species territory capped at the grazing leash. The march-home
 *  sweep and the grazing drive must agree on it, or an animal would be marched back every period. */
export function grazeLeashOf(content: SystemContext['content'], tribe: number): number {
  return Math.min(stayPointRangeOf(content, tribe), LIVESTOCK_GRAZE_LEASH_NODES);
}

/**
 * Claimed animals herd themselves home: each period every player's owned {@link Livestock} creatures
 * re-anchor their {@link StayPoint} onto grazing spots ringing the player's built livestock workplaces,
 * split round-robin across the farm doors in canonical id order, or ringing the seat's base door while no
 * farm stands. An idle animal beyond {@link LIVESTOCK_GRAZE_LEASH_NODES} walks straight back to its
 * anchor; inside the leash the grazing drive takes over.
 *
 * Source basis: observed original behaviour, claimed animals walk to the HQ area and then distribute
 * around breeding farms. Species are not matched to farms (named approximation). Determinism: canonical
 * member and farm order, with disjoint per-player groups. No-ops in a mapless sim.
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
      const cell = grazeAnchor(terrain, door, Math.floor(i / anchors.length));
      const stay = world.tryGet(e, StayPoint);
      if (stay === undefined) world.add(e, StayPoint, { cell });
      else if (stay.cell !== cell) {
        world.mut(e, StayPoint).cell = cell;
      }
      // Re-issued each period until it arrives, and never on top of a running atomic or in-flight walk.
      if (world.has(e, CurrentAtomic) || isTravelling(world, e)) return;
      const range = grazeLeashOf(ctx.content, world.get(e, Settler).tribe);
      if (manhattan(terrain, entityNode(world, terrain, e), cell) <= range) return;
      world.add(e, MoveGoal, { cell });
    });
  }
};

/** The `k`-th grazing spot around `door`: the first walkable same-component ring offset from `k`,
 *  wrapping, and falling back to the door itself when nothing beside it is standable. */
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

/** The player's leash anchors: its built livestock-workplace doors (canonical id order), else its base
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
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return [];
  const door = interactionNodeId(world, ctx, terrain, base);
  return door === null ? [] : [door];
}
