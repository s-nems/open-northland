import { type ContentSet, footprintCellDx, type WeaponType } from '@open-northland/data';
import { Age, Building, Health, isWildlife, Owner, Position, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, positionOfNode } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { shelterOccupancy, shelterStillHolds } from '../defence/index.js';
import { type HouseKey, houseFootprintOf } from '../footprint/geometry.js';
import { houseBow, isAreaWeapon, isFighterJob, shelterCapacityOf } from '../readviews/index.js';
import { type LooseShot, looseProjectile } from '../settlers/atomics/effects/combat/index.js';
import { hexNodeDistance, nearestHexCell } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import type { CombatIndex } from './combat-index.js';
import { EpochMarks } from './epoch-marks.js';
import { scatteredNode, shelterSpread } from './shot-aim.js';
import { buildingBodyNodes, combatTargetNode } from './target-node.js';
import { isValidTarget } from './targeting.js';

// Defence-mode fire. Original behavior: the building on alarm shoots the house bow itself, and the people
// sheltering inside only set its rate - they neither aim nor wear a bow.

/** Each occupant is worth one arrow per this many ticks: a building looses `floor(n / 24)` a tick, plus one
 *  more while `tick % 24 < n % 24`. Original behavior. */
export const SHELTER_SHOT_PERIOD_TICKS = 24;

/** The nearest enemies of one kind a shot picks among, taking only those within
 *  {@link TARGET_SPREAD_NODES} of the nearest. Original behavior. */
const TARGET_CANDIDATES = 5;
const TARGET_SPREAD_NODES = 10;

/** A person, not a beast or a building. */
const isPerson = (world: World, t: Entity): boolean => !world.has(t, Building) && !isWildlife(world, t);
const isFighter = (world: World, ctx: SystemContext, t: Entity): boolean =>
  isFighterJob(ctx.content, world.tryGet(t, Settler)?.jobType ?? null);

/** The kinds of enemy a building takes aim at, in the order it fills its shots: soldiers and heroes, wild
 *  animals, buildings, then everyone else. Original behavior. Disjoint, so each enemy is of one kind. */
const TARGET_KINDS: readonly ((world: World, ctx: SystemContext, t: Entity) => boolean)[] = [
  (world, ctx, t) => isPerson(world, t) && isFighter(world, ctx, t),
  (world, _ctx, t) => isWildlife(world, t),
  (world, _ctx, t) => world.has(t, Building),
  (world, ctx, t) => isPerson(world, t) && !isFighter(world, ctx, t),
];

/** The place of `t` in {@link TARGET_KINDS}, or -1 for none. */
function targetKindOf(world: World, ctx: SystemContext, t: Entity): number {
  for (let kind = 0; kind < TARGET_KINDS.length; kind++) {
    if (TARGET_KINDS[kind]?.(world, ctx, t) === true) return kind;
  }
  return -1;
}

/**
 * Loose this tick's shots from every defence-mode building that holds anyone. Reach is measured from the
 * building's nearest wall, the same face an attacker measures its own reach to, so a bow that outranges
 * nothing on the ground cannot stand off a large building either. The building fires at what is in reach
 * whether its owner sees it or not (original behavior). Reach and the nearest-first order count map points,
 * as the original's do. Scales with the sheltering claims and the shots due, not the map.
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

type FiringBow = WeaponType & { munitionType: NonNullable<WeaponType['munitionType']>; speed: number };

/** Whether a house bow can loose an arrow at all: a declared munition flying at a positive speed. */
function fires(bow: WeaponType | undefined): bow is FiringBow {
  return bow?.munitionType !== undefined && bow.speed !== undefined && bow.speed > 0;
}

/** Each content's defence radii by type, tribe, house record and anchor row parity, the only part of the
 *  anchor the reach depends on. */
const fireRadii = new WeakMap<ContentSet, Map<string, number | undefined>>();

