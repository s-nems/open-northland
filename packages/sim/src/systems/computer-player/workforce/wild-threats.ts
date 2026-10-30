import {
  AttackOrder,
  Engagement,
  fightsPlayer,
  Garrison,
  Health,
  JobAssignment,
  Militia,
  ownerOf,
  Position,
  Settler,
  Sheltering,
  StayPoint,
  YoungAnimal,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import { ANIMAL_AGGRO_RADIUS_NODES } from '../../conflict/targeting.js';
import { attackerWeapon } from '../../conflict/weapons.js';
import type { SystemContext } from '../../context.js';
import { atomicBlocksOrder } from '../../orders/guards.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import {
  animalCannotBeAttacked,
  animalHitpoints,
  hunterJobType,
  isAggressiveAnimal,
  isHunterJob,
} from '../../readviews/index.js';
import { playerSeesEntity } from '../../vision/gates.js';

// The computer seat's answer to wild animals that attack its people, the ownerless ones and those a map
// gives an enemy player (mroczny_las hands its wolf packs to the forest's people): it sends its hunters at
// them, and hires a hunter or two out of its spare men while it has too few near. The general alarm rule
// is untouched: this is the seat's own order, as a player would give it. Every number here is authored.

/** How near one of the seat's buildings (map points) an attacking animal counts as inside the settlement:
 *  the reach a wild leader takes up a victim in, so any animal that could pick on a man at that building. */
export const WILD_THREAT_REACH_NODES = ANIMAL_AGGRO_RADIUS_NODES;
/** How near the animal (map points) a hunter is called from: twice the animal's own reach, so a hunter at
 *  the far side of a cramped settlement still comes while one off on a distant hunt does not. */
export const WILD_DEFENCE_CALL_NODES = 2 * ANIMAL_AGGRO_RADIUS_NODES;
/** Hunters sent at one animal: two bows, so one hunter hurt by the pack does not leave it alone. */
export const HUNTERS_PER_WILD_THREAT = 2;
/** The most hunters the seat holds hired for defence, beside the hunters its base employs. */
export const WILD_DEFENCE_HIRES_MAX = 2;
/** The strongest adult animal type, in hitpoints, the hunters are sent at: twice a wolf's 1000. Lions
 *  (9000-10000) and the evil hares (20000) outlast two bows and are left to the towers and the army. */
export const HUNTERS_PREY_MAX_HITPOINTS = 2000;

/** The decision's wildlife answer: its commands, and the spare men it took out of the pool. */
export interface WildDefence {
  readonly commands: readonly PlayerCommand[];
  readonly held: ReadonlySet<Entity>;
}

const NO_DEFENCE: WildDefence = { commands: [], held: new Set() };

/**
 * Send `player`'s hunters at the attacking animals its own sight shows inside its settlement
 * ({@link seatWildThreats}): {@link HUNTERS_PER_WILD_THREAT} per animal, the nearest free hunter within
 * {@link WILD_DEFENCE_CALL_NODES} first. While an animal still has too few, the nearest spare man of
 * `pool` who may take up the hunter's trade and its weapon is hired, until the seat holds
 * {@link WILD_DEFENCE_HIRES_MAX} unposted hunters. A hunter already on an animal stays on it, so the
 * order is not re-sent each decision. The men of `pool` sent or hired are held while their animal lasts,
 * so no other post takes them off the fight; once it is gone they are spare men again.
 *
 * Costs the seat's wildlife scan, plus its hunters and the pool per animal found.
 */
export function defendAgainstWildlife(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  pool: readonly Entity[],
): WildDefence {
  const hunterJob = hunterJobType(ctx.content);
  if (hunterJob === null) return NO_DEFENCE;
  const threats = seatWildThreats(world, ctx, player, owned);
  if (threats.length === 0) return NO_DEFENCE;
  const hunters = ownedSettlers(world, player).filter((e) => mayDefend(world, ctx, e));
  // A man of the trade is never hired again, and a hired one only once.
  const notHirable = new Set(hunters);
  let unposted = hunters.filter((e) => !world.has(e, JobAssignment)).length;
  const threatSet = new Set(threats);
  const onThreat = new Map<Entity, number>();
  const busy = new Set<Entity>();
  for (const e of hunters) {
    const target = world.tryGet(e, AttackOrder)?.target;
    if (target === undefined || !threatSet.has(target)) continue;
    busy.add(e);
    onThreat.set(target, (onThreat.get(target) ?? 0) + 1);
  }
  const commands: PlayerCommand[] = [];
  for (const threat of threats) {
    let want = HUNTERS_PER_WILD_THREAT - (onThreat.get(threat) ?? 0);
    if (want <= 0) continue;
    const at = nodeOf(world, threat);
    for (const e of nearestWithin(world, hunters, at, WILD_DEFENCE_CALL_NODES, busy)) {
      if (want <= 0) break;
      busy.add(e);
      commands.push({ kind: 'attackUnit', entity: e, target: threat });
      want--;
    }
    while (want > 0 && unposted < WILD_DEFENCE_HIRES_MAX) {
      const hire = nearestWithin(world, pool, at, WILD_DEFENCE_CALL_NODES, notHirable).find((e) =>
        mayHire(world, ctx, e, hunterJob),
      );
      if (hire === undefined) break;
      notHirable.add(hire);
      busy.add(hire);
      unposted++;
      want--;
      commands.push(
        { kind: 'setJob', entity: hire, jobType: hunterJob },
        { kind: 'attackUnit', entity: hire, target: threat },
      );
    }
  }
  return { commands, held: new Set(pool.filter((e) => busy.has(e))) };
}

