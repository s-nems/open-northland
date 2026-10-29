import {
  Armor,
  Building,
  DefenceMode,
  fightsPlayer,
  Health,
  MAX_PLAYERS,
  Owner,
  Person,
  Position,
  type SeatOffender,
  Settler,
  Vehicle,
} from '../../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { combatGridOf, playerBit } from '../../../conflict/combat-grid.js';
import { towerPostFor } from '../../../conflict/tower-post.js';
import type { SystemContext } from '../../../context.js';
import { isAdultSettler } from '../../../family/eligibility.js';
import { ownedFightersOf } from '../../../movement/collision/owned-fighters.js';
import { isAnimalTribe, isFighterJob, isScoutJob, shelterCapacityOf } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { assignedWorkers } from '../../../stores/assigned-workers.js';
import { playerSeesNode } from '../../../vision/gates.js';
import type { FogState } from '../../../vision/state.js';
import { isBuilt } from '../../seat-roster.js';
import { fighterWeaponClass } from '../census.js';
import { garrisonSlots } from './posts.js';
import {
  insideBox,
  type Raider,
  raidersNearAny,
  type SettlementBox,
  settlementBox,
  sightOf,
  THREAT_STAND_DOWN_MARGIN_NODES,
  watchBandOf,
} from './threat.js';

// A computer seat weighing the enemies inside its settlement against what it can answer them with. The
// weights are the original's per-unit danger values; the zones are an approximation of its per-position
// ring sums: one zone per building an enemy stands inside the watch band of.

/** Danger of an enemy civilian. Original behavior. */
export const CIVILIAN_DANGER = 1;
/** Danger of an enemy soldier or hero, and what each piece of his gear adds. Original behavior. */
export const SOLDIER_DANGER = 10;
export const ARMOUR_DANGER = 10;
export const WEAPON_DANGER = 10;
/** Danger of an enemy vehicle, and of one a commander drives. Original behavior. */
export const VEHICLE_DANGER = 10;
export const COMMANDED_VEHICLE_DANGER = 50;

/** What a manned tower and a standing shelter inside a zone add to its defence: the original's danger
 *  values for a tower and a house, read here as the protection they give. Approximation. */
export const TOWER_DEFENCE = 40;
export const SHELTER_DEFENCE = 5;

/** How many times its plain danger an enemy civilian who struck or robbed the seat weighs; a soldier or
 *  vehicle already weighs his own. Approximation: an offending civilian then weighs a soldier. */
export const OFFENDER_DANGER_MULTIPLIER = 10;

/** The zone danger from which the seat answers. Original behavior for its defend task. */
export const DEFEND_DANGER_THRESHOLD = 6;
/** What the original rounds the danger by before dividing it into soldiers wanted. */
const SOLDIERS_WANTED_ROUNDING = 5;

/** How many times its defence a zone's armed danger must pass to count as desperate: forces roughly a
 *  match for the seat's leave its civilians at work. Approximation. */
export const DESPERATE_DANGER_RATIO = 2;

/** One enemy unit inside the settlement, where he stands and what he weighs. */
export interface Intruder {
  readonly entity: Entity;
  readonly x: number;
  readonly y: number;
  readonly component: number;
  readonly danger: number;
  /** He struck or robbed the seat lately. */
  readonly offender: boolean;
  /** An enemy scout, who can drive off the seat's livestock at any moment. */
  readonly scout: boolean;
  /** No civilian: a fighter, whom the raid path answers, or a vehicle. The offender ladder and the
   *  offender weight are for civilians alone. */
  readonly armed: boolean;
}

/** One threatened building of the seat with the enemies inside its band and what stands against them. */
export interface ZoneThreat {
  readonly anchor: Entity;
  readonly x: number;
  readonly y: number;
  /** How far from the anchor (map points) a defender sent into the zone chases: its band and margin. */
  readonly radius: number;
  readonly intruders: readonly Intruder[];
  readonly danger: number;
  /** The share of {@link danger} its armed intruders pose: soldiers, heroes and vehicles. */
  readonly armedDanger: number;
  readonly defence: number;
  /** No standing shelter lies inside the zone, or one of them is already in defence mode: its people
   *  have had their chance to take cover before any is armed. */
  readonly sheltersRung: boolean;
}

/** The seat's threatened zones, ascending anchor id. */
export interface SeatThreat {
  readonly zones: readonly ZoneThreat[];
}

export const NO_THREAT: SeatThreat = { zones: [] };

