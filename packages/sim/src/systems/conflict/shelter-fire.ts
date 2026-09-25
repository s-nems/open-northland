import type { WeaponType } from '@open-northland/data';
import { Age, Building, Health, isWildlife, Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { shelterOccupancy, shelterStillHolds } from '../defence/index.js';
import { houseBow, weaponDamageVsMaterial } from '../readviews/index.js';
import { type LooseShot, looseProjectile } from '../settlers/atomics/effects/combat/index.js';
import { manhattan, nearestCell } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import type { CombatIndex } from './combat-index.js';
import { buildingBodyNodes, combatTargetNode } from './target-node.js';
import { isValidTarget } from './targeting.js';
import { hitSoundVsMaterial, targetMaterial } from './weapons.js';

// Defence-mode fire. Original behavior: the building on alarm shoots the house bow itself, and the people
// sheltering inside only set its rate - they neither aim nor wear a bow.

/** Each occupant is worth one arrow per this many ticks: a building looses `floor(n / 24)` a tick, plus one
 *  more while `tick % 24 < n % 24`. Original behavior. */
export const SHELTER_SHOT_PERIOD_TICKS = 24;

/** The nearest enemies of one kind a shot picks among, taking only those within
 *  {@link TARGET_SPREAD_NODES} of the nearest. Original behavior. */
const TARGET_CANDIDATES = 5;
const TARGET_SPREAD_NODES = 10;

/**
 * A shot's scatter: up to a quarter of its range, divided by a roll of 1..30, in each axis. Most shots land
 * true and a long one sometimes lands a few nodes off. Original behavior; a shot off its mark hits nothing
 * there, which is an approximation - the original lands it on whatever stands at the landing point.
 */
const SCATTER_RANGE_DIVISOR = 4;
const SCATTER_ROLL_SPAN = 30;

/** The kinds of enemy a building takes aim at, in the order it fills its shots: people, wild animals,
 *  buildings. Original behavior. */
const TARGET_KINDS: readonly ((world: World, t: Entity) => boolean)[] = [
  (world, t) => !world.has(t, Building) && !isWildlife(world, t),
  (world, t) => isWildlife(world, t),
  (world, t) => world.has(t, Building),
];

/**
 * Loose this tick's shots from every defence-mode building that holds anyone. Reach is measured from the
 * building's nearest wall, the same face an attacker measures its own reach to, so a bow that outranges
 * nothing on the ground cannot stand off a large building either. The building fires at what is in reach
 * whether its owner sees it or not (original behavior). Scales with the sheltering claims and the shots
 * due, not the map.
 */
export function fireFromShelters(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
): void {
  const occupancy = shelterOccupancy(world);
  if (occupancy.size === 0) return;
  // Ascending id, because every shot draws from the seeded stream.
  const buildings = [...occupancy.keys()].sort((a, b) => a - b);
  for (const building of buildings) {
    const shots = shotsDue(ctx.tick, occupancy.get(building) ?? 0);
    if (shots > 0) fireFrom(world, ctx, terrain, index, building, shots);
  }
}

/** The arrows `occupants` settlers are worth on `tick`. */
export function shotsDue(tick: number, occupants: number): number {
  const whole = Math.floor(occupants / SHELTER_SHOT_PERIOD_TICKS);
  return whole + (tick % SHELTER_SHOT_PERIOD_TICKS < occupants % SHELTER_SHOT_PERIOD_TICKS ? 1 : 0);
}

function fireFrom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  building: Entity,
  shots: number,
): void {
  if ((world.tryGet(building, Health)?.hitpoints ?? 0) <= 0) return;
  if (!shelterStillHolds(world, ctx, building)) return;
  const b = world.get(building, Building);
  const bow = houseBow(ctx.content, b.tribe);
  if (bow?.munitionType === undefined || bow.speed === undefined || bow.speed <= 0) return;
  const flight = { munitionType: bow.munitionType, speed: bow.speed, missSounds: bow.missSounds };
  const walls = buildingBodyNodes(world, ctx, terrain, building);
  const centre = entityNode(world, terrain, building);
  const owner = world.get(building, Owner).player;
  const self = { tribe: b.tribe, jobType: null };
  const reach = (t: Entity): number => {
    const mark = combatTargetNode(world, ctx, terrain, centre, t);
    return manhattan(terrain, nearestCell(terrain, walls, mark) ?? centre, mark);
  };
  const accept = (t: Entity): boolean => {
    if (world.has(t, Age) || !isValidTarget(world, ctx, building, self, t)) return false;
    const d = reach(t);
    return d >= bow.minRange && d <= bow.maxRange;
  };
  // A wall stands up to `pad` nodes off the centre the index is searched from.
  let pad = 0;
  for (const wall of walls) pad = Math.max(pad, manhattan(terrain, centre, wall));
  const { x, y } = terrain.coordsOf(centre);
  const candidates = TARGET_KINDS.map((kind) =>
    index
      .nearestFew(
        x,
        y,
        0,
        bow.maxRange + pad,
        (t) => kind(world, t) && accept(t),
        // Uncounted, because the index orders by distance to the centre: the tail bound keeps every
        // candidate that can still be among the nearest by reach.
        Number.POSITIVE_INFINITY,
        owner,
        TARGET_SPREAD_NODES + pad,
      )
      .map(({ entity }) => ({ entity, distance: reach(entity) }))
      .sort((p, q) => p.distance - q.distance || p.entity - q.entity)
      .slice(0, TARGET_CANDIDATES),
  );
  let left = shots;
  let fired = true;
  while (left > 0 && fired) {
    fired = false;
    for (const band of candidates) {
      if (left === 0) break;
      const nearest = band[0];
      if (nearest === undefined) continue;
      const pool = band.filter((c) => c.distance <= nearest.distance + TARGET_SPREAD_NODES);
      const pick = pool[ctx.rng.int(pool.length)] ?? nearest;
      shoot(world, ctx, terrain, building, bow, flight, pick.entity, pick.distance);
      left--;
      fired = true;
    }
  }
}

