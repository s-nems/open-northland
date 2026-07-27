import type { ContentSet, EquipCategory } from '@open-northland/data';
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
  Stance,
  Stockpile,
  SupplyRun,
  UnderConstruction,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { CIVILIST_JOB, WOMAN_JOB } from '../../lifecycle/ageclass.js';
import { isFighterJob, isScoutJob, MILITARY_MODE } from '../../readviews/index.js';
import { type NavigationLimit, navigationLimitFor } from '../../signposts/index.js';
import { canonicalById } from '../../spatial/nodes.js';
import { nearestStoreHolding } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import type { PlannerPass } from './pass.js';
import { anotherSystemOwns } from './replan.js';

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
 * Buty!" etc.); the manual describes the intent ("you want to have shoes given out to all civilians -
 * if there are shoes available in your village"), which the stock reservation matches, but not the
 * engine's pacing, so the trickle and the caps are ours (named approximation). Deviation from that
 * line: only the TOOL grant is trade-scoped ({@link toolHelpsJob}); boots and misc go to fighters too,
 * because nothing about a soldier makes a pair of shoes useless.
 */

/** One settler's grant consideration beat, staggered by entity id (the field-reclaim idiom), so the
 *  per-tick scan cost is `settlers / period` and a freshly-freed slot is re-dressed within seconds.
 *  Our pacing (nothing decodable to match). */
const ASSISTANT_SCAN_PERIOD_TICKS = 2 * TICKS_PER_SECOND;

/** The per-player cap on concurrent assistant fetch errands - the incremental-rollout brake. Small
 *  enough that switching a grant on in a living settlement reads as a steady trickle, large enough
 *  that the queue drains across a few storehouses at once. Our balance. */
export const ASSISTANT_MAX_IN_FLIGHT = 4;

/**
 * Whether the assistant hands `jobType` a tool at all: every working trade takes one (gatherer, porter,
 * farmer, baker...), but a fighter keeps none (`shedToolOnEnlist`, orders/work/employment.ts), and the
 * scout, the civilist and the woman are passed over so scarce tools go to the trades that work with
 * them (user rule 2026-07-26). The civilist ({@link CIVILIST_JOB}) is the trade-less settler the "Cywil"
 * row seats and a grown boy defaults to; the woman ({@link WOMAN_JOB}) keeps the household larder rather
 * than a trade, and neither ever operates a workplace, so a tool would only idle in the slot. Only the
 * assistant's hand-out is bound by this - the player may still equip a scout by hand.
 */
function toolHelpsJob(content: ContentSet, jobType: number): boolean {
  return (
    !isFighterJob(content, jobType) &&
    !isScoutJob(content, jobType) &&
    jobType !== CIVILIST_JOB &&
    jobType !== WOMAN_JOB
  );
}

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
  let stock: GrantedStock | undefined; // one store walk for every player and good, built on first need

  for (const e of pass.settlers) {
    if ((e + ctx.tick) % ASSISTANT_SCAN_PERIOD_TICKS !== 0) continue;
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;
    const wanted = grants.get(owner);
    if (wanted === undefined) continue;
    const tally = tallyFor(inFlight, owner);
    if (tally.total >= ASSISTANT_MAX_IN_FLIGHT) continue;
    if (world.has(e, EquipOrder) || world.has(e, Age) || anotherSystemOwns(world, e)) continue;
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null) continue; // the ladder never plans a jobless settler
    // A loaded hauler finishes its delivery first: the equip rung outranks the economy and would
    // dump the carried load where the settler stands (a manual order may do that - the assistant
    // has no such urgency). A later beat catches the settler with free hands; a load picked up after
    // the dispatch is covered too, because the errand itself yields to it (settlers/drives/equip-order.ts).
    if (world.has(e, Carrying) || world.has(e, SupplyRun)) continue;
    // A guard holds its post: the equip rung outranks the DEFEND hold so the PLAYER can send a guard
    // for gear, which is no reason for the assistant to walk one off its anchor unasked.
    if (world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND) continue;
    const toolless = !toolHelpsJob(ctx.content, jobType);

    const eq = world.tryGet(e, Equipment);
    // The settler's confinement/veto are computed once, and only when a grant actually has a free
    // slot and spare stock - a fully dressed settler's beat stays a few map reads.
    let limit: NavigationLimit | null | undefined;
    for (const spec of wanted) {
      if (toolless && spec.category === 'tool') continue; // its boots and misc grants still apply
      const slot = freeSlotFor(eq, spec);
      if (slot === null) continue;
      const underway = tally.byGood.get(spec.goodType) ?? 0;
      stock ??= collectGrantedStock(pass, grants);
      if (underway >= (stock.get(owner)?.get(spec.goodType) ?? 0)) continue;
      if (limit === undefined) limit = navigationLimitFor(world, ctx.content, terrain, e);
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
        issuer: 'assistant',
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

/** Every granting player's total stock of each good it grants: `player -> goodType -> units`. */
type GrantedStock = ReadonlyMap<number, ReadonlyMap<number, number>>;

/**
 * Total store/pile stock of every granted good, per granting player (sites excluded - a site is a
 * sink, never a source), in ONE walk of the candidate stores rather than one per player and good:
 * the owner test is the expensive part and it resolves once per store. An unowned pile counts for
 * every player ({@link ownersCompatible}), as it did per-player before.
 *
 * The reservation bound, not a reachability promise: it counts stock in other signpost networks and
 * buried piles too (approximation), so it can run loose by a few unreachable units - the per-settler
 * {@link nearestStoreHolding} scan still gates every dispatch.
 */
function collectGrantedStock(
  pass: PlannerPass,
  grants: ReadonlyMap<number, readonly GrantSpec[]>,
): GrantedStock {
  const { world, targets } = pass;
  const byPlayer = new Map<number, Map<number, number>>();
  for (const [player, specs] of grants) {
    byPlayer.set(player, new Map(specs.map((spec) => [spec.goodType, 0])));
  }
  for (const store of targets.stockpiles) {
    if (world.has(store, UnderConstruction)) continue;
    const owner = ownerOf(world, store);
    const amounts = world.get(store, Stockpile).amounts;
    for (const [player, totals] of byPlayer) {
      if (!ownersCompatible(player, owner)) continue;
      for (const [goodType, held] of totals) {
        const units = amounts.get(goodType);
        if (units !== undefined) totals.set(goodType, held + units);
      }
    }
  }
  return byPlayer;
}