/** The plain danger `e` poses, before any offender weight: 0 for an animal, a building or a corpse. */
export function unitDanger(world: World, ctx: SystemContext, e: Entity): number {
  if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return 0;
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle !== undefined) {
    const commander = vehicle.passengers[vehicle.passengers.length - 1];
    return commander === null || commander === undefined ? VEHICLE_DANGER : COMMANDED_VEHICLE_DANGER;
  }
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || isAnimalTribe(ctx.content, settler.tribe)) return 0;
  if (!isFighterJob(ctx.content, settler.jobType)) return CIVILIAN_DANGER;
  // Approximation: the original adds a further WEAPON_DANGER for one weapon kind this content carries none of.
  return (
    SOLDIER_DANGER +
    (world.has(e, Armor) ? ARMOUR_DANGER : 0) +
    (fighterWeaponClass(world, ctx, e) !== null ? WEAPON_DANGER : 0)
  );
}

/**
 * What the seat's fighters add to every zone's defence: each the danger he would pose himself, by the
 * weights its enemies are weighed by. Every live fighter of the seat counts, whether idle, already in the
 * fight or still waiting for a weapon, but the men away (`away`: marching off or on a map-AI task) and those holding a tower post,
 * whose tower counts for them where it stands.
 */
function fighterDefence(world: World, ctx: SystemContext, player: number, away: ReadonlySet<Entity>): number {
  let defence = 0;
  for (const e of ownedFightersOf(world, ctx.content, player)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null || away.has(e)) continue;
    if (towerPostFor(world, ctx, e, jobType) !== null) continue;
    defence += unitDanger(world, ctx, e);
  }
  return defence;
}

/**
 * Weigh the enemies inside `player`'s settlement: its loose enemy fighters near any building (`raiders`),
 * the enemy civilians walking in it and the offenders it remembers, each counted once, an offending
 * civilian {@link OFFENDER_DANGER_MULTIPLIER} times over. A zone's defence is the seat's fighters at home
 * ({@link fighterDefence}; `away` are those marching off), wherever they stand, and the manned towers and
 * standing shelters inside its band.
 *
 * Costs the raiders near the settlement, the enemy people inside its box (read off the combat grid's unit
 * layer) and the remembered offenders, times the seat's buildings and people only when someone is near.
 */
export function assessSeatThreat(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  raiders: readonly Raider[],
  offenders: readonly DeepReadonly<SeatOffender>[],
  away: ReadonlySet<Entity>,
): SeatThreat {
  const intruders = intrudersOf(world, ctx, terrain, player, owned, raiders, offenders);
  if (intruders.length === 0) return NO_THREAT;
  const zones: ZoneThreat[] = [];
  let soldiers: number | null = null;
  for (const anchor of owned) {
    const at = terrain.coordsOf(entityNode(world, terrain, anchor));
    const band = watchBandOf(world, ctx, anchor);
    const inside = intruders.filter((i) => hexDistanceBetween(i.x, i.y, at.x, at.y) <= band);
    if (inside.length === 0) continue;
    let danger = 0;
    let armedDanger = 0;
    for (const i of inside) {
      danger += i.danger;
      if (i.armed) armedDanger += i.danger;
    }
    soldiers ??= fighterDefence(world, ctx, player, away);
    const works = fortificationOf(world, ctx, terrain, owned, at.x, at.y, band);
    zones.push({
      anchor,
      x: at.x,
      y: at.y,
      radius: band + THREAT_STAND_DOWN_MARGIN_NODES,
      intruders: inside,
      danger,
      armedDanger,
      defence: soldiers + works.defence,
      sheltersRung: works.sheltersRung,
    });
  }
  return { zones };
}

/** The enemy units inside the box round the seat's buildings, ascending id. A seat whose computer
 *  controller runs counts only those it sees now ({@link sightOf}); its raiders arrive gated already. */
function intrudersOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  raiders: readonly Raider[],
  offenders: readonly DeepReadonly<SeatOffender>[],
): Intruder[] {
  const box = settlementBox(world, ctx, terrain, owned);
  if (box === null) return [];
  const sight = sightOf(world, ctx, player);
  const remembered = new Set<Entity>();
  for (const o of offenders) remembered.add(o.entity);
  const intruders: Intruder[] = [];
  const listed = new Set<Entity>();
  for (const r of raidersNearAny(world, ctx, terrain, owned, raiders)) {
    listed.add(r.entity);
    intruders.push(intruderOf(world, ctx, r.entity, r.x, r.y, r.component, remembered.has(r.entity), true));
  }
  let enemies = 0;
  for (let side = 0; side < MAX_PLAYERS; side++) {
    if (side !== player && fightsPlayer(world, side, player)) enemies |= playerBit(side);
  }
  for (const e of combatGridOf(world, ctx, terrain).ownedUnitsInBox(world, ctx.tick, enemies, box)) {
    if (!world.has(e, Person) || !isCivilian(world, ctx, e) || !isAdultSettler(world, e)) continue;
    const at = boxedNode(world, terrain, box, e);
    if (at === null || !seen(sight, player, at) || unitDanger(world, ctx, e) === 0) continue;
    listed.add(e);
    intruders.push(intruderOf(world, ctx, e, at.x, at.y, at.component, remembered.has(e), false));
  }
  for (const o of offenders) {
    const e = o.entity;
    if (listed.has(e)) continue;
    const side = world.tryGet(e, Owner)?.player;
    if (side === undefined || !fightsPlayer(world, side, player)) continue;
    const at = boxedNode(world, terrain, box, e);
    if (at === null || !seen(sight, player, at)) continue;
    const civilian = isCivilian(world, ctx, e);
    intruders.push(intruderOf(world, ctx, e, at.x, at.y, at.component, true, !civilian));
  }
  return intruders.sort((a, b) => a.entity - b.entity);
}

