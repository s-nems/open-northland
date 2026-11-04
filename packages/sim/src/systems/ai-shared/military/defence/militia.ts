import {
  AttackOrder,
  Building,
  fightsPlayer,
  Garrison,
  Health,
  hasMissionBehaviour,
  JobAssignment,
  MISSION_BEHAVIOUR,
  Militia,
  Owner,
  Position,
  Settler,
  Sheltering,
  TrainingOrder,
  WorkFlag,
} from '../../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { leashedAttack, strayedPastLeash } from '../../../conflict/leash.js';
import { attackerWeapon } from '../../../conflict/weapons.js';
import type { SystemContext } from '../../../context.js';
import { collectShelters } from '../../../defence/index.js';
import { isAdultSettler } from '../../../family/eligibility.js';
import { peopleNear } from '../../../movement/settler-nodes.js';
import { atomicBlocksOrder, deferOrderDuringAtomic, mayChangeTrade } from '../../../orders/guards.js';
import { assignWorker, takeUpTrade } from '../../../orders/work/employment.js';
import { canChooseJob, needSubjectOf } from '../../../progression/index.js';
import { hunterJobType, isFighterJob, isHunterJob, sheltersOnAlarm } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { isCarrierJob } from '../../../stores/workplace.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../cadence.js';
import { homeSettlers } from '../../home-roster.js';
import { desperateZones, type SeatThreat, type ZoneThreat } from './danger.js';
import type { ScoutChase } from './intruder-answers.js';

// A computer seat arms some of its civilians as hunters, then puts them back to work: against the raiders of
// a desperate settlement zone, once the zone has been safe a while, and against an enemy scout it has no
// soldier for, soon after he leaves. An extension of this engine: the original never arms its civilians.
// Every number here is an approximation.

/** The most civilians one desperate zone arms. */
export const MILITIA_PER_ZONE_MAX = 4;
/** The most civilians one seat holds armed at a time. */
export const MILITIA_PER_SEAT_MAX = 8;
/** At most one in this many of the seat's people is armed, so the economy keeps running. */
export const MILITIA_PEOPLE_SHARE = 4;
/** How long (ticks) a militiaman stays armed after his zone was last desperate: the original's defence
 *  hold after the last blow. */
export const MILITIA_HOLD_TICKS = 360;

/** The most civilians one enemy scout draws, and one seat holds armed against scouts at a time. */
export const SCOUT_CHASERS_PER_SCOUT = 2;
export const SCOUT_CHASERS_PER_SEAT_MAX = 4;
/** How long (ticks) a scout chaser stays armed after his scout last stood inside his leash: two of the
 *  seat's decisions. With the leash reaching past the band a scout draws chasers inside, a scout pacing the
 *  zone's rim keeps the same men armed rather than arming new ones. */
export const SCOUT_CHASE_HOLD_TICKS = 2 * COMPUTER_DECISION_INTERVAL_TICKS;

/** Who is armed first: the idle, then the carriers, then the other workers; nearest first within each. */
const IDLE_RANK = 0;
const CARRIER_RANK = 1;
const WORKER_RANK = 2;

/**
 * One defence decision of a computer seat: keep its militia on the raiders of the zones still desperate in
 * `threat` and on the scouts still inside their leash, send home those whose zone has been safe for
 * {@link MILITIA_HOLD_TICKS} or whose scout left {@link SCOUT_CHASE_HOLD_TICKS} ago, then arm more
 * civilians near each desperate zone and each of `scoutChases` up to the caps. Content without a hunter
 * trade arms nobody.
 *
 * Costs the seat's militiamen, plus a scan of the people near each desperate zone and chased scout.
 */
