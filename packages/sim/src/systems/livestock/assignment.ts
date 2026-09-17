import {
  CurrentAtomic,
  DraughtAnimal,
  FarmAnimal,
  Livestock,
  MoveGoal,
  Owner,
  Position,
  Settler,
  StayPoint,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { seatBaseOf } from '../ai-player/base.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { isTravelling } from '../movement/nav-state.js';
import { stayPointRangeOf } from '../readviews/index.js';
import { manhattan } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { farmStands } from './herd.js';

/** Re-anchoring cadence (ticks): a slow sweep, so claims, adoptions, new farms, and demolitions converge
 *  within a period. Approximated; the original's herding cadence is not readable. */
export const LIVESTOCK_ASSIGN_PERIOD_TICKS = 25;

/** Node offsets ringing an anchor door - a herd member walks home beside the workplace rather than into
 *  the doorway, which must stay clear and clickable. Mixed radii 3-6 read as loose grazing, not a
 *  formation. */
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

/** Upper bound (node Manhattan) on how far a home spot sits from its door: the widest
 *  {@link GRAZE_OFFSETS} entry. */
export const LIVESTOCK_GRAZE_RANGE_NODES = 7;

/** How far (node Manhattan) a farm's animal may drift from the farm door before it is walked home. The
 *  original replaces a house-attached animal's own territory with a leader distance of 15 map points
 *  in the original, read here on the node lattice like every other animal radius. */
export const FARM_HERD_LEASH_NODES = 15;

/** How far a claimed animal no farm holds may drift from its spot by the headquarters. Overrides the
 *  species' wider wild-territory radius, which reads as straying next to the base. */
export const LIVESTOCK_GRAZE_LEASH_NODES = 3;

/** An owned animal's effective leash: 15 nodes around its farm's door, else its species territory capped
 *  at the base-yard leash. The march-home sweep and the grazing drive must agree on it, or an animal
 *  would be marched back every period. */
export function livestockLeashOf(world: World, ctx: SystemContext, e: Entity): number {
  if (world.has(e, FarmAnimal)) return FARM_HERD_LEASH_NODES;
  return Math.min(stayPointRangeOf(ctx.content, world.get(e, Settler).tribe), LIVESTOCK_GRAZE_LEASH_NODES);
}

/** How far an animal keeps from its {@link StayPoint}: a claimed animal's {@link livestockLeashOf}, else its
 *  species' wild territory. 0 is no territory. Grazing and flight both keep to it. */
export function territoryRangeOf(world: World, ctx: SystemContext, e: Entity): number {
  if (world.has(e, Livestock) && world.has(e, Owner)) return livestockLeashOf(world, ctx, e);
  return stayPointRangeOf(ctx.content, world.get(e, Settler).tribe);
}

/**
 * Claimed animals herd themselves home: each period every owned {@link Livestock} creature re-anchors its
 * {@link StayPoint} onto its farm's door - the original's birth point for a house-attached animal - or,
 * held by no farm, onto a spot ringing its player's base door. An idle animal beyond its leash walks back
 * to a spot beside that door; inside the leash the grazing drive takes over.
 *
 * Source basis: a house-attached animal keeps to its work house's door in the original; the
 * headquarters fallback and the ring of home spots are observed original behaviour. Determinism:
 * canonical member order, with disjoint per-door groups. No-ops in a mapless sim.
 */
export const livestockAssignmentSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  if (ctx.tick % LIVESTOCK_ASSIGN_PERIOD_TICKS !== 0) return;
  const terrain = ctx.terrain;
  // Grouped by the door each animal answers to, so the home spots around one door are handed out once.
  const byDoor = new Map<NodeId, Entity[]>();
  const strays: Entity[] = [];
  for (const e of world.canonicalQuery(Livestock, Owner, Settler, Position)) {
    // A cart's recruit is walking to its cart: herding resumes on release.
    if (world.has(e, DraughtAnimal)) continue;
    const held = world.tryGet(e, FarmAnimal);
    if (held !== undefined && !farmStands(world, ctx, held.farm)) {
      world.remove(e, FarmAnimal); // its farm is gone: back to the base yard
    } else if (held !== undefined) {
      if (held.summoner !== null) continue; // the slaughter summon owns its feet
      const door = interactionNodeId(world, ctx, terrain, held.farm);
      if (door !== null) push(byDoor, door, e);
      continue;
    }
    strays.push(e);
  }
  for (const e of strays) {
    const door = baseDoorOf(world, ctx, terrain, world.get(e, Owner).player);
    if (door !== null) push(byDoor, door, e);
  }
  if (byDoor.size === 0) return;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  for (const [door, herd] of byDoor) {
    herd.forEach((e, i) => {
      // A farm's animal is leashed to the door itself, the original's birth point; a stray keeps to the
      // home spot it was handed, the base yard being no territory of its own.
      const farmBound = world.has(e, FarmAnimal);
      const anchor = farmBound ? door : grazeAnchor(terrain, blocked, door, i);
      const stay = world.tryGet(e, StayPoint);
      if (stay === undefined) world.add(e, StayPoint, { cell: anchor });
      else if (stay.cell !== anchor) world.mut(e, StayPoint).cell = anchor;
      // Re-issued each period until it arrives, and never on top of a running atomic or in-flight walk.
      if (world.has(e, CurrentAtomic) || isTravelling(world, e)) return;
      if (manhattan(terrain, entityNode(world, terrain, e), anchor) <= livestockLeashOf(world, ctx, e)) {
        return;
      }
      world.add(e, MoveGoal, { cell: farmBound ? grazeAnchor(terrain, blocked, door, i) : anchor });
    });
  }
};

function push(byDoor: Map<NodeId, Entity[]>, door: NodeId, e: Entity): void {
  const herd = byDoor.get(door);
  if (herd === undefined) byDoor.set(door, [e]);
  else herd.push(e);
}

/** The `k`-th home spot around `door`: the first standable same-component ring offset from `k`, wrapping,
 *  and falling back to the door itself when nothing beside it is standable. Standable means walkable
 *  ground clear of the building footprints: the ring straddles the farm's own body, and a spot inside it
 *  fails every walk, leaving the animal wherever it stood. */
function grazeAnchor(terrain: TerrainGraph, blocked: BlockOverlay, door: NodeId, k: number): NodeId {
  const at = terrain.coordsOf(door);
  for (let i = 0; i < GRAZE_OFFSETS.length; i++) {
    const offset = GRAZE_OFFSETS[(k + i) % GRAZE_OFFSETS.length];
    if (offset === undefined) continue; // unreachable: the index is taken modulo the table length
    if (!terrain.inBounds(at.x + offset[0], at.y + offset[1])) continue;
    const node = terrain.nodeAt(at.x + offset[0], at.y + offset[1]);
    if (!terrain.isWalkable(node) || blocked.has(node)) continue;
    if (terrain.componentOf(node) !== terrain.componentOf(door)) continue;
    return node;
  }
  return door;
}

/** The door of `player`'s base, the yard a claimed animal no farm holds keeps to. */
function baseDoorOf(world: World, ctx: SystemContext, terrain: TerrainGraph, player: number): NodeId | null {
  const base = seatBaseOf(world, ctx, player);
  return base === null ? null : interactionNodeId(world, ctx, terrain, base);
}
