import {
  AttackOrder,
  Building,
  DefenceMode,
  diplomacyStance,
  MAX_PLAYERS,
  type OperationEndReason,
  Owner,
  type RaidOperation,
  Stance,
  seatPeaceEndTick,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import { Rng } from '../../../../core/rng.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeManhattan } from '../../../../nav/halfcell.js';
import { moduleBeatDue } from '../../../ai-shared/cadence.js';
import { isRangedFighter } from '../../../ai-shared/military/census.js';
import {
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from '../../../ai-shared/military/defence/index.js';
import { spokenFor } from '../../../ai-shared/military/errand.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { MILITARY_MODE } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { playerSeesNode } from '../../../vision/gates.js';
import { computerProfileOf } from '../../difficulty.js';
import { WAVE_MIN_SOLDIERS } from '../muster.js';
import { unitPoints } from '../points.js';
import { bandCentre, gatheredAt, homeOf, isAlive, walkTo } from './band.js';
import { enter, NEVER_READY, type OperationEnv, type OperationHandler } from './lifecycle.js';
import {
  believedEnemyTowers,
  fighterPointsNear,
  flankRoute,
  nodeOfEntity,
  pickRaidTarget,
  routeUnderTower,
  visibleFighters,
  visibleGatherers,
} from './raid-target.js';

// A raid (owner ruling): a small band, archers first, leaves from the barracks door, swings out to the
// flank of the enemy base, strikes the gatherers it finds at its target and comes home as soon as it sees
// the enemy answer. Every figure below is authored.

/** The stance a raid's men hold while out: they walk to no fight of their own, so a building, a soldier or
 *  a militiaman on the way never pulls the band into the base, yet they strike back at what stands in reach
 *  and their strike orders still run. Authored: a band in the attacking stance spends most of its blows on
 *  buildings and soldiers while the town arms against it. */
export const RAID_STANCE = MILITARY_MODE.IGNORE;
/** The stance a raid's men take back once home: the one the seat's other bands and the muster hold. */
export const RAID_HOME_STANCE = MILITARY_MODE.ATTACK;

const SECONDS_PER_MINUTE = 60;

/** The band a raid takes, and the fewest it sets out with. */
export const RAID_BAND_MEN = 4;
export const RAID_MIN_MEN = 3;
/** The free men a raid always leaves at the barracks door: the smallest wave. */
export const RAID_HOME_FLOOR_MEN = WAVE_MIN_SOLDIERS;
/** The shortest and longest wait for a seat's next raid, from its peace end for the first and from the
 *  end of the last for every other, drawn anew each time from the seeded roll (owner ruling: raids are a
 *  rare distraction, one or two a game). */
export const RAID_DELAY_MIN_TICKS = 20 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
export const RAID_DELAY_MAX_TICKS = 60 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** The chance, in percent, that a seat whose plan is not the harasser's raids at all in a match, drawn
 *  once at its peace end (owner ruling: some seats never raid, the harasser plan always does; the even
 *  chance is authored). */
export const RAID_SEAT_CHANCE_PCT = 50;
/** How near the door, and then each waypoint or home, the band counts as gathered there. */
export const RAID_GATHER_RADIUS_NODES = 10;
/** The most a raid waits for its band at the door, walks one leg, strikes, or walks home. */
export const RAID_FORM_TIMEOUT_TICKS = 30 * TICKS_PER_SECOND;
export const RAID_LEG_TIMEOUT_TICKS = 2 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
export const RAID_STRIKE_TIMEOUT_TICKS = 3 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
export const RAID_WITHDRAW_TIMEOUT_TICKS = 3 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;
/** How far around its target a raid looks for people to strike. */
export const RAID_STRIKE_RADIUS_NODES = 24;
/** How long a raid at its target waits for someone to strike before it goes home. */
export const RAID_IDLE_TICKS = 30 * TICKS_PER_SECOND;
/** Every how many of the seat's decisions it looks for a raid to open (authored): a raid is never
 *  urgent, and the target scan reads the enemies' people. */
export const RAID_LOOK_EVERY_DECISIONS = 3;
/** The share of its men, in percent, a raid may lose before it turns back. */
export const RAID_LOSS_PCT = 50;

const PERCENT = 100;

/** The band's men who are neither near `at` nor already walking there walk on, a plain walk that stops for
 *  no fight; all of them when `everyone`. */
function walkBand(
  env: OperationEnv,
  members: readonly Entity[],
  at: HalfCellNode,
  everyone: boolean,
): PlayerCommand[] {
  return walkTo(env.world, members, at, 'moveUnit', everyone, RAID_GATHER_RADIUS_NODES);
}

function gathered(world: World, members: readonly Entity[], at: HalfCellNode): boolean {
  return gatheredAt(world, members, at, RAID_GATHER_RADIUS_NODES);
}

function targetNode(op: RaidOperation): HalfCellNode {
  return { hx: op.target.hx, hy: op.target.hy };
}

/** Turn the band home for `reason`, back the way it came: through the waypoints it has passed, the last
 *  first, so the walk home keeps as clear of believed towers as the walk out. */
function withdraw(env: OperationEnv, op: RaidOperation, reason: OperationEndReason): PlayerCommand[] {
  enter(op, 'withdrawing', env.ctx.tick, reason);
  op.leg = Math.min(op.leg, op.waypoints.length);
  return walkBand(env, op.members, wayBack(env, op), true);
}

/** Where the band's walk home leads next: the last waypoint it has yet to walk back through, else home. */
function wayBack(env: OperationEnv, op: RaidOperation): HalfCellNode {
  return op.waypoints[op.leg - 1] ?? homeOf(env);
}

/** Why the band should turn back now, or null: its seat calls its raids home, the target's owner is no
 *  enemy, it lost {@link RAID_LOSS_PCT} of its men, the rest of its way or its target lies in a believed
 *  tower's reach, it sees an enemy building switched to defence near its target or with the band in its
 *  shooting reach, or the enemy fighters and militia it sees near it outweigh its own points. Passing near
 *  a tower whose reach its way keeps clear of turns no band back. Costs the enemies' fighters, militia and
 *  buildings. */
function abortReason(env: OperationEnv, op: RaidOperation): OperationEndReason | null {
  const { world, ctx, seat } = env;
  const owner = op.target.owner;
  if (env.orders.raidsRecalled) return 'postureChanged';
  if (owner === null || diplomacyStance(world, seat, owner) !== 'enemy') return 'targetLost';
  if ((op.startMen - op.members.length) * PERCENT >= op.startMen * RAID_LOSS_PCT) return 'losses';
  const centre = bandCentre(world, op.members);
  if (centre === null) return null;
  if (routeUnderTower(believedEnemyTowers(world, ctx, seat), op.waypoints, op.leg, targetNode(op)))
    return 'towerInReach';
  if (defenceModeNear(env, owner, targetNode(op), centre)) return 'defenceMode';
  let ownPoints = 0;
  for (const e of op.members) ownPoints += unitPoints(world, ctx, e);
  let enemyPoints = 0;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || diplomacyStance(world, seat, other) !== 'enemy') continue;
    enemyPoints += fighterPointsNear(visibleFighters(world, ctx, seat, other), centre);
  }
  return enemyPoints > ownPoints ? 'outmatched' : null;
}

