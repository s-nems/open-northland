import {
  AssistantCoinDrills,
  AssistantRecruit,
  AttackOrder,
  assistantCoinDrillPriority,
  CoinDrillOrder,
  DeferredOrder,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  OrderQueue,
  ownerOf,
  Position,
  Settler,
  SettlerProgress,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { spokenFor } from '../ai-shared/military/errand.js';
import { mapAiSoldierClaims } from '../ai-shared/military/ownership.js';
import { towerPostFor } from '../conflict/tower-post.js';
import type { SystemContext } from '../context.js';
import { mayCoinDrillAt, startCoinDrill } from '../orders/coin-drill.js';
import { coinDrillClassOf, mayCoinDrill } from '../progression/coin-drill.js';
import { isBarracks } from '../readviews/index.js';
import { drillCoinsAt } from '../settlers/drives/coin-drill.js';

const NO_EXPERIENCE: ReadonlyMap<number, number> = new Map();

/** One idle soldier the beat may send, with his class's rank in the seat's priority. */
interface DrillCandidate {
  readonly entity: Entity;
  readonly rank: number;
  readonly hx: number;
  readonly hy: number;
}

/**
 * The assistant's coin drill: on each beat, every seat whose switch is on sends its idle soldiers to its
 * barracks holding coins no drilling soldier has yet paid for, one man per free coin. A barracks takes its
 * men in class priority, then nearest to it, then lowest id. Our rule. The work scales with the seats
 * switched on, their soldiers and their barracks.
 */
export function dispatchCoinDrills(
  world: World,
  ctx: SystemContext,
  people: (player: number) => readonly Entity[],
  buildings: (player: number) => readonly Entity[],
): void {
  const switches = world.canonicalQuery(AssistantCoinDrills);
  if (switches.length === 0) return;
  const spoken = coinsSpokenFor(world);
  const seen = new Set<number>();
  for (const carrier of switches) {
    const { player } = world.get(carrier, AssistantCoinDrills);
    if (seen.has(player)) continue;
    seen.add(player);
    const houses: { house: Entity; free: number }[] = [];
    for (const house of buildings(player)) {
      if (!isBarracks(world, ctx, house)) continue;
      const free = drillCoinsAt(world, ctx, house) - (spoken.get(house) ?? 0);
      if (free > 0) houses.push({ house, free });
    }
    if (houses.length === 0) continue;
    const candidates = idleDrillers(world, ctx, player, people(player));
    for (const { house, free } of houses) {
      if (candidates.length === 0) return;
      const at = world.tryGet(house, Position);
      if (at === undefined) continue;
      const hx = nodeHxOfPosition(at.x, at.y);
      const hy = nodeHyOfPosition(at.x, at.y);
      const ranked = candidates
        .map((c) => ({ c, d: hexDistanceBetween(c.hx, c.hy, hx, hy) }))
        .sort((a, b) => a.c.rank - b.c.rank || a.d - b.d || a.c.entity - b.c.entity);
      let left = free;
      for (const { c } of ranked) {
        if (left <= 0) break;
        if (!mayCoinDrillAt(world, ctx, c.entity, house)) continue;
        startCoinDrill(world, ctx, c.entity, house);
        candidates.splice(candidates.indexOf(c), 1);
        left -= 1;
      }
    }
  }
}

/** Per barracks, the drilling soldiers whose next repetition has not yet taken its coin. */
function coinsSpokenFor(world: World): Map<Entity, number> {
  const spoken = new Map<Entity, number>();
  for (const e of world.query(CoinDrillOrder)) {
    const order = world.get(e, CoinDrillOrder);
    if (order.stage !== 'drill' || order.paid) continue;
    spoken.set(order.house, (spoken.get(order.house) ?? 0) + 1);
  }
  return spoken;
}

/**
 * `player`'s soldiers the assistant may send: those {@link mayCoinDrill} admits, idle (no fight, order,
 * errand, walk or booking), off the towers and the vehicles and held by no map script.
 */
function idleDrillers(
  world: World,
  ctx: SystemContext,
  player: number,
  people: readonly Entity[],
): DrillCandidate[] {
  const priority = assistantCoinDrillPriority(world, player);
  const claimed = mapAiSoldierClaims(world, player);
  const out: DrillCandidate[] = [];
  for (let i = 0; i < people.length; i++) {
    const e = people[i] as Entity;
    if (ownerOf(world, e) !== player) continue;
    const settler = world.get(e, Settler);
    const weapon = world.tryGet(e, Weapon)?.weaponTypeId;
    const drillClass = coinDrillClassOf(ctx.content, settler, weapon);
    if (drillClass === null) continue;
    const experience = world.tryGet(e, SettlerProgress)?.experience ?? NO_EXPERIENCE;
    if (!mayCoinDrill(ctx.content, settler, weapon, experience)) continue;
    if (spokenFor(world, e) || world.has(e, AttackOrder) || world.has(e, OrderQueue)) continue;
    if (world.has(e, DeferredOrder) || world.has(e, AssistantRecruit)) continue;
    if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE) || claimed.has(e)) continue;
    if (settler.jobType === null || towerPostFor(world, ctx, e, settler.jobType) !== null) continue;
    const p = world.tryGet(e, Position);
    if (p === undefined) continue;
    out.push({
      entity: e,
      rank: priority.indexOf(drillClass),
      hx: nodeHxOfPosition(p.x, p.y),
      hy: nodeHyOfPosition(p.x, p.y),
    });
  }
  return out;
}
