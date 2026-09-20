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
  SupplyRun,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { CIVILIST_JOB, WOMAN_JOB } from '../../lifecycle/ageclass.js';
import { isFighterJob, isScoutJob, MILITARY_MODE } from '../../readviews/index.js';
import { equipFetchLimitFor, type NavigationLimit } from '../../signposts/index.js';
import { canonicalById } from '../../spatial/nodes.js';
import { accessibleStockAmounts, mergedRecipeOf, recipeConsumes } from '../../stores/index.js';
import { nearestStoreHolding } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import type { PlannerPass } from './pass.js';
import { anotherSystemOwns } from './replan.js';

// The assistant's auto-equip pass sends settlers with a matching free slot to fetch a player's granted
// goods. The manual states the intent ("you want to have shoes given out to all civilians - if there are
// shoes available in your village"), which the dispatch matches against the player's store stock, and the
// extras window ships per-good hoard commands (decoded `miscwindow` 503-509). Approximation: the pacing
// and the caps are not decoded.

/** One settler's grant consideration beat, staggered by entity id, so the per-tick scan costs
 *  `settlers / period` and a freshly-freed slot is re-dressed within seconds. Approximation, shared
 *  with the recruit-arming pass. */
export const ASSISTANT_SCAN_PERIOD_TICKS = 2 * TICKS_PER_SECOND;

/** Per-player cap on concurrent assistant fetch errands, small enough that switching a grant on reads
 *  as a steady trickle and large enough to drain across a few storehouses at once. Approximation. */
export const ASSISTANT_MAX_IN_FLIGHT = 4;

/**
 * Whether the assistant hands `jobType` a tool. Authored: a working trade takes one, a fighter sheds it
 * on enlisting, and the scout, the civilist and the woman are passed over so scarce tools go to the
 * trades that work with them, neither of the latter two ever operating a workplace. It binds only the
 * assistant; the player may still equip a scout by hand.
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

/** A player's fetch errands underway, total and per good. Manual orders are included, so the assistant
 *  also respects a unit the player already sent someone after. */
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
    // A loaded hauler finishes its delivery first: the equip rung outranks the economy and would dump
    // the carried load where the settler stands, which only a manual order is urgent enough to do.
    if (world.has(e, Carrying) || world.has(e, SupplyRun)) continue;
    // A DEFEND guard stays on its anchor: the player may send one for gear, but this pass does not walk
    // one off unasked.
    if (world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND) continue;
    const toolless = !toolHelpsJob(ctx.content, jobType);

    const eq = world.tryGet(e, Equipment);
    // Resolved once, and only when a grant has both a free slot and spare stock.
    let limit: NavigationLimit | null | undefined;
    for (const spec of wanted) {
      if (toolless && spec.category === 'tool') continue; // its boots and misc grants still apply
      const slot = freeSlotFor(eq, spec);
      if (slot === null) continue;
      const underway = tally.byGood.get(spec.goodType) ?? 0;
      stock ??= collectGrantedStock(pass, grants);
      if (underway >= (stock.get(owner)?.get(spec.goodType) ?? 0)) continue;
      if (limit === undefined) limit = equipFetchLimitFor(world, ctx.content, terrain, e);
      const p = world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      const here = terrain.nodeAtClamped(n.hx, n.hy);
      const src = nearestStoreHolding(
        targets.bands,
        world,
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
        issuer: 'assistant-grant',
        queued: [],
      });
      tally.total += 1;
      tally.byGood.set(spec.goodType, underway + 1);
      break; // one errand per settler; the next beat considers the rest of its slots
    }
  }
}

/** Each granting player's specs, strongest gear first by content production bonus rather than good id,
 *  with ascending good id as the tie-break (boots carry no rated bonus and sort by id). A granted id
 *  whose content lost its `equip` class is dropped. */
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
        strength: equip.productionBonusPct ?? 0,
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
    // A jobless settler's errand is frozen, since the ladder never plans one, so it must not hold a
    // reservation or a cap slot while it cannot advance.
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
 * takes slot 0 when empty, a misc grant the first empty row unless some row already holds the same
 * good, so a mead grant is one bottle each. Empty slots only, since the assistant never swaps gear out.
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

interface GoodTotal {
  readonly goodType: number;
  units: number;
}

/** One granting player's row of the result and the per-good totals the store walk accumulates into.
 *  Array-shaped, so that walk allocates no Map entry pair per step. */
interface PlayerStock {
  readonly player: number;
  readonly totals: Map<number, number>;
  readonly goods: readonly GoodTotal[];
}

/**
 * Total store and pile stock of every granted good, per granting player, in one walk of the candidate
 * stores. A from-scratch construction site and a workshop's own input reserve are excluded, matching
 * {@link nearestStoreHolding}; an unowned pile counts for every player.
 *
 * This bounds the reservation, it does not promise reachability: stock in other signpost networks and
 * buried piles is counted too (approximation), and the per-settler scan still gates every dispatch.
 */
function collectGrantedStock(
  pass: PlannerPass,
  grants: ReadonlyMap<number, readonly GrantSpec[]>,
): GrantedStock {
  const { world, ctx, targets } = pass;
  const byPlayer = new Map<number, Map<number, number>>();
  const rows: PlayerStock[] = [];
  for (const [player, specs] of grants) {
    const totals = new Map<number, number>();
    byPlayer.set(player, totals);
    rows.push({ player, totals, goods: specs.map(({ goodType }) => ({ goodType, units: 0 })) });
  }
  for (const store of targets.stockpiles) {
    const amounts = accessibleStockAmounts(world, store);
    if (amounts === undefined) continue;
    const owner = ownerOf(world, store);
    // The reserve rule is keyed by store and cannot vary by player, so it is hoisted out of the
    // stores × players × goods walk below.
    const reserved = mergedRecipeOf(world, ctx, store)?.inputs;
    for (const row of rows) {
      if (!ownersCompatible(row.player, owner)) continue;
      for (const good of row.goods) {
        const units = amounts.get(good.goodType);
        if (units === undefined || recipeConsumes(reserved, good.goodType)) continue;
        good.units += units;
      }
    }
  }
  for (const row of rows) {
    for (const good of row.goods) row.totals.set(good.goodType, good.units);
  }
  return byPlayer;
}