/** Whether `player` sees the node `at`, always when no `sight` gates it. */
function seen(sight: FogState | null, player: number, at: { x: number; y: number }): boolean {
  return sight === null || playerSeesNode(sight, player, at.x, at.y);
}

/** The node `e` stands on with its walkable component, or null when it has no place inside `box`. */
function boxedNode(
  world: World,
  terrain: TerrainGraph,
  box: SettlementBox,
  e: Entity,
): { x: number; y: number; component: number } | null {
  if (!world.has(e, Position)) return null;
  const node = entityNode(world, terrain, e);
  const x = terrain.xOf(node);
  const y = terrain.yOf(node);
  if (!insideBox(box, x, y)) return null;
  return { x, y, component: terrain.componentOf(node) };
}

function intruderOf(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  x: number,
  y: number,
  component: number,
  offender: boolean,
  armed: boolean,
): Intruder {
  const plain = unitDanger(world, ctx, entity);
  const danger = offender && !armed ? plain * OFFENDER_DANGER_MULTIPLIER : plain;
  const scout = !armed && isScoutJob(ctx.content, world.tryGet(entity, Settler)?.jobType ?? null);
  return { entity, x, y, component, danger, offender, scout, armed };
}

/** Whether `e` is a person of no fighting trade: no soldier, hero, animal or vehicle. */
function isCivilian(world: World, ctx: SystemContext, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return (
    settler !== undefined &&
    !isFighterJob(ctx.content, settler.jobType) &&
    !isAnimalTribe(ctx.content, settler.tribe)
  );
}

/** The manned towers and standing shelters of `owned` within `band` of `(x, y)`: what they add to the
 *  defence, and whether the shelters among them stand rung ({@link ZoneThreat.sheltersRung}). */
function fortificationOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  x: number,
  y: number,
  band: number,
): { defence: number; sheltersRung: boolean } {
  let defence = 0;
  let shelters = false;
  let rung = false;
  for (const e of owned) {
    if (!isBuilt(world, e)) continue;
    const tower = garrisonSlots(world, ctx, e).size > 0 && assignedWorkers(world, e).length > 0;
    const shelter = shelterCapacityOf(ctx.content, world.get(e, Building).buildingType) > 0;
    if (!tower && !shelter) continue;
    const at = terrain.coordsOf(entityNode(world, terrain, e));
    if (hexDistanceBetween(at.x, at.y, x, y) > band) continue;
    defence += (tower ? TOWER_DEFENCE : 0) + (shelter ? SHELTER_DEFENCE : 0);
    if (shelter) {
      shelters = true;
      if (world.has(e, DefenceMode)) rung = true;
    }
  }
  return { defence, sheltersRung: !shelters || rung };
}

/** How many soldiers the original sends at a zone of `danger`. */
export function soldiersWanted(danger: number): number {
  return Math.floor((danger + SOLDIERS_WANTED_ROUNDING) / SOLDIER_DANGER);
}

/**
 * Whether `zone` is past what its defence can hold, the signal for arming civilians: its shelters rung
 * first, and its armed danger at the defend threshold and over {@link DESPERATE_DANGER_RATIO} times its
 * defence, towers and shelters or none. Unarmed intruders count for nothing here: the intruder answers
 * meet them, so a lone thief never arms the village.
 */
export function isDesperate(zone: ZoneThreat): boolean {
  const danger = zone.armedDanger;
  if (danger < DEFEND_DANGER_THRESHOLD || !zone.sheltersRung) return false;
  return danger > zone.defence * DESPERATE_DANGER_RATIO;
}

/** The desperate zones of `threat`, ascending anchor id. */
export function desperateZones(threat: SeatThreat): readonly ZoneThreat[] {
  return threat.zones.filter(isDesperate);
}