/**
 * How far in map points from its anchor node (`hx`, `hy`) a `house` reaches all around in
 * defence mode: the widest ring every node of which stands within the house bow's reach of some wall cell,
 * the way the fire measures. A long building reaches further along its length. Undefined for a type with no
 * defence mode and when `tribe` fires no house bow. Working one out takes a few milliseconds for a large
 * building, and a held tower asks every frame, so each is remembered per content.
 */
export function shelterFireRadius(
  content: ContentSet,
  house: HouseKey,
  hx: number,
  hy: number,
): number | undefined {
  let radii = fireRadii.get(content);
  if (radii === undefined) {
    radii = new Map();
    fireRadii.set(content, radii);
  }
  const key = `${house.buildingType}:${house.tribe}:${house.record ?? ''}:${hy & 1}`;
  if (radii.has(key)) return radii.get(key);
  const radius = measuredFireRadius(content, house, hx, hy);
  radii.set(key, radius);
  return radius;
}

/** {@link shelterFireRadius} worked out: walks only the rings between the reach its nearest wall guarantees
 *  and the reach its farthest wall bounds, each a box scan of about the bow's reach squared. */
function measuredFireRadius(
  content: ContentSet,
  house: HouseKey,
  hx: number,
  hy: number,
): number | undefined {
  const bow = houseBow(content, house.tribe);
  if (shelterCapacityOf(content, house.buildingType) === 0 || !fires(bow)) return undefined;
  const cells = houseFootprintOf(content, house)?.blocked ?? [];
  const walls = cells.map((cell) => ({ x: hx + footprintCellDx(hy, cell), y: hy + cell.dy }));
  if (walls.length === 0) walls.push({ x: hx, y: hy });
  const fromAnchor = walls.map((w) => hexDistanceBetween(hx, hy, w.x, w.y));
  const inReach = (x: number, y: number): boolean =>
    walls.some((w) => hexDistanceBetween(w.x, w.y, x, y) <= bow.maxRange);
  // Every node within the reach less the nearest wall's distance is in reach through that wall; no node
  // past the reach plus the farthest wall's distance is.
  let radius = Math.max(0, bow.maxRange - Math.min(...fromAnchor));
  const ceiling = bow.maxRange + Math.max(...fromAnchor);
  while (radius < ceiling && hexRingInReach(hx, hy, radius + 1, inReach)) radius++;
  return radius;
}

/** Whether every node at map-point distance exactly `r` from (`hx`, `hy`) passes `inReach`. A hex ring spans
 *  `r` rows up and down and `r` nodes across. Unclipped by any map edge, so the answer is the same for every
 *  anchor on a row of the same parity. */
function hexRingInReach(
  hx: number,
  hy: number,
  r: number,
  inReach: (x: number, y: number) => boolean,
): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (hexDistanceBetween(hx, hy, hx + dx, hy + dy) === r && !inReach(hx + dx, hy + dy)) return false;
    }
  }
  return true;
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
  if (!fires(bow)) return;
  const flight = {
    munitionType: bow.munitionType,
    speed: bow.speed,
    hitSelf: bow.hitSelf,
    area: isAreaWeapon(bow),
    damage: bow.damage,
    hitSounds: bow.hitSounds,
    missSounds: bow.missSounds,
  };
  const walls = buildingBodyNodes(world, ctx, terrain, building);
  const centre = entityNode(world, terrain, building);
  const owner = world.get(building, Owner).player;
  const self = { tribe: b.tribe, jobType: null };
  const reaches = shotReachesOf(world);
  reaches.begin();
  const reach = (t: Entity): number => {
    if (reaches.holds(t)) return reaches.of(t);
    const mark = combatTargetNode(world, ctx, terrain, centre, t);
    return reaches.hold(t, hexNodeDistance(terrain, nearestHexCell(terrain, walls, mark) ?? centre, mark));
  };
  const accept = (t: Entity): boolean => {
    if (world.has(t, Age) || !isValidTarget(world, ctx, building, self, t)) return false;
    const d = reach(t);
    return d >= bow.minRange && d <= bow.maxRange;
  };
  // A wall stands up to `pad` nodes off the centre the index is searched from.
  let pad = 0;
  for (let i = 0; i < walls.length; i++)
    pad = Math.max(pad, hexNodeDistance(terrain, centre, walls[i] ?? centre));
  const candidates = index
    .nearestOfEachKind(
      terrain.xOf(centre),
      terrain.yOf(centre),
      0,
      bow.maxRange + pad,
      (t) => targetKindOf(world, ctx, t),
      TARGET_KINDS.length,
      accept,
      owner,
      // The index orders by distance to the centre, which sits up to `pad` off a mark's reach either way:
      // the tail bound keeps every candidate that can still be among the nearest by reach.
      TARGET_SPREAD_NODES + 2 * pad,
      'hex',
    )
    .map((band) => nearestByReach(band, reach));
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
      shoot(world, ctx, terrain, building, owner, flight, pick.entity);
      left--;
      fired = true;
    }
  }
}