/** Whether `seat` sees a building in defence mode of `owner` within {@link RAID_STRIKE_RADIUS_NODES} of
 *  `target`, or of any enemy with the band's `centre` inside the reach its house bow fires from it plus the
 *  stand-down margin ({@link threatWatchNodes}): an alarmed building shoots whoever stands there. Costs the
 *  buildings in defence mode. */
function defenceModeNear(
  { world, ctx, seat }: OperationEnv,
  owner: number,
  target: HalfCellNode,
  centre: HalfCellNode,
): boolean {
  for (const e of world.query(DefenceMode, Owner)) {
    const other = world.get(e, Owner).player;
    if (other === seat || diplomacyStance(world, seat, other) !== 'enemy') continue;
    const building = world.tryGet(e, Building);
    const node = anchorNodeOf(world, e);
    if (building === undefined || node === null) continue;
    const fire = threatWatchNodes(ctx, building.tribe) + THREAT_STAND_DOWN_MARGIN_NODES;
    const covers =
      hexDistance(node, centre) <= fire ||
      (other === owner && nodeManhattan(node, target) <= RAID_STRIKE_RADIUS_NODES);
    if (covers && playerSeesNode(ctx.fog, seat, node.hx, node.hy)) return true;
  }
  return false;
}

/**
 * The strike: every man not already on a live one is sent at a gatherer the seat sees within
 * {@link RAID_STRIKE_RADIUS_NODES} of the target, nearest the band first, round the band in id order;
 * with none in sight the band walks onto the target, and home once it has waited {@link RAID_IDLE_TICKS}
 * there.
 */
