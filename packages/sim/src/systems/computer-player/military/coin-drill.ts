import { computerModuleRuns } from '../../../components/ai/control.js';
import { Building, Settler, storePriorityGoods } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { spokenFor } from '../../ai-shared/military/errand.js';
import type { SystemContext } from '../../context.js';
import { mayCoinDrillAt } from '../../orders/coin-drill.js';
import { drillCoinGood } from '../../progression/coin-drill.js';
import { isBarracks, isSoldierJob } from '../../readviews/index.js';
import { soldierMayCoinDrill } from '../../settlers/drives/coin-drill.js';
import { freeDrillCoins } from '../../settlers/drives/coin-drill-coins.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { hexNodeDistance } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import { keepsStorePriority, stockCapacity } from '../../stores/index.js';
import { seatBarracksOf } from '../base.js';

// Owner ruling: a seat keeps coins at its barracks while it has soldiers who may still coin-drill, its
// porters fetching them as a priority good, and drills the idle soldiers standing near a barracks that
// holds a free coin. The counts and the reach are authored.

/** From how many soldiers who may still drill the seat posts a second porter, and a third. */
export const SECOND_DRILL_PORTER_DRILLERS = 10;
export const THIRD_DRILL_PORTER_DRILLERS = 20;

/** The barracks porters by the soldiers who may still drill, most first: one from the first such man. */
const DRILL_PORTERS_BY_DRILLERS: readonly { readonly drillers: number; readonly porters: number }[] = [
  { drillers: THIRD_DRILL_PORTER_DRILLERS, porters: 3 },
  { drillers: SECOND_DRILL_PORTER_DRILLERS, porters: 2 },
  { drillers: 1, porters: 1 },
];

/** How near a barracks door, in hex nodes, an idle soldier stands to be sent to drill there: a short
 *  walk from the rally ground beside it, never a march across the settlement. */
export const COIN_DRILL_REACH_NODES = 30;

/** How many of `player`'s home soldiers may still coin-drill ({@link soldierMayCoinDrill}). Work scales
 *  with the seat's settlers, as the census's does. */
function seatDrillerCount(world: World, ctx: SystemContext, player: number): number {
  let count = 0;
  for (const e of homeSettlers(world, ctx, player)) {
    const settler = world.get(e, Settler);
    if (isSoldierJob(ctx.content, settler.jobType) && soldierMayCoinDrill(world, ctx, e, settler)) count++;
  }
  return count;
}

/**
 * The porters `player` posts at its barracks for the drill coins: none while the military module does
 * not run, no barracks stands, the content has no coin or no soldier may still drill; else one, two from
 * {@link SECOND_DRILL_PORTER_DRILLERS} such soldiers and three from {@link THIRD_DRILL_PORTER_DRILLERS}.
 */
export function coinDrillPorters(world: World, ctx: SystemContext, player: number): number {
  if (!computerModuleRuns(world, player, 'military')) return 0;
  if (drillCoinGood(ctx.content) === undefined || seatBarracksOf(world, ctx, player) === null) return 0;
  const drillers = seatDrillerCount(world, ctx, player);
  return DRILL_PORTERS_BY_DRILLERS.find((step) => drillers >= step.drillers)?.porters ?? 0;
}

/**
 * The store-priority commands keeping coin a priority good at each finished barracks among `owned` while
 * the seat posts drill porters ({@link coinDrillPorters}), and taking the mark off while it posts none, so
 * no coin is pulled there for nothing. A mark already in the wanted state is never sent again.
 */
export function coinPriorityOrders(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): PlayerCommand[] {
  const coin = drillCoinGood(ctx.content);
  if (coin === undefined) return [];
  const wanted = coinDrillPorters(world, ctx, player) > 0;
  const commands: PlayerCommand[] = [];
  for (const barracks of owned) {
    if (!isBarracks(world, ctx, barracks)) continue;
    if (!keepsStorePriority(ctx.content, world.get(barracks, Building).buildingType)) continue;
    if (stockCapacity(world, ctx, barracks, coin) <= 0) continue;
    if (storePriorityGoods(world, barracks).includes(coin) === wanted) continue;
    commands.push({ kind: 'setStorePriority', building: barracks, goodType: coin, priority: wanted });
  }
  return commands;
}

/**
 * The coin-drill orders for `idle`, the soldiers the seat's other standing orders leave at home this
 * decision: at each finished barracks among `owned`, the men within {@link COIN_DRILL_REACH_NODES} of its
 * door who pass {@link mayCoinDrillAt} and are on no errand, nearest first, then by id, one per free coin.
 * A man is sent to one barracks only. The same order a player gives.
 */
export function coinDrillOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  idle: readonly Entity[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const sent = new Set<Entity>();
  for (const barracks of owned) {
    if (!isBarracks(world, ctx, barracks)) continue;
    // The barracks itself holds no drill order, so every coin no man speaks for counts.
    const coins = freeDrillCoins(world, ctx, barracks, barracks);
    if (coins <= 0) continue;
    const door = interactionCell(world, ctx, terrain, barracks);
    const near: { e: Entity; distance: number }[] = [];
    for (const e of idle) {
      if (sent.has(e) || spokenFor(world, e)) continue;
      const distance = hexNodeDistance(terrain, entityNode(world, terrain, e), door);
      if (distance > COIN_DRILL_REACH_NODES || !mayCoinDrillAt(world, ctx, e, barracks)) continue;
      near.push({ e, distance });
    }
    near.sort((a, b) => a.distance - b.distance || a.e - b.e);
    for (const { e } of near.slice(0, coins)) {
      sent.add(e);
      commands.push({ kind: 'orderCoinDrill', entity: e, house: barracks });
    }
  }
  return commands;
}
