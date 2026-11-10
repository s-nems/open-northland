import {
  CurrentAtomic,
  Engagement,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  Owner,
  Person,
  Position,
  Resting,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isFighterJob, MILITARY_MODE, stanceMode } from '../readviews/index.js';
import { type Strike, strikeBy, turnFighterOn } from '../settlers/atomics/effects/combat/hit/reactions.js';
import { entityNode } from '../spatial/nodes.js';
import { type CombatIndex, type KeptKeys, keyDistance, keyEntity, passIndexOf } from './combat-index.js';
import { runFromBlow, runsFromBlows } from './flee.js';
import { mayStrikeBack, strikeBack } from './strike-back.js';
import { isFleeThreat } from './targeting.js';
import { standsAtPost } from './tower-post.js';

// The alarm a blow raises: the struck person's side reacts as if it had been struck itself.

/** How far (map points) from a struck person its side's soldiers answer the blow. Original behavior. */
export const ALARM_SOLDIER_RADIUS_NODES = 40;

/** How far (map points) from a struck person the rest of its side runs from the blow. Original behavior. */
export const ALARM_PEOPLE_RADIUS_NODES = 20;

/** One blow on a player's person, waiting for the combat pass that answers it. */
interface Alarm {
  readonly player: number;
  readonly victim: Entity;
  readonly node: NodeId;
  readonly attacker: Entity;
}

/** A tick's alarms: the melee blows queued ahead of the combat pass, and the (player, attacker) pairs
 *  already answered. Tick-scoped: the melee blows that write it and the combat pass that drains it run in
 *  the same tick, so nothing in it outlives the tick a save would split, and an entry of an older tick is
 *  dropped unread. */
interface TickAlarms {
  readonly tick: number;
  readonly queued: Alarm[];
  readonly answered: Set<string>;
}

const alarmsByWorld = new WeakMap<World, TickAlarms>();

function tickAlarms(world: World, tick: number): TickAlarms {
  const held = alarmsByWorld.get(world);
  if (held !== undefined && held.tick === tick) return held;
  const fresh: TickAlarms = { tick, queued: [], answered: new Set() };
  alarmsByWorld.set(world, fresh);
  return fresh;
}

/**
 * Raise the alarm for a blow that landed on `victim`. Original behavior: a blow on a person re-runs the
 * struck reaction for its side's soldiers within {@link ALARM_SOLDIER_RADIUS_NODES} and its people within
 * {@link ALARM_PEOPLE_RADIUS_NODES}. A melee blow lands before this tick's combat pass and waits for it; a
 * shot lands after it and is answered at once from the pass's index. Only a player's person raises it;
 * a struck animal rouses its kin through `reactToBlowOnAnimal` instead.
 *
 * An alarm on a tick whose combat pass did not run goes unanswered, since the queue is tick-scoped state no
 * save carries. The pass's gate lets a tick through whenever the striker could still be fought: another
 * player's man, a hostile or angered beast, an enemy house. A blow that finds it shut came from a striker
 * no one would turn on, a dead archer's arrow or a stray shot on its own side.
 */
export function raiseHitAlarm(world: World, ctx: SystemContext, attacker: Entity, victim: Entity): void {
  const terrain = ctx.terrain;
  const owner = world.tryGet(victim, Owner);
  if (terrain === undefined || owner === undefined || !world.has(victim, Person)) return;
  if (!world.has(victim, Position)) return;
  const alarm: Alarm = { player: owner.player, victim, node: entityNode(world, terrain, victim), attacker };
  const index = passIndexOf(world, ctx.tick);
  if (index === null) tickAlarms(world, ctx.tick).queued.push(alarm);
  else answerAlarm(world, ctx, terrain, index, alarm);
}

/** Answer the melee alarms this tick's blows queued, from the combat pass's own index. */
export function answerQueuedAlarms(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
): void {
  const held = alarmsByWorld.get(world);
  if (held === undefined || held.tick !== ctx.tick) return;
  const queued = held.queued.splice(0);
  for (const alarm of queued) answerAlarm(world, ctx, terrain, index, alarm);
}