function strike(env: OperationEnv, op: RaidOperation): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const owner = op.target.owner;
  if (owner === null) return withdraw(env, op, 'targetLost');
  const at = targetNode(op);
  const centre = bandCentre(world, op.members) ?? at;
  const prey = visibleGatherers(world, ctx, seat, owner)
    .flatMap((e) => {
      const node = nodeOfEntity(world, e);
      return node !== null && nodeManhattan(node, at) <= RAID_STRIKE_RADIUS_NODES
        ? [{ e, distance: nodeManhattan(node, centre) }]
        : [];
    })
    .sort((a, b) => a.distance - b.distance || a.e - b.e)
    .map(({ e }) => e);
  if (prey.length === 0) {
    if (gathered(world, op.members, at) && ctx.tick - op.since >= RAID_IDLE_TICKS)
      return withdraw(env, op, 'nothingToStrike');
    return walkBand(env, op.members, at, false);
  }
  const hunted = new Set(prey);
  const commands: PlayerCommand[] = [];
  let next = 0;
  for (const e of op.members) {
    const current = world.tryGet(e, AttackOrder)?.target;
    if (current !== undefined && hunted.has(current)) continue;
    const quarry = prey[next++ % prey.length];
    if (quarry === undefined) continue;
    commands.push({ kind: 'attackUnit', entity: e, target: quarry });
    if (!op.struck.includes(quarry)) op.struck = [...op.struck, quarry].sort((a, b) => a - b);
  }
  return commands;
}

function step(env: OperationEnv, op: RaidOperation): readonly PlayerCommand[] {
  const { world, ctx } = env;
  const tick = ctx.tick;
  op.killed = op.struck.filter((e) => !isAlive(world, e)).length;
  if (op.members.length === 0) {
    enter(op, 'failed', tick, 'wiped');
    return [];
  }
  const home = homeOf(env);
  switch (op.state) {
    case 'forming': {
      if (!env.orders.raidsAllowed) return withdraw(env, op, 'postureChanged');
      if (!gathered(world, op.members, home) && tick - op.since < RAID_FORM_TIMEOUT_TICKS)
        return walkBand(env, op.members, home, false);
      enter(op, 'moving', tick);
      return walkBand(env, op.members, legEnd(op), true);
    }
    case 'moving': {
      const reason = abortReason(env, op);
      if (reason !== null) return withdraw(env, op, reason);
      const end = legEnd(op);
      if (!gathered(world, op.members, end) && tick - op.since < RAID_LEG_TIMEOUT_TICKS)
        return walkBand(env, op.members, end, false);
      if (op.leg < op.waypoints.length) {
        op.leg++;
        enter(op, 'moving', tick);
        return walkBand(env, op.members, legEnd(op), true);
      }
      enter(op, 'acting', tick);
      return strike(env, op);
    }
    case 'acting': {
      const reason = abortReason(env, op);
      if (reason !== null) return withdraw(env, op, reason);
      if (tick - op.since >= RAID_STRIKE_TIMEOUT_TICKS) return withdraw(env, op, 'timedOut');
      return strike(env, op);
    }
    case 'withdrawing': {
      const back = wayBack(env, op);
      if (op.leg > 0) {
        if (!gathered(world, op.members, back) && tick - op.since < RAID_LEG_TIMEOUT_TICKS)
          return walkBand(env, op.members, back, false);
        op.leg--;
        enter(op, 'withdrawing', tick);
        return walkBand(env, op.members, wayBack(env, op), true);
      }
      if (gathered(world, op.members, home) || tick - op.since >= RAID_WITHDRAW_TIMEOUT_TICKS) {
        enter(op, 'done', tick);
        return homeStance(world, op.members);
      }
      return walkBand(env, op.members, home, false);
    }
    case 'done':
    case 'failed':
      return [];
  }
}

/** The stance orders that hand the band's men back to the seat in {@link RAID_HOME_STANCE}: a man the
 *  muster passes over as spoken for would otherwise stay passive at home. */
function homeStance(world: World, members: readonly Entity[]): PlayerCommand[] {
  return members.flatMap((e): PlayerCommand[] =>
    world.tryGet(e, Stance)?.mode === RAID_HOME_STANCE
      ? []
      : [{ kind: 'setStance', entity: e, mode: RAID_HOME_STANCE }],
  );
}

/** Where the band's current leg ends: the next flank waypoint, else the target. */
function legEnd(op: RaidOperation): HalfCellNode {
  return op.waypoints[op.leg] ?? targetNode(op);
}

