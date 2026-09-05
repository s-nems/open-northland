import type { ContentSet } from '@open-northland/data';
import { Building, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import { interactionNode } from '../footprint/index.js';
import { manhattan, nearestCell, ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import type { WeaponBand } from './melee-slots.js';

// The nodes combat measures a target's distance to, and paths a chaser toward, so the ring-search index, the
// chase drive and the mid-swing whiff check all resolve a building target's approach the same way.

/** Shared and frozen so a body-less lookup allocates nothing. */
const NO_BODY: readonly NodeId[] = Object.freeze([]);

interface BuildingBodyCache {
  /** Building MEMBERSHIP generation - a placement or destruction. */
  readonly membershipGeneration: number;
  /** Building VALUE generation - a home tier upgrade swaps `buildingType` in place through
   *  {@link World.write}, moving the footprint with no membership change. */
  readonly valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly bodies: Map<Entity, readonly NodeId[]>;
}

const bodyCache = new WeakMap<World, BuildingBodyCache>();

/**
 * The half-cell wall nodes a building presents to attackers - its footprint `blocked` cells translated to the
 * placed anchor. A warrior measures reach to, and swings at, the nearest of these, so a building is besieged
 * from every face rather than only its door. Falls back to the door node, then the anchor, for a
 * footprint-less building.
 *
 * Derived per world and held across ticks, keyed on the two Building store generations: a building never
 * moves, so nothing else the derivation reads can change under a live key. Never hashed; the registered
 * verifier re-derives every held body, so a change that reaches neither generation surfaces at the tick it
 * happens.
 */
export function buildingBodyNodes(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  building: Entity,
): readonly NodeId[] {
  const bodies = liveBodies(world, ctx, terrain);
  const held = bodies.get(building);
  if (held !== undefined) return held;
  const nodes = computeBuildingBodyNodes(world, ctx, terrain, building);
  // A Building whose Position is not yet added resolves to no body and bumps no generation on the later
  // add, so holding its empty result would pin it for the rest of the generation window.
  if (nodes.length === 0) return NO_BODY;
  bodies.set(building, nodes);
  return nodes;
}

/** The world's body map at the current Building generations, minting a fresh empty one when either moved. */
function liveBodies(world: World, ctx: MapContext, terrain: TerrainGraph): Map<Entity, readonly NodeId[]> {
  const membershipGeneration = world.componentGeneration(Building);
  const valueGeneration = world.componentValueGeneration(Building);
  const cached = bodyCache.get(world);
  if (
    cached !== undefined &&
    cached.terrain === terrain &&
    cached.content === ctx.content &&
    cached.membershipGeneration === membershipGeneration &&
    cached.valueGeneration === valueGeneration
  ) {
    return cached.bodies;
  }
  const bodies = new Map<Entity, readonly NodeId[]>();
  const content = ctx.content;
  bodyCache.set(world, { membershipGeneration, valueGeneration, content, terrain, bodies });
  world.registerCacheVerifier('combatBuildingBodies', () => verifyBodyCache(world, content, terrain));
  return bodies;
}

function verifyBodyCache(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const cached = bodyCache.get(world);
  if (cached === undefined || cached.terrain !== terrain || cached.content !== content) return [];
  if (
    cached.membershipGeneration !== world.componentGeneration(Building) ||
    cached.valueGeneration !== world.componentValueGeneration(Building)
  ) {
    return []; // stale key - the next read mints a fresh map, nothing can consume the held bodies
  }
  const ctx: MapContext = { content, terrain };
  for (const [e, held] of cached.bodies) {
    const fresh = computeBuildingBodyNodes(world, ctx, terrain, e);
    if (held.length !== fresh.length || fresh.some((n, i) => held[i] !== n)) {
      return [
        `combatBuildingBodies holds a stale body for building ${e} - a footprint changed without a Building store generation bump`,
      ];
    }
  }
  return [];
}

function computeBuildingBodyNodes(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  building: Entity,
): readonly NodeId[] {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return NO_BODY;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const body = translatedCells(
    terrain,
    buildingFootprintOf(ctx.content, b.buildingType)?.blocked ?? [],
    hx,
    hy,
  );
  if (body.length > 0) return body;
  // `terrain`, not `ctx.terrain`: the door's in-bounds fallback must read the same graph the cache is
  // keyed on and the cells above are translated against.
  const door = interactionNode(world, { content: ctx.content, terrain }, building);
  return door === null ? [entityNode(world, terrain, building)] : [terrain.nodeAtClamped(door.x, door.y)];
}

/**
 * The half-cell node a warrior at `from` fights `target` from - its own node for a settler or animal, the
 * nearest wall cell for a building. Attacker-aware, so a besieging warrior closes on the face nearest it. The
 * combat index buckets a building at every wall cell, so `index.nearest` returns the same node this resolves
 * for a given attacker and the reach distance agrees with the chase goal.
 */
export function combatTargetNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  target: Entity,
): NodeId {
  if (world.has(target, Building)) {
    const nearest = nearestCell(terrain, buildingBodyNodes(world, ctx, terrain, target), from);
    if (nearest !== null) return nearest;
  }
  return entityNode(world, terrain, target);
}

/**
 * The acquisition gate for a candidate the chase would refuse: it is admitted while the seeker's own static
 * walk component holds a cell inside `weapon`'s band of it - the firing position the chase walks to. A
 * candidate whose whole band lies across a terrain seam can never be closed on, and an ungated nearest-first
 * search re-picks it every tick instead of reaching a candidate farther out. A besieger encircles, so any one
 * wall answers for a building's whole body. Static terrain only, a superset of what the chase accepts: a band
 * cell the block overlay covers still admits here, and a candidate the overlay seals off is given up by the
 * chase.
 *
 * A seeker on an unlabelled node (unwalkable, truncated onto it mid-stride) admits everything, as the chase
 * does. The ring walk is the melee case alone - a candidate inside the seeker's own band answers in O(1), so
 * a garrison, a shelter and every bow seeker skip it.
 *
 * Nothing readable records how the original filtered candidates, so refusing one here is an approximation
 * (source basis "Combat chase"), held to the chase's own release rule so the two cannot disagree.
 */
export function reachableTargetGate(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  weapon: WeaponBand,
): (t: Entity) => boolean {
  const bank = terrain.componentOf(here);
  if (bank < 0) return () => true;
  return (t) => {
    if (!world.has(t, Building)) {
      return firingCellIn(terrain, bank, here, entityNode(world, terrain, t), weapon);
    }
    return buildingBodyNodes(world, ctx, terrain, t).some((wall) =>
      firingCellIn(terrain, bank, here, wall, weapon),
    );
  };
}

/** Whether walk component `component` holds a cell in `weapon`'s band around `target`. */
function firingCellIn(
  terrain: TerrainGraph,
  component: number,
  here: NodeId,
  target: NodeId,
  weapon: WeaponBand,
): boolean {
  if (terrain.componentOf(target) === component) return true;
  const dist = manhattan(terrain, here, target);
  if (dist >= weapon.minRange && dist <= weapon.maxRange) return true; // the seeker stands on one already
  const t = terrain.coordsOf(target);
  for (let d = weapon.minRange; d <= weapon.maxRange; d++) {
    const offsets = ringOffsetCount(d);
    for (let i = 0; i < offsets; i++) {
      const x = t.x + ringOffsetDx(d, i);
      const y = t.y + ringOffsetDy(d, i);
      if (terrain.inBounds(x, y) && terrain.componentOf(terrain.nodeAt(x, y)) === component) return true;
    }
  }
  return false;
}
