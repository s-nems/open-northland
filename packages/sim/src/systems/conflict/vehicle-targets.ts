import {
  Building,
  Owner,
  Settler,
  type SettlerIdentity,
  Vehicle,
  type VehicleAttackTarget,
  type VehicleStance,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingCombatClass, isRangedWeapon, ranksWithTowers } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { playerSeesEntity } from '../vision/index.js';
import type { CombatPass } from './pass.js';
import { combatTargetNode } from './target-node.js';
import { isFighterTarget, isStructureTarget, isValidTarget } from './targeting.js';
import { givenUpTargetVeto } from './unreachable-targets.js';
import { attackerWeapon, vehicleWeapon } from './weapons.js';

/** How far, in map points, an attacking or defending siege vehicle looks for an enemy (original
 *  behavior). */
export const VEHICLE_SCAN_RADIUS_POINTS = 40;

/** How a siege vehicle ranks the enemies its band reaches, first rank first (owner rule, where the original
 *  prefers enemies indoors, then houses): the military houses, a house shooting from inside and armed
 *  vehicles, then fighters that shoot, the other fighters, the other houses, and everyone else. */
const VEHICLE_TARGET_RANK = { MILITARY: 0, SHOOTER: 1, FIGHTER: 2, HOUSE: 3, OTHER: 4 } as const;
type VehicleTargetRank = (typeof VEHICLE_TARGET_RANK)[keyof typeof VEHICLE_TARGET_RANK];
const VEHICLE_TARGET_RANKS = Object.keys(VEHICLE_TARGET_RANK).length;

/** The ranks a vehicle drives up to: an enemy of one of them past its far reach is worth leaving a lesser
 *  one inside the band for (owner rule). */
const VEHICLE_PRIORITY_RANKS = VEHICLE_TARGET_RANK.SHOOTER + 1;

/** How far past its far reach, in map points, a vehicle outside `hold` takes up a priority target to
 *  drive into range of it, ahead of a lesser one inside its band (owner rule, about half a catapult's
 *  reach): pressing on an enemy line, it rolls up to the tower or the archers behind the men it could
 *  shoot. */
export const VEHICLE_PRIORITY_REACH_POINTS = 13;

/** How many enemies inside the near reach keep a vehicle with nothing in its band where it stands (owner
 *  rule): it drives away from a lone one to bring it into the band, but a crowd would only follow it. */
const PRESSING_ENEMIES = 2;

/** A scan's outcome: a target, nothing, or `pressed` - enemies too close to shoot, which the vehicle
 *  neither backs off from nor leaves to chase another. */
export type VehicleScanResult = VehicleAttackTarget | null | 'pressed';

/**
 * The stance's scan. The band comes first: the best-ranked valid, seen enemy the weapon reaches from where
 * the vehicle stands (`hold`: from its guard position), the nearest within its rank. `hold` looks no
 * further. Outside it, a military target or a shooter up to {@link VEHICLE_PRIORITY_REACH_POINTS} past the
 * band wins over a lesser-ranked one inside it and over a crowd at its side, `defence` taking one only
 * within the scan radius of its guard position, so a run of such pulls never walks it off its leash. With
 * nothing in the band the vehicle stands `pressed` among {@link PRESSING_ENEMIES} enemies inside the near
 * reach, else takes the nearest enemy out to the scan radius, `attack` around itself and `defence` around
 * its guard position (original behavior). Each find gives way to a held target no farther, of its rank
 * or better. An enemy a chase could not reach is skipped for a while.
 */
export function scanForTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  e: Entity,
  stance: VehicleStance,
  guard: HalfCellNode | null,
  identity: SettlerIdentity,
  weapon: { minRange: number; maxRange: number },
  here: NodeId,
  held: VehicleAttackTarget | null,
): VehicleScanResult {
  const centre = stance === 'attack' || guard === null ? here : terrain.nodeAtClamped(guard.hx, guard.hy);
  pass.vehicleScan ??= new VehicleScan(world, ctx, terrain, pass.index.firingNow);
  const scan = pass.vehicleScan.aim(
    e,
    identity,
    world.tryGet(e, Owner)?.player,
    givenUpTargetVeto(world, ctx, e),
  );
  // Outside `hold` the band is around `here`, so nobody within its reach means nobody pressing either.
  const from = stance === 'hold' ? centre : here;
  const reach = stance === 'hold' ? weapon.maxRange : weapon.maxRange + VEHICLE_PRIORITY_REACH_POINTS;
  const { seeker } = scan;
  const near =
    seeker === null || pass.index.othersWithin(seeker, terrain.xOf(from), terrain.yOf(from), reach);
  const inBand = near ? bestInBand(world, ctx, terrain, pass, scan, from, weapon, held) : null;
  if (stance === 'hold') return inBand ?? held;
  // Only a rank better than the band's best is worth the drive.
  const below =
    inBand?.kind === 'entity'
      ? Math.min(scan.rank(inBand.entity), VEHICLE_PRIORITY_RANKS)
      : VEHICLE_PRIORITY_RANKS;
  if (near && below > 0) {
    const leash = stance === 'defence' ? centre : null;
    const past = priorityPastBand(world, ctx, terrain, pass, scan, here, weapon, reach, leash, below, held);
    if (past !== null) return past;
  }
  if (inBand !== null) return inBand;
  if (near && pressed(terrain, pass, scan, here, weapon.minRange)) return 'pressed';
  return nearestInReach(world, ctx, terrain, pass, scan, centre, held);
}