/** The {@link TARGET_CANDIDATES} of `band` nearest by `reach`, then by id, in that order. */
function nearestByReach(
  band: readonly Entity[],
  reach: (t: Entity) => number,
): { entity: Entity; distance: number }[] {
  const nearest: { entity: Entity; distance: number }[] = [];
  for (const entity of band) {
    const distance = reach(entity);
    let at = nearest.length;
    while (at > 0) {
      const ahead = nearest[at - 1];
      if (
        ahead === undefined ||
        ahead.distance < distance ||
        (ahead.distance === distance && ahead.entity < entity)
      )
        break;
      at--;
    }
    if (at >= TARGET_CANDIDATES) continue;
    nearest.splice(at, 0, { entity, distance });
    if (nearest.length > TARGET_CANDIDATES) nearest.pop();
  }
  return nearest;
}

/** The reach (map points) of each entity from the walls of the building firing now, remembered for that
 *  building's turn alone, which {@link begin} starts. One buffer per world serves every turn. */
class ShotReaches {
  private readonly known = new EpochMarks();
  private reaches = new Int32Array(0);

  begin(): void {
    this.known.begin();
  }

  holds(e: Entity): boolean {
    return this.known.has(e);
  }

  of(e: Entity): number {
    return this.reaches[e] ?? 0;
  }

  /** Remember `reach` for `e` this turn, and return it. */
  hold(e: Entity, reach: number): number {
    if (e >= this.reaches.length) {
      const grown = new Int32Array(Math.max(e + 1, 2 * this.reaches.length));
      grown.set(this.reaches);
      this.reaches = grown;
    }
    this.reaches[e] = reach;
    this.known.mark(e);
    return reach;
  }
}

const shotReaches = new WeakMap<World, ShotReaches>();

function shotReachesOf(world: World): ShotReaches {
  let held = shotReaches.get(world);
  if (held === undefined) {
    held = new ShotReaches();
    shotReaches.set(world, held);
  }
  return held;
}

function shoot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
  owner: number,
  flight: LooseShot['weapon'],
  target: Entity,
): void {
  // Original behavior: the building aims where its mark stands now, with no lead on a walker, and scatters
  // by the range from its own position.
  const centre = entityNode(world, terrain, building);
  const mark = combatTargetNode(world, ctx, terrain, centre, target);
  const range = hexDistanceBetween(
    terrain.xOf(centre),
    terrain.yOf(centre),
    terrain.xOf(mark),
    terrain.yOf(mark),
  );
  const landing = scatteredNode(ctx, terrain, mark, shelterSpread(ctx, range));
  looseProjectile(world, ctx, {
    source: building,
    target,
    player: owner,
    weapon: flight,
    weaponMainType: null, // a building earns no fight experience
    cover: building,
    aim:
      landing === mark && !world.has(target, Building)
        ? world.get(target, Position)
        : positionOfNode(terrain.xOf(landing), terrain.yOf(landing)),
  });
}