/**
 * The side's answer to one alarm. Original behavior: a soldier or hero under ATTACK or DEFEND turns on the
 * attacker the way a struck one does, and under any other stance does nothing; everyone else near enough,
 * the struck person first of all, runs from the attacker whatever its stance ({@link runsFromBlows}). A
 * struck person with {@link MISSION_BEHAVIOUR.BLOW_RAISES_NO_ALARM} answers alone.
 *
 * Intentional deviations: a civilian the player set to ATTACK or DEFEND stays, as that setting says. A
 * computer seat answers an unarmed attacker by striking back ({@link strikeBack}), its other people keeping
 * to their work and the struck one running only when it cannot strike. A tick
 * answers each (player, attacker) pair once, around its first victim, so a second victim of the same area
 * shot does not widen the circle. No one inside a house but a man on his tower answers: a soldier asleep
 * at home would otherwise wake holding a raider long gone and chase it (whether the original's alarm
 * reaches indoors is unconfirmed). A person asleep in the open sleeps through it too, for the same reason;
 * the struck one is woken by the blow itself and runs.
 */
function answerAlarm(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  alarm: Alarm,
): void {
  if (!world.has(alarm.attacker, Position)) return;
  // A victim that answers alone spends no circle, so a later victim of the same shot still raises one.
  const alone = hasMissionBehaviour(world, alarm.victim, MISSION_BEHAVIOUR.BLOW_RAISES_NO_ALARM);
  if (!alone) {
    const key = `${alarm.player}:${alarm.attacker}`;
    const { answered } = tickAlarms(world, ctx.tick);
    if (answered.has(key)) return;
    answered.add(key);
  }
  const from = entityNode(world, terrain, alarm.attacker);
  const answering = answeringOf(world);
  if (alone) {
    // A key of distance 0 is the entity itself.
    answering.keys[0] = alarm.victim;
    answering.count = 1;
  } else {
    index.ownedUnitsWithin(
      alarm.player,
      terrain.xOf(alarm.node),
      terrain.yOf(alarm.node),
      ALARM_SOLDIER_RADIUS_NODES,
      'hex',
      answering,
    );
  }
  let struckBack = false;
  if (mayStrikeBack(world, ctx, alarm.victim, alarm.attacker)) {
    const people: { entity: Entity }[] = [];
    for (let i = 0; i < answering.count; i++) {
      const key = answering.keys[i] ?? 0;
      if (keyDistance(key) > ALARM_PEOPLE_RADIUS_NODES) break;
      const entity = keyEntity(key);
      if (world.has(entity, Person) && !indoors(world, entity)) people.push({ entity });
    }
    struckBack = strikeBack(world, ctx, terrain, alarm.victim, alarm.attacker, people);
  }
  // The blow as this player's fighters read it, made for the first one that may turn.
  let strike: Strike | undefined;
  for (let i = 0; i < answering.count; i++) {
    const key = answering.keys[i] ?? 0;
    const entity = keyEntity(key);
    if (!world.has(entity, Person) || indoors(world, entity)) continue;
    const settler = world.get(entity, Settler);
    const mode = stanceMode(world, ctx.content, entity, settler.jobType);
    if (isFighterJob(ctx.content, settler.jobType)) {
      // The struck fighter itself turned as the blow landed.
      if (entity === alarm.victim) continue;
      // Already on this attacker: the turn would write nothing.
      if (world.tryGet(entity, Engagement)?.target === alarm.attacker) continue;
      if (mode === MILITARY_MODE.ATTACK || mode === MILITARY_MODE.DEFEND) {
        strike ??= strikeBy(world, ctx, alarm.attacker);
        turnFighterOn(world, ctx, terrain, strike, entity, settler, mode);
      }
    } else if (
      (!struckBack || entity === alarm.victim) &&
      runsFromBlows(ctx, settler, mode) &&
      keyDistance(key) <= ALARM_PEOPLE_RADIUS_NODES &&
      (entity === alarm.victim || !asleep(world, entity)) &&
      isFleeThreat(world, ctx, entity, settler, alarm.attacker, index.firing)
    ) {
      runFromBlow(world, ctx, terrain, entity, from);
    }
  }
}

/** The units one alarm reaches, in a buffer each world keeps: an answer runs searches of its own while it
 *  reads them, and no answer starts inside another. */
const answeringByWorld = new WeakMap<World, KeptKeys>();

/** Keys the buffer holds before its first growth. */
const INITIAL_ANSWERING_KEYS = 64;

function answeringOf(world: World): KeptKeys {
  let held = answeringByWorld.get(world);
  if (held === undefined) {
    held = { keys: new Float64Array(INITIAL_ANSWERING_KEYS), count: 0 };
    answeringByWorld.set(world, held);
  }
  return held;
}

/** Inside a house, unless standing on its tower post. */
function indoors(world: World, e: Entity): boolean {
  return world.has(e, Resting) && standsAtPost(world, e) === null;
}

function asleep(world: World, e: Entity): boolean {
  return world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep';
}