/** The nearest target of the best rank under `below` past the far reach of `here` but within `reach` map
 *  points, and within the scan radius of `guard` when one is given, or a held target of that rank or
 *  better no farther. */
function priorityPastBand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  scan: VehicleScan,
  here: NodeId,
  { minRange, maxRange }: { minRange: number; maxRange: number },
  reach: number,
  guard: NodeId | null,
  below: number,
  held: VehicleAttackTarget | null,
): VehicleAttackTarget | null {
  const accept = scan.leashedInBandFrom(here, minRange, guard);
  const [found] = pass.index.nearestFewOfBestRank(
    terrain.xOf(here),
    terrain.yOf(here),
    maxRange + 1,
    reach,
    scan.rankUnder,
    below,
    accept,
    1,
    scan.seeker,
    0,
    'hex',
  );
  if (found === undefined) return null;
  const kept = held?.kind === 'entity' ? held.entity : null;
  if (kept === found.entity) return held;
  if (kept !== null && scan.rank(kept) <= scan.rank(found.entity) && accept(kept)) {
    const dist = targetDistance(world, ctx, terrain, here, kept);
    if (dist >= minRange && dist <= found.distance) return held;
  }
  return { kind: 'entity', entity: found.entity };
}

/** The nearest enemy of the best {@link VEHICLE_TARGET_RANK} inside the band around `from`, or a held
 *  target in the band no farther and of that rank or better. */
function bestInBand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  scan: VehicleScan,
  from: NodeId,
  { minRange, maxRange }: { minRange: number; maxRange: number },
  held: VehicleAttackTarget | null,
): VehicleAttackTarget | null {
  const [found] = pass.index.nearestFewOfBestRank(
    terrain.xOf(from),
    terrain.yOf(from),
    minRange,
    maxRange,
    scan.rank,
    VEHICLE_TARGET_RANKS,
    scan.inBandFrom(from, minRange),
    1,
    scan.seeker,
    0,
    'hex',
  );
  if (found === undefined) return null;
  const kept = held?.kind === 'entity' ? held.entity : null;
  if (kept === found.entity) return held;
  if (kept !== null && scan.rank(kept) <= scan.rank(found.entity)) {
    const dist = targetDistance(world, ctx, terrain, from, kept);
    if (dist >= minRange && dist <= found.distance) return held;
  }
  return { kind: 'entity', entity: found.entity };
}

/** The nearest enemy within the scan radius of `centre`, or the held target when no farther or nothing
 *  is found. */
function nearestInReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  pass: CombatPass,
  scan: VehicleScan,
  centre: NodeId,
  held: VehicleAttackTarget | null,
): VehicleAttackTarget | null {
  const x = terrain.xOf(centre);
  const y = terrain.yOf(centre);
  const { seeker } = scan;
  if (seeker !== null && !pass.index.othersWithin(seeker, x, y, VEHICLE_SCAN_RADIUS_POINTS)) return held;
  const found = pass.index.nearest(x, y, 1, VEHICLE_SCAN_RADIUS_POINTS, scan.accept, seeker, 'hex');
  if (found === null) return held;
  const kept = held?.kind === 'entity' ? held.entity : null;
  if (kept === found.entity) return held;
  if (kept !== null && targetDistance(world, ctx, terrain, centre, kept) <= found.distance) return held;
  return { kind: 'entity', entity: found.entity };
}

/** How far `t` stands from `from`, in the map points a find carries. */
function targetDistance(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  t: Entity,
): number {
  return hexNodeDistance(terrain, from, combatTargetNode(world, ctx, terrain, from, t));
}

/** Whether {@link PRESSING_ENEMIES} enemy units `scan` admits stand under `minRange` map points of `here`. */
function pressed(
  terrain: TerrainGraph,
  pass: CombatPass,
  scan: VehicleScan,
  here: NodeId,
  minRange: number,
): boolean {
  const nearReach = minRange - 1;
  const close = pass.index.nearestFew(
    terrain.xOf(here),
    terrain.yOf(here),
    0,
    nearReach,
    scan.accept,
    PRESSING_ENEMIES,
    scan.seeker,
    nearReach,
    'hex',
    true,
  );
  return close.length >= PRESSING_ENEMIES;
}