function shoot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
  bow: WeaponType,
  flight: LooseShot['projectile'],
  target: Entity,
  distance: number,
): void {
  const material = targetMaterial(world, ctx, target);
  const mark = combatTargetNode(world, ctx, terrain, entityNode(world, terrain, building), target);
  const landing = scatteredLanding(ctx, terrain, mark, distance);
  looseProjectile(world, ctx, {
    source: building,
    target,
    damage: weaponDamageVsMaterial(bow, material),
    weaponMainType: null, // a building earns no fight experience
    hitSoundType: hitSoundVsMaterial(bow, material) ?? null,
    projectile: flight,
    cover: building,
    missAt: landsOn(world, ctx, terrain, target, landing)
      ? null
      : positionOfNode(terrain.xOf(landing), terrain.yOf(landing)),
  });
}

/** Where a shot aimed at `mark` from `distance` nodes away comes down. */
function scatteredLanding(ctx: SystemContext, terrain: TerrainGraph, mark: NodeId, distance: number): NodeId {
  const spread = Math.floor(
    Math.floor(distance / SCATTER_RANGE_DIVISOR) / (ctx.rng.int(SCATTER_ROLL_SPAN) + 1),
  );
  const half = Math.floor(spread / 2);
  const dx = ctx.rng.int(spread + 1) - half;
  const dy = ctx.rng.int(spread + 1) - half;
  return terrain.nodeAtClamped(terrain.xOf(mark) + dx, terrain.yOf(mark) + dy);
}

/** Whether a shot coming down on `landing` strikes `target`: its own node, or any wall of a building. */
function landsOn(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  target: Entity,
  landing: NodeId,
): boolean {
  if (world.has(target, Building)) return buildingBodyNodes(world, ctx, terrain, target).includes(landing);
  return entityNode(world, terrain, target) === landing;
}
