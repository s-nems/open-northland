import { CurrentAtomic, Owner, Person, Position, Resting, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isFighterJob, MILITARY_MODE, stanceMode } from '../readviews/index.js';
import { turnOnAttacker } from '../settlers/atomics/effects/combat/hit/reactions.js';
import { entityNode } from '../spatial/nodes.js';
import { type CombatIndex, passIndexOf } from './combat-index.js';
import { runFromBlow, runsFromBlows } from './flee.js';
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
 * the original's alarm among wild animals is not modelled.
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
 * the struck person first of all, runs from the attacker whatever its stance ({@link runsFromBlows}).
 *
 * Intentional deviations: a civilian the player set to ATTACK or DEFEND stays, as that setting says. A tick
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
  const key = `${alarm.player}:${alarm.attacker}`;
  const { answered } = tickAlarms(world, ctx.tick);
  if (answered.has(key) || !world.has(alarm.attacker, Position)) return;
  answered.add(key);
  const from = entityNode(world, terrain, alarm.attacker);
  const { x, y } = terrain.coordsOf(alarm.node);
  for (const { entity, distance } of index.ownedWithin(
    alarm.player,
    x,
    y,
    ALARM_SOLDIER_RADIUS_NODES,
    'hex',
  )) {
    if (!world.has(entity, Person) || indoors(world, entity)) continue;
    const settler = world.get(entity, Settler);
    const mode = stanceMode(world, ctx.content, entity, settler.jobType);
    if (isFighterJob(ctx.content, settler.jobType)) {
      // The struck fighter itself turned as the blow landed.
      if (entity === alarm.victim) continue;
      if (mode === MILITARY_MODE.ATTACK || mode === MILITARY_MODE.DEFEND) {
        turnOnAttacker(world, ctx, alarm.attacker, entity);
      }
    } else if (
      runsFromBlows(ctx, settler, mode) &&
      distance <= ALARM_PEOPLE_RADIUS_NODES &&
      (entity === alarm.victim || !asleep(world, entity)) &&
      isFleeThreat(world, ctx, entity, settler, alarm.attacker, index.firing)
    ) {
      runFromBlow(world, ctx, terrain, entity, from);
    }
  }
}

/** Inside a house, unless standing on its tower post. */
function indoors(world: World, e: Entity): boolean {
  return world.has(e, Resting) && standsAtPost(world, e) === null;
}

function asleep(world: World, e: Entity): boolean {
  return world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep';
}