/**
 * The adult animals of an `aggressive` type no stronger than {@link HUNTERS_PREY_MAX_HITPOINTS}, alive and
 * attackable, ownerless or owned by a player `player` fights, that `player` sees now and that either stand
 * within {@link WILD_THREAT_REACH_NODES} of one of its buildings `owned` or are attacking one of its people
 * wherever he works, ascending id. A provoked animal of a passive type is the hunt's own business and is
 * left out, and so is a friend's or a peace partner's herd.
 */
export function seatWildThreats(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): Entity[] {
  const threats: Entity[] = [];
  let homes: { hx: number; hy: number }[] | null = null;
  // Wildlife is the StayPoint carrier set, run on the workforce beat: 428-459 animals among 23-37
  // thousand positioned entities on mroczny_las and magiczny_las at game minute 5, 0.10-0.12 ms a seat.
  for (const e of world.query(StayPoint, Settler, Position)) {
    if (world.has(e, YoungAnimal)) continue;
    const keeper = ownerOf(world, e);
    if (keeper !== undefined && !fightsPlayer(world, player, keeper)) continue;
    const tribe = world.get(e, Settler).tribe;
    if (!isAggressiveAnimal(ctx.content, tribe) || animalCannotBeAttacked(ctx.content, tribe)) continue;
    if ((animalHitpoints(ctx.content, tribe) ?? 0) > HUNTERS_PREY_MAX_HITPOINTS) continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    if (!playerSeesEntity(world, ctx.fog, player, e)) continue;
    const victim = world.tryGet(e, Engagement)?.target;
    if (victim !== undefined && world.isAlive(victim) && ownerOf(world, victim) === player) {
      threats.push(e);
      continue;
    }
    homes ??= buildingNodes(world, owned);
    const at = nodeOf(world, e);
    if (homes.some((h) => hexDistanceBetween(h.hx, h.hy, at.hx, at.hy) <= WILD_THREAT_REACH_NODES))
      threats.push(e);
  }
  return threats.sort((a, b) => a - b);
}

/** A hunter of the seat's own who may be sent: alive, out in the open and not the militia's. */
function mayDefend(world: World, ctx: SystemContext, e: Entity): boolean {
  if (!isHunterJob(ctx.content, world.get(e, Settler).jobType)) return false;
  if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return false;
  return !world.has(e, Militia) && !world.has(e, Sheltering) && !world.has(e, Garrison);
}

/** A spare man the seat may make a hunter: his trade is free to change now, he meets the hunter's need,
 *  and his tribe arms that trade. */
function mayHire(world: World, ctx: SystemContext, e: Entity, hunterJob: number): boolean {
  if (atomicBlocksOrder(world, ctx, e) || world.has(e, Sheltering)) return false;
  if (!settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', hunterJob)) return false;
  return attackerWeapon(ctx, world.get(e, Settler).tribe, hunterJob) !== null;
}

/** The members of `from` not in `skip` within `radius` of `at`, ascending (distance, id). */
function nearestWithin(
  world: World,
  from: readonly Entity[],
  at: { hx: number; hy: number },
  radius: number,
  skip: ReadonlySet<Entity>,
): Entity[] {
  const near: { e: Entity; d: number }[] = [];
  for (const e of from) {
    if (skip.has(e) || !world.has(e, Position)) continue;
    const n = nodeOf(world, e);
    const d = hexDistanceBetween(at.hx, at.hy, n.hx, n.hy);
    if (d <= radius) near.push({ e, d });
  }
  return near.sort((a, b) => a.d - b.d || a.e - b.e).map((n) => n.e);
}

function buildingNodes(world: World, owned: readonly Entity[]): { hx: number; hy: number }[] {
  return owned.filter((b) => world.has(b, Position)).map((b) => nodeOf(world, b));
}

function nodeOf(world: World, e: Entity): { hx: number; hy: number } {
  const p = world.get(e, Position);
  return { hx: nodeHxOfPosition(p.x, p.y), hy: nodeHyOfPosition(p.x, p.y) };
}
