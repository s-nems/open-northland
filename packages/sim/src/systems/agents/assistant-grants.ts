import type { EquipCategory } from '@open-northland/data';
import {
  Age,
  AssistantGrants,
  Carrying,
  Equipment,
  type EquipmentData,
  EquipOrder,
  equipSlotValue,
  ownerOf,
  ownersCompatible,
  Position,
  Settler,
  Stockpile,
  SupplyRun,
  UnderConstruction,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { type NavigationLimit, navigationLimitFor } from '../signposts/index.js';
import { canonicalById } from '../spatial.js';
import type { PlannerPass } from './planner-pass.js';
import { anotherSystemOwns } from './replan.js';
import { nearestStoreHolding } from './targets/index.js';
import { unreachableGoalVeto } from './unreachable-goals.js';

/**
 * The assistant's auto-equip pass: for every player with {@link AssistantGrants}, send settlers with
 * a matching free slot to fetch the granted goods (the ordinary {@link EquipOrder} errand, stamped
 * WITHOUT the manual order's interrupts - the settler finishes its current step first). Two brakes
 * keep a big settlement from mobbing two pairs of boots (user rule 2026-07-25):
 *
 *  - demand-side reservation: per player and good, the assistant stops dispatching once fetch
 *    errands underway (`acquire` stage, manual orders counted too) match the player's store stock,
 *    so no one is sent after a unit someone else is already walking to;
 *  - a trickle: at most {@link ASSISTANT_MAX_IN_FLIGHT} of a player's settlers fetch at once, and
 *    each settler is considered only on its {@link ASSISTANT_SCAN_PERIOD_TICKS} stride beat, so the
 *    hand-out paces itself to errand completion instead of dispatching a whole village on one tick.
 *
 * Only empty slots are filled (no swaps/upgrades), and a misc grant is one unit per settler. The
 * original's extras window ships per-good hoard commands (decoded `miscwindow` 503-509 "Zgromadź
 * Buty!" etc.) but their engine behavior is unreadable; this hand-out is a project reconstruction
 * from the feature spec (named approximation).
 */

/** One settler's grant consideration beat, staggered by entity id (the field-reclaim idiom), so the
 *  per-tick scan cost is `settlers / period` and a freshly-freed slot is re-dressed within seconds.
 *  Our pacing (nothing decodable to match). */
const ASSISTANT_SCAN_PERIOD_TICKS = 2 * TICKS_PER_SECOND;

/** The per-player cap on concurrent assistant fetch errands - the incremental-rollout brake. Small
 *  enough that switching a grant on in a living settlement reads as a steady trickle, large enough
 *  that the queue drains across a few storehouses at once. Our balance. */
export const ASSISTANT_MAX_IN_FLIGHT = 4;

/** One granted good, its slot group pre-resolved from content. */
interface GrantSpec {
  readonly goodType: number;
  readonly category: EquipCategory;
}

/** A player's fetch errands underway: `acquire`-stage {@link EquipOrder}s with a wanted good, total
 *  and per good - manual orders included, so the assistant also respects a unit the player already
 *  sent someone after. */
interface FetchTally {
  total: number;
  readonly byGood: Map<number, number>;
}

export function dispatchAssistantGrants(pass: PlannerPass): void {
  const { world, ctx, terrain, targets } = pass;
  const grants = collectGrantSpecs(pass);
  if (grants.size === 0) return; // no player granted anything: the pass costs one empty query
  const inFlight = collectInFlightFetches(world);
  const stockCache = new Map<number, Map<number, number>>();

  for (const e of pass.settlers) {
    if ((e + ctx.tick) % ASSISTANT_SCAN_PERIOD_TICKS !== 0) continue;
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;
    const wanted = grants.get(owner);
    if (wanted === undefined) continue;
    const tally = tallyFor(inFlight, owner);
    if (tally.total >= ASSISTANT_MAX_IN_FLIGHT) continue;
    if (world.has(e, EquipOrder) || world.has(e, Age) || anotherSystemOwns(world, e)) continue;
    if (world.get(e, Settler).jobType === null) continue; // the ladder never plans a jobless settler
    // A loaded hauler finishes its delivery first: the equip rung outranks the economy and would
    // dump the carried load where the settler stands (a manual order may do that - the assistant
    // has no such urgency). A later beat catches the settler with free hands.
    if (world.has(e, Carrying) || world.has(e, SupplyRun)) continue;

    const eq = world.tryGet(e, Equipment);
    // The settler's confinement/veto are computed once, and only when a grant actually has a free
    // slot and spare stock - a fully dressed settler's beat stays a few map reads.
    let limit: NavigationLimit | null | undefined;
    for (const spec of wanted) {
      const slot = freeSlotFor(eq, spec);
      if (slot === null) continue;
      const underway = tally.byGood.get(spec.goodType) ?? 0;
      if (underway >= availableStock(pass, stockCache, owner, spec.goodType)) continue;
      if (limit === undefined) limit = navigationLimitFor(world, terrain, e);
      const p = world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      const here = terrain.nodeAtClamped(n.hx, n.hy);
      const src = nearestStoreHolding(
        targets.stockpileCells,
        world,
        ctx,
        terrain,
        here,
        spec.goodType,
        owner,
        limit ?? undefined,
        unreachableGoalVeto(world, ctx, e),
      );
      if (src === null) continue; // nothing reachable through this settler's signpost network
      world.add(e, EquipOrder, {
        group: spec.category,
        slot,
        goodType: spec.goodType,
        returnTo: here,
        stage: 'acquire',
      });
      tally.total += 1;
      tally.byGood.set(spec.goodType, underway + 1);
      break; // one errand per settler; the next beat considers the rest of its slots
    }
  }
}

/** Each granting player's specs, strongest gear first (iron tools over wooden - the content bonus
 *  decides, never a good id), ascending good id as the tie-break. A granted id whose content lost
 *  its `equip` class is dropped here (stale save data is recoverable input). */
function collectGrantSpecs(pass: PlannerPass): Map<number, readonly GrantSpec[]> {
  const { world, ctx } = pass;
  const byPlayer = new Map<number, readonly GrantSpec[]>();
  const goods = contentIndex(ctx.content).goods;
  for (const e of canonicalById(world.query(AssistantGrants))) {
    const { player, goods: granted } = world.get(e, AssistantGrants);
    if (byPlayer.has(player)) continue; // lowest-id carrier wins (the rules-singleton convention)
    const specs: (GrantSpec & { strength: number })[] = [];
    for (const goodType of granted) {
      const equip = goods.get(goodType)?.equip;
      if (equip === undefined) continue;
      specs.push({
        goodType,
        category: equip.category,
        strength: Math.max(equip.speedBonusPct ?? 0, equip.productionBonusPct ?? 0),
      });
    }
    specs.sort((a, b) => b.strength - a.strength || a.goodType - b.goodType);
    byPlayer.set(
      player,
      specs.map(({ goodType, category }) => ({ goodType, category })),
    );
  }
  return byPlayer;
}

function collectInFlightFetches(world: World): Map<number, FetchTally> {
  const byPlayer = new Map<number, FetchTally>();
  for (const e of world.query(EquipOrder)) {
    const order = world.get(e, EquipOrder);
    if (order.stage !== 'acquire' || order.goodType === null) continue;
    // A jobless settler's errand is frozen (the ladder never plans one - e.g. its workplace was
    // demolished mid-fetch): it must not hold a reservation or a cap slot while it cannot advance.
    const settler = world.tryGet(e, Settler);
    if (settler === undefined || settler.jobType === null) continue;
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;
    const tally = tallyFor(byPlayer, owner);
    tally.total += 1;
    tally.byGood.set(order.goodType, (tally.byGood.get(order.goodType) ?? 0) + 1);
  }
  return byPlayer;
}

function tallyFor(byPlayer: Map<number, FetchTally>, player: number): FetchTally {
  let tally = byPlayer.get(player);
  if (tally === undefined) {
    tally = { total: 0, byGood: new Map() };
    byPlayer.set(player, tally);
  }
  return tally;
}

/**
 * The slot a grant of `spec` would fill, or null when the settler is already covered: a named group
 * takes slot 0 when empty; a misc grant takes the first empty row unless some row already holds the
 * same good ("give everyone mead" is one bottle each, not four). Empty slots only - a worn item is
 * never swapped out by the assistant.
 */
function freeSlotFor(eq: EquipmentData | undefined, spec: GrantSpec): number | null {
  if (spec.category !== 'misc') {
    return eq === undefined || equipSlotValue(eq, spec.category, 0) === null ? 0 : null;
  }
  if (eq === undefined) return 0;
  if (eq.misc.some((s) => s?.goodType === spec.goodType)) return null;
  const free = eq.misc.indexOf(null);
  return free === -1 ? null : free;
}

/**
 * The player's total store/pile stock of `goodType` (sites excluded - a site is a sink, never a
 * source), cached per tick. The reservation bound, not a reachability promise: it counts stock in
 * other signpost networks and buried piles too (approximation), so it can run loose by a few
 * unreachable units - the per-settler {@link nearestStoreHolding} scan still gates every dispatch.
 */
function availableStock(
  pass: PlannerPass,
  cache: Map<number, Map<number, number>>,
  player: number,
  goodType: number,
): number {
  let byGood = cache.get(player);
  if (byGood === undefined) {
    byGood = new Map();
    cache.set(player, byGood);
  }
  const cached = byGood.get(goodType);
  if (cached !== undefined) return cached;
  const { world, targets } = pass;
  let sum = 0;
  for (const store of targets.stockpiles) {
    if (world.has(store, UnderConstruction)) continue;
    if (!ownersCompatible(player, ownerOf(world, store))) continue;
    sum += world.get(store, Stockpile).amounts.get(goodType) ?? 0;
  }
  byGood.set(goodType, sum);
  return sum;
}