/**
 * A new raid when the seat's orders allow raids (its harassing posture, or a hard seat's flank raids) and
 * its peace is over: from the free men on the door's
 * land and on no errand, leaving {@link RAID_HOME_FLOOR_MEN} of them, up to {@link RAID_BAND_MEN}, archers
 * first, then the nearest the door, then by id; at the best target ({@link pickRaidTarget}), by a way clear
 * of believed towers ({@link flankRoute}), looked for on every {@link RAID_LOOK_EVERY_DECISIONS}th decision.
 * None with fewer than {@link RAID_MIN_MEN} to spare, nothing worth striking or no way to it.
 */
function open(env: OperationEnv, free: readonly Entity[], id: number) {
  const { world, ctx, terrain, seat, home, orders } = env;
  if (!orders.raidsAllowed || ctx.tick < raidsFromTick(world, seat)) return null;
  const land = terrain.componentOf(home);
  const ready = free.filter(
    (e) => !spokenFor(world, e) && terrain.componentOf(entityNode(world, terrain, e)) === land,
  );
  const size = Math.min(RAID_BAND_MEN, ready.length - RAID_HOME_FLOOR_MEN);
  if (size < RAID_MIN_MEN || !moduleBeatDue(ctx.tick, seat, RAID_LOOK_EVERY_DECISIONS)) return null;
  const pick = pickRaidTarget(world, ctx, terrain, seat, home);
  if (pick === null || pick.target.owner === null) return null;
  const waypoints = flankRoute(world, terrain, home, pick.target, believedEnemyTowers(world, ctx, seat));
  if (waypoints === null) return null;
  const ranked = ready
    .map((e) => ({
      e,
      ranged: isRangedFighter(world, ctx, e) ? 0 : 1,
      distance: nodeManhattan(nodeOfEntity(world, e) ?? homeOf(env), homeOf(env)),
    }))
    .sort((a, b) => a.ranged - b.ranged || a.distance - b.distance || a.e - b.e);
  const members = ranked
    .slice(0, size)
    .map(({ e }) => e)
    .sort((a, b) => a - b);
  const op: RaidOperation = {
    id,
    kind: 'raid',
    state: 'forming',
    since: ctx.tick,
    members,
    target: pick.target,
    reason: null,
    waypoints,
    leg: 0,
    startMen: members.length,
    struck: [],
    killed: 0,
  };
  const commands: PlayerCommand[] = [];
  for (const e of members) {
    if (world.tryGet(e, Stance)?.mode !== RAID_STANCE)
      commands.push({ kind: 'setStance', entity: e, mode: RAID_STANCE });
  }
  commands.push(...walkBand(env, members, homeOf(env), false));
  return { op, commands };
}

/** The first tick `seat` may raid: its peace end, or its difficulty's first wave if later. */
function raidsFromTick(world: World, seat: number): number {
  return Math.max(seatPeaceEndTick(world, seat), computerProfileOf(world, seat).army.firstWaveFromTick);
}

/** Spreads seats deciding on the same tick apart in {@link raidRoll}: the 32-bit golden-ratio constant. */
const SEAT_STREAM_MIX = 0x9e3779b9;

/** The seat's raid dice: seeded from the sim's stream position and the seat, read without drawing from the
 *  stream, so a raid draw shifts no other roll of the match. */
function raidRoll(ctx: SystemContext, seat: number): Rng {
  return new Rng(ctx.rng.getState() ^ Math.imul(seat + 1, SEAT_STREAM_MIX));
}

/** A wait between {@link RAID_DELAY_MIN_TICKS} and {@link RAID_DELAY_MAX_TICKS}, both included. */
function drawRaidDelay(roll: Rng): number {
  return RAID_DELAY_MIN_TICKS + roll.int(RAID_DELAY_MAX_TICKS - RAID_DELAY_MIN_TICKS + 1);
}

/** On the seat's first decision past {@link raidsFromTick} with its plan drawn: whether it raids in this
 *  match (the harasser plan always, any other at {@link RAID_SEAT_CHANCE_PCT}), and when first. */
function firstRaidAt({ world, ctx, seat, orders }: OperationEnv): number | null {
  if (orders.plan === null || ctx.tick < raidsFromTick(world, seat)) return null;
  const roll = raidRoll(ctx, seat);
  if (orders.plan !== 'harasser' && roll.int(PERCENT) >= RAID_SEAT_CHANCE_PCT) return NEVER_READY;
  return ctx.tick + drawRaidDelay(roll);
}

export const raidHandler: OperationHandler<RaidOperation> = {
  phase: 'beforeCampaign',
  cooldownTicks: ({ ctx, seat }) => drawRaidDelay(raidRoll(ctx, seat)),
  firstReadyAt: firstRaidAt,
  step,
  open,
};