export function musterMilitia(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  threat: SeatThreat,
  scoutChases: readonly ScoutChase[],
): void {
  const desperate = new Map<Entity, ZoneThreat>();
  for (const zone of desperateZones(threat)) desperate.set(zone.anchor, zone);
  const perZone = new Map<Entity, number>();
  const perScout = new Map<Entity, number>();
  let armed = 0;
  let chasers = 0;
  for (const e of militiaOf(world, player)) {
    if (!isHunterJob(ctx.content, world.get(e, Settler).jobType)) {
      world.remove(e, Militia); // a script or a drill changed his trade since: no longer the militia's
      continue;
    }
    const member = world.get(e, Militia);
    if (member.quarry !== null) {
      if (!keepChasing(world, ctx, terrain, e, member.quarry)) continue;
      chasers++;
      perScout.set(member.quarry, (perScout.get(member.quarry) ?? 0) + 1);
    } else {
      const zone = desperate.get(member.zone);
      if (zone !== undefined) {
        holdArmed(world, ctx, e, MILITIA_HOLD_TICKS);
        if (!world.has(e, AttackOrder) && !world.has(e, Sheltering)) engage(world, ctx, terrain, e, zone);
      } else if (ctx.tick >= member.releaseTick && standDown(world, ctx, e, member)) {
        continue;
      }
      perZone.set(member.zone, (perZone.get(member.zone) ?? 0) + 1);
    }
    armed++;
  }
  if (desperate.size === 0 && scoutChases.length === 0) return;
  const hunterJob = hunterJobType(ctx.content);
  if (hunterJob === null) return;
  const seatCap = Math.min(
    MILITIA_PER_SEAT_MAX,
    Math.floor(homeSettlers(world, ctx, player).length / MILITIA_PEOPLE_SHARE),
  );
  if (desperate.size > 0) {
    const shelterRoom = (collectShelters(world, ctx).get(player) ?? []).some((site) => site.free > 0);
    for (const zone of desperate.values()) {
      const want = Math.min(MILITIA_PER_ZONE_MAX - (perZone.get(zone.anchor) ?? 0), seatCap - armed);
      if (want <= 0) continue;
      const at = terrain.nodeAtClamped(zone.x, zone.y);
      // Who can still take cover takes it: the militia comes from those the shelters cannot hold.
      const unsheltered = (e: Entity): boolean =>
        !shelterRoom || !sheltersOnAlarm(ctx.content, world.get(e, Settler).jobType);
      for (const e of recruits(world, ctx, terrain, player, at, zone.radius, hunterJob, want, unsheltered)) {
        arm(world, ctx, terrain, e, zone, hunterJob, null);
        armed++;
      }
    }
  }
  for (const { scout, zone } of scoutChases) {
    const want = Math.min(
      SCOUT_CHASERS_PER_SCOUT - (perScout.get(scout) ?? 0),
      SCOUT_CHASERS_PER_SEAT_MAX - chasers,
      seatCap - armed,
    );
    if (want <= 0) continue;
    const at = entityNode(world, terrain, scout);
    for (const e of recruits(world, ctx, terrain, player, at, zone.radius, hunterJob, want, anyone)) {
      arm(world, ctx, terrain, e, zone, hunterJob, scout);
      armed++;
      chasers++;
    }
  }
}

/** Keep scout chaser `e` on `quarry` while the scout stands alive and hostile inside his leash, or stand him down
 *  once the hold has run out since; answers whether he is still armed. */
function keepChasing(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  quarry: Entity,
): boolean {
  const member = world.get(e, Militia);
  const near =
    world.isAlive(quarry) &&
    (world.tryGet(quarry, Health)?.hitpoints ?? 0) > 0 &&
    stillEnemy(world, e, quarry) &&
    world.has(quarry, Position) &&
    !strayedPastLeash(world, terrain, member.leash, quarry);
  if (near) {
    holdArmed(world, ctx, e, SCOUT_CHASE_HOLD_TICKS);
    if (world.tryGet(e, AttackOrder)?.target !== quarry && !world.has(e, Sheltering)) {
      attackOnLeash(world, ctx, e, quarry);
    }
    return true;
  }
  return ctx.tick < member.releaseTick || !standDown(world, ctx, e, member);
}

/** Whether `quarry` still belongs to an enemy of `e`'s seat; a truce, a lobby peace or a handover ends the
 *  chase. */
function stillEnemy(world: World, e: Entity, quarry: Entity): boolean {
  const side = world.tryGet(quarry, Owner)?.player;
  return side !== undefined && fightsPlayer(world, side, world.get(e, Owner).player);
}

/** Push `e`'s release `hold` ticks past this decision. */
function holdArmed(world: World, ctx: SystemContext, e: Entity, hold: number): void {
  const releaseTick = ctx.tick + hold;
  if (world.get(e, Militia).releaseTick !== releaseTick) world.mut(e, Militia).releaseTick = releaseTick;
}

const anyone = (): boolean => true;

/**
 * Send every militiaman of `player` home at once, as the computer stops running the seat's military and
 * nothing else would. One a clip holds takes up his old trade once it ends, unposted.
 */
export function disbandMilitia(world: World, ctx: SystemContext, player: number): void {
  for (const e of militiaOf(world, player)) {
    const member = world.get(e, Militia);
    const previousJob = member.previousJob;
    if (standDown(world, ctx, e, member)) continue;
    world.remove(e, Militia);
    deferOrderDuringAtomic(world, ctx, e, { kind: 'setJob', entity: e, jobType: previousJob });
  }
}

/** `player`'s militiamen, ascending id. */
function militiaOf(world: World, player: number): Entity[] {
  const members: Entity[] = [];
  for (const e of world.query(Militia)) {
    if (world.tryGet(e, Owner)?.player === player) members.push(e);
  }
  return members.sort((a, b) => a - b);
}

/** Up to `want` of `player`'s people in the open within `radius` of `at` who may take up `hunterJob`,
 *  shoot with it and pass `eligible`, ranked idle, carrier, worker, then nearest `at`. */
function recruits(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  at: NodeId,
  radius: number,
  hunterJob: number,
  want: number,
  eligible: (e: Entity) => boolean,
): Entity[] {
  const ranked: { e: Entity; rank: number }[] = [];
  for (const e of peopleNear(world, terrain, player, at, radius)) {
    if (mayArm(world, ctx, e, hunterJob) && eligible(e)) ranked.push({ e, rank: rankOf(world, ctx, e) });
  }
  // A stable sort keeps peopleNear's (distance, id) order within a rank.
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, want).map((r) => r.e);
}