/** One pass's vehicle scan filter and rank, re-aimed per vehicle so a scan allocates no closure: the
 *  valid, seen targets the vehicle has not given up on. */
export class VehicleScan {
  private e = 0 as Entity;
  private identity: SettlerIdentity = { tribe: 0, jobType: null };
  private player: number | undefined;
  private givenUp: ((t: Entity) => boolean) | undefined;
  private bandFrom = 0 as NodeId;
  private bandMin = 0;
  private leash: NodeId | null = null;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    private readonly firing: () => ReadonlySet<Entity>,
  ) {}

  /** The player the aimed vehicle searches for, null for an ownerless one. */
  get seeker(): number | null {
    return this.player ?? null;
  }

  readonly accept = (t: Entity): boolean =>
    this.givenUp?.(t) !== true &&
    isValidTarget(this.world, this.ctx, this.e, this.identity, t) &&
    (this.player === undefined || playerSeesEntity(this.world, this.ctx.fog, this.player, t));

  /** {@link accept} for a band scan, which offers a house or vehicle at each node of its body: one whose
   *  nearest face lies inside the near reach is not in the band, as the shot measures to that face. */
  private readonly acceptInBand = (t: Entity): boolean =>
    this.accept(t) &&
    (!isStructureTarget(this.world, t) ||
      targetDistance(this.world, this.ctx, this.terrain, this.bandFrom, t) >= this.bandMin);

  private readonly leashedInBand = (t: Entity): boolean =>
    this.acceptInBand(t) &&
    (this.leash === null ||
      targetDistance(this.world, this.ctx, this.terrain, this.leash, t) <= VEHICLE_SCAN_RADIUS_POINTS);

  readonly rank = (t: Entity): VehicleTargetRank => vehicleTargetRank(this.world, this.ctx, t, this.firing);

  /** {@link rank} for a search over the ranks under `bound`, which it names for every other one. */
  readonly rankUnder = (t: Entity, bound: number): number => Math.min(this.rank(t), bound);

  /** {@link acceptInBand} for a band of `minRange` map points and more around `from`. */
  inBandFrom(from: NodeId, minRange: number): (t: Entity) => boolean {
    this.bandFrom = from;
    this.bandMin = minRange;
    return this.acceptInBand;
  }

  /** {@link inBandFrom} within the scan radius of `guard` when one is given. */
  leashedInBandFrom(from: NodeId, minRange: number, guard: NodeId | null): (t: Entity) => boolean {
    this.inBandFrom(from, minRange);
    this.leash = guard;
    return this.leashedInBand;
  }

  aim(
    e: Entity,
    identity: SettlerIdentity,
    player: number | undefined,
    givenUp: ((t: Entity) => boolean) | undefined,
  ): this {
    this.e = e;
    this.identity = identity;
    this.player = player;
    this.givenUp = givenUp;
    return this;
  }
}

function vehicleTargetRank(
  world: World,
  ctx: SystemContext,
  t: Entity,
  firing: () => ReadonlySet<Entity>,
): VehicleTargetRank {
  const building = world.tryGet(t, Building);
  if (building !== undefined) {
    const type = building.buildingType;
    const military = ranksWithTowers(ctx, type) || buildingCombatClass(ctx, type) === 'hq' || firing().has(t);
    return military ? VEHICLE_TARGET_RANK.MILITARY : VEHICLE_TARGET_RANK.HOUSE;
  }
  const vehicle = world.tryGet(t, Vehicle);
  if (vehicle !== undefined) {
    return vehicleWeapon(ctx, vehicle) === null ? VEHICLE_TARGET_RANK.OTHER : VEHICLE_TARGET_RANK.MILITARY;
  }
  if (!isFighterTarget(world, ctx, t)) return VEHICLE_TARGET_RANK.OTHER;
  return shootsAtRange(world, ctx, t) ? VEHICLE_TARGET_RANK.SHOOTER : VEHICLE_TARGET_RANK.FIGHTER;
}

/** Whether settler `t` fights with a weapon that looses a munition. */
function shootsAtRange(world: World, ctx: SystemContext, t: Entity): boolean {
  const settler = world.get(t, Settler);
  const worn = world.tryGet(t, Weapon)?.weaponTypeId;
  const armed = attackerWeapon(ctx, settler.tribe, settler.jobType, worn, settler.humanForm);
  return armed !== null && isRangedWeapon(armed.weapon);
}