/** Whether `e` is a free grown-up civilian the seat may arm: alive, out of every shelter, tower, drill and
 *  fight, his trade his own to change, and the hunter's weapon one his tribe holds. */
function mayArm(world: World, ctx: SystemContext, e: Entity, hunterJob: number): boolean {
  if (!isAdultSettler(world, e)) return false;
  const settler = world.get(e, Settler);
  if (isFighterJob(ctx.content, settler.jobType) || isHunterJob(ctx.content, settler.jobType)) return false;
  if (settler.jobType === null || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return false;
  if (world.has(e, Militia) || world.has(e, AttackOrder) || world.has(e, Sheltering)) return false;
  if (world.has(e, Garrison) || world.has(e, TrainingOrder)) return false;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.PASSIVE)) return false;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)) return false;
  if (!mayChangeTrade(world, ctx.content, e) || atomicBlocksOrder(world, ctx, e)) return false;
  if (!canChooseJob(world, ctx, needSubjectOf(world, e), hunterJob)) return false;
  return attackerWeapon(ctx, settler.tribe, hunterJob) !== null;
}

function rankOf(world: World, ctx: SystemContext, e: Entity): number {
  const jobType = world.get(e, Settler).jobType;
  if (jobType !== null && isCarrierJob(ctx, jobType)) return CARRIER_RANK;
  return world.has(e, JobAssignment) || world.has(e, WorkFlag) ? WORKER_RANK : IDLE_RANK;
}

/** Make `e` a hunter of `zone`'s militia, remembering his trade and post, and send him at `quarry`, or
 *  at the zone's raiders when he has none. */
function arm(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  zone: ZoneThreat,
  hunterJob: number,
  quarry: Entity | null,
): void {
  const previousJob = world.get(e, Settler).jobType;
  if (previousJob === null) return;
  const previousWorkplace = world.tryGet(e, JobAssignment)?.workplace ?? null;
  takeUpTrade(world, ctx, e, hunterJob);
  world.add(e, Militia, {
    zone: zone.anchor,
    leash: { at: terrain.nodeAtClamped(zone.x, zone.y), radius: zone.radius },
    previousJob,
    previousWorkplace,
    releaseTick: ctx.tick + (quarry === null ? MILITIA_HOLD_TICKS : SCOUT_CHASE_HOLD_TICKS),
    quarry,
  });
  if (quarry === null) engage(world, ctx, terrain, e, zone);
  else attackOnLeash(world, ctx, e, quarry);
}

/** Send `e` at the armed raider of `zone` nearest him, ascending (distance, id), on the militia's leash. An
 *  unarmed offender is the offender answer's, not the militia's. */
function engage(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity, zone: ZoneThreat): void {
  // A man aboard a ship has no position of his own and nobody to reach from there.
  if (!world.has(e, Position)) return;
  const at = entityNode(world, terrain, e);
  const x = terrain.xOf(at);
  const y = terrain.yOf(at);
  let target: Entity | null = null;
  let best = Number.POSITIVE_INFINITY;
  // The intruders arrive ascending id, so the strict `<` keeps the lower one on a tie.
  for (const intruder of zone.intruders) {
    if (!intruder.armed) continue;
    const distance = hexDistanceBetween(x, y, intruder.x, intruder.y);
    if (distance < best) {
      target = intruder.entity;
      best = distance;
    }
  }
  if (target !== null) attackOnLeash(world, ctx, e, target);
}

/** Order militiaman `e` at `target` on his militia leash. */
function attackOnLeash(world: World, ctx: SystemContext, e: Entity, target: Entity): void {
  const origin = { player: world.get(e, Owner).player, source: 'settlement-defence' } as const;
  leashedAttack(world, ctx, e, target, { ...world.get(e, Militia).leash }, origin);
}

/**
 * Put `e` back to his old trade, at his old workplace when it still stands, is still the seat's and has
 * his seat open; otherwise unposted, for the economy to place. Answers false, keeping him armed, while a
 * clip holds him.
 */
function standDown(
  world: World,
  ctx: SystemContext,
  e: Entity,
  member: DeepReadonly<{ previousJob: number; previousWorkplace: Entity | null }>,
): boolean {
  if (atomicBlocksOrder(world, ctx, e)) return false;
  const { previousJob, previousWorkplace } = member;
  world.remove(e, Militia);
  const owner = world.get(e, Owner).player;
  if (
    previousWorkplace !== null &&
    world.isAlive(previousWorkplace) &&
    world.has(previousWorkplace, Building) &&
    world.tryGet(previousWorkplace, Owner)?.player === owner
  ) {
    assignWorker(world, ctx, {
      kind: 'assignWorker',
      entity: e,
      building: previousWorkplace,
      jobPriority: [previousJob],
    });
    if (world.tryGet(e, JobAssignment)?.workplace === previousWorkplace) return true;
  }
  takeUpTrade(world, ctx, e, previousJob);
  return true;
}
