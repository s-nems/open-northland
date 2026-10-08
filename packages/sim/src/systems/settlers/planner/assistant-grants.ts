import type { ContentSet, EquipCategory, EquipClass } from '@open-northland/data';
import {
  type AssistantAudienceKind,
  AssistantGrants,
  assistantAudienceKindOf,
  assistantSoldierOnlyKinds,
  Equipment,
  type EquipmentData,
  EquipOrder,
  equipSlotValue,
  ownerOf,
  PickupClaim,
  Position,
  Settler,
  Stance,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { standsAtPost } from '../../conflict/tower-post.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import { isFighterJob, isScoutJob, MILITARY_MODE, mayChangeEquipment } from '../../readviews/index.js';
import { equipFetchLimitFor, type NavigationLimit } from '../../signposts/index.js';
import { anotherSystemOwns } from '../action-owner.js';
import { equipFetchesUnderway } from '../drives/equip-fetches.js';
import { FetchableStock, nearestStoreHolding } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { wakeIdle } from './idle-replan.js';
import type { PlannerPass } from './pass.js';

// The assistant's auto-equip pass sends settlers with a matching free slot to fetch a player's granted
// goods. The manual states the intent ("you want to have shoes given out to all civilians - if there are
// shoes available in your village"), which the dispatch matches against the player's store stock, and the
// extras window ships per-good hoard commands (decoded `miscwindow` 503-509). Approximation: the pacing
// is unknown; the only brake is the stock, so every unit in store has at most one fetcher after it.

/** One settler's grant consideration beat, staggered by entity id, so the per-tick scan costs
 *  `settlers / period` and a freshly-freed slot is re-dressed within seconds. Approximation, shared
 *  with the recruit-arming pass. */
export const ASSISTANT_SCAN_PERIOD_TICKS = 2 * TICKS_PER_SECOND;

/**
 * Whether the assistant hands `jobType` a tool. Authored: a working trade takes one, a fighter sheds it
 * on enlisting, and the scout and the civilist are passed over so scarce tools go to the trades that
 * work with them, a civilist never operating a workplace. It binds only the assistant; the player may
 * still equip a scout by hand.
 */
function toolHelpsJob(content: ContentSet, jobType: number): boolean {
  return !isFighterJob(content, jobType) && !isScoutJob(content, jobType) && jobType !== CIVILIST_JOB;
}

/** One granted good, its slot group pre-resolved from content. */
export interface GrantSpec {
  readonly goodType: number;
  readonly category: EquipCategory;
  /** The misc goods whose presence in a row already satisfies the grant besides the good itself: the
   *  drinks of the same effect, so a man with a small healing potion is not sent for the big one. */
  readonly equivalents?: ReadonlySet<number>;
}

/** A granted good with its audience kind, so the pass can pass a civilian over a soldiers-only kind. */
interface PlayerGrant extends GrantSpec {
  readonly audience: AssistantAudienceKind | null;
}

export function dispatchAssistantGrants(pass: PlannerPass): void {
  const { world, ctx, terrain, targets } = pass;
  const grants = collectGrantSpecs(pass);
  if (grants.size === 0) return; // no player granted anything: the pass costs one empty query
  // Manual orders are included, so the assistant also respects a unit the player already sent someone after.
  const inFlight = equipFetchesUnderway(world);
  const stock = FetchableStock.of(world, ctx);
  // Each granting player's soldiers-only kinds, read once per pass rather than per settler.
  const limits = new Map<number, readonly AssistantAudienceKind[]>();
  const soldiersOnlyOf = (player: number): readonly AssistantAudienceKind[] => {
    let kinds = limits.get(player);
    if (kinds === undefined) {
      kinds = assistantSoldierOnlyKinds(world, player);
      limits.set(player, kinds);
    }
    return kinds;
  };

  for (const e of dueThisBeat(world, ctx.tick)) {
    if (!world.has(e, Position)) continue; // the pass plans positioned settlers only
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;
    const wanted = grants.get(owner);
    if (wanted === undefined) continue;
    if (world.has(e, EquipOrder) || anotherSystemOwns(world, e)) continue;
    if (!mayChangeEquipment(world, ctx.content, e)) continue; // a woman, a child and a hero take no gear
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null) continue; // the ladder never plans a jobless settler
    const fighter = isFighterJob(ctx.content, jobType);
    // A settler on the way to a pickup keeps the unit it claimed. A loaded one is dispatched: the equip
    // rung yields to its delivery and sends it for the gear once its hands are free, which is the only
    // moment a busy porter is ever idle.
    if (world.has(e, PickupClaim)) continue;
    // A DEFEND guard stays on its anchor: the player may send one for gear, but this pass does not walk
    // one off unasked.
    if (world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND) continue;
    // Nor does it call a garrison down from his tower: the wall stays manned unless the player asks.
    if (standsAtPost(world, e) !== null) continue;
    const toolless = !toolHelpsJob(ctx.content, jobType);
    const soldiersOnly = fighter ? NO_LIMITS : soldiersOnlyOf(owner);

    let tally = inFlight.get(owner);
    if (tally === undefined) {
      tally = new Map();
      inFlight.set(owner, tally);
    }
    const eq = world.tryGet(e, Equipment);
    // Resolved once, and only when a grant has both a free slot and spare stock.
    let limit: NavigationLimit | null | undefined;
    for (const spec of wanted) {
      if (toolless && spec.category === 'tool') continue; // its boots and misc grants still apply
      if (spec.audience !== null && soldiersOnly.includes(spec.audience)) continue;
      const slot = freeSlotFor(eq, spec);
      if (slot === null) continue;
      const underway = tally.get(spec.goodType) ?? 0;
      if (!stock.exceeds(owner, spec.goodType, underway)) continue;
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
        pass.supply,
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
      wakeIdle(world, e); // planned onto the errand this pass
      tally.set(spec.goodType, underway + 1);
      break; // one errand per settler; the next beat considers the rest of its slots
    }
  }
}

/** Each granting player's specs, strongest first: by content production bonus, then by rated uses (the
 *  big potion before the small one), then ascending good id (boots carry neither and sort by id). A
 *  granted id whose content lost its `equip` class is dropped. */
function collectGrantSpecs(pass: PlannerPass): ReadonlyMap<number, readonly PlayerGrant[]> {
  const { world, ctx } = pass;
  const membership = world.componentGeneration(AssistantGrants);
  const values = world.componentValueGeneration(AssistantGrants);
  const held = grantSpecMemo.get(world);
  if (
    held !== undefined &&
    held.content === ctx.content &&
    held.membership === membership &&
    held.values === values
  ) {
    return held.byPlayer;
  }
  const byPlayer = new Map<number, readonly PlayerGrant[]>();
  const goods = contentIndex(ctx.content).goods;
  for (const e of world.canonicalQuery(AssistantGrants)) {
    const { player, goods: granted } = world.get(e, AssistantGrants);
    if (byPlayer.has(player)) continue; // lowest-id carrier wins (the rules-singleton convention)
    const specs: (PlayerGrant & { readonly bonus: number; readonly uses: number })[] = [];
    for (const goodType of granted) {
      const equip = goods.get(goodType)?.equip;
      if (equip === undefined) continue;
      const equivalents = drinkEquivalents(ctx.content, goodType, equip);
      specs.push({
        goodType,
        category: equip.category,
        audience: assistantAudienceKindOf(equip),
        ...(equivalents === null ? {} : { equivalents }),
        bonus: equip.productionBonusPct ?? 0,
        uses: equip.uses ?? 0,
      });
    }
    specs.sort((a, b) => b.bonus - a.bonus || b.uses - a.uses || a.goodType - b.goodType);
    byPlayer.set(
      player,
      specs.map(({ bonus: _bonus, uses: _uses, ...spec }) => spec),
    );
  }
  grantSpecMemo.set(world, { content: ctx.content, membership, values, byPlayer });
  return byPlayer;
}

/** The grant specs of the AssistantGrants generations they were read at, per world. */
const grantSpecMemo = new WeakMap<
  World,
  {
    readonly content: ContentSet;
    readonly membership: number;
    readonly values: number;
    readonly byPlayer: ReadonlyMap<number, readonly PlayerGrant[]>;
  }
>();

/** The effect a drink restores, as the sorted keys of its `restorePct`, or null for any other wearable. */
function drinkEffect(equip: EquipClass): string | null {
  if (assistantAudienceKindOf(equip) !== 'drink' || equip.restorePct === undefined) return null;
  return Object.keys(equip.restorePct).sort().join('+');
}

/** The other drinks of `equip`'s effect in the content (the small and big potion of one kind), or null
 *  when `equip` is no drink or none shares its effect. */
function drinkEquivalents(
  content: ContentSet,
  goodType: number,
  equip: EquipClass,
): ReadonlySet<number> | null {
  const effect = drinkEffect(equip);
  if (effect === null) return null;
  const same = new Set<number>();
  for (const good of content.goods) {
    if (good.typeId === goodType || good.equip === undefined) continue;
    if (drinkEffect(good.equip) === effect) same.add(good.typeId);
  }
  return same.size === 0 ? null : same;
}

/**
 * The slot a grant of `spec` would fill, or null when the settler is already covered: a named group
 * takes slot 0 when empty, a misc grant the first empty row unless some row already holds the same
 * good or one of its equivalents, so a mead grant is one bottle each. Empty slots only, since the
 * assistant never swaps gear out.
 */
export function freeSlotFor(eq: EquipmentData | undefined, spec: GrantSpec): number | null {
  if (spec.category !== 'misc') {
    return eq === undefined || equipSlotValue(eq, spec.category, 0) === null ? 0 : null;
  }
  if (eq === undefined) return 0;
  const satisfies = (held: number): boolean => held === spec.goodType || spec.equivalents?.has(held) === true;
  if (eq.misc.some((s) => s !== null && satisfies(s.goodType))) return null;
  const free = eq.misc.indexOf(null);
  return free === -1 ? null : free;
}

const NO_SETTLERS: readonly Entity[] = [];
const NO_LIMITS: readonly AssistantAudienceKind[] = [];

/** The settlers bucketed by scan beat, for each settler roster a world has served: rebuilt only when a
 *  settler is born or dies, so a tick visits its own beat's slice instead of the whole roster. */
const beatsByRoster = new WeakMap<readonly Entity[], readonly (readonly Entity[])[]>();

/** The settlers, ascending-id, whose grant beat falls on `tick`: those with `(e + tick) % period === 0`. */
function dueThisBeat(world: World, tick: number): readonly Entity[] {
  const roster = world.canonicalQuery(Settler);
  let beats = beatsByRoster.get(roster);
  if (beats === undefined) {
    const built: Entity[][] = Array.from({ length: ASSISTANT_SCAN_PERIOD_TICKS }, () => []);
    for (const e of roster) built[e % ASSISTANT_SCAN_PERIOD_TICKS]?.push(e);
    beats = built;
    beatsByRoster.set(roster, beats);
  }
  const beat =
    (ASSISTANT_SCAN_PERIOD_TICKS - (tick % ASSISTANT_SCAN_PERIOD_TICKS)) % ASSISTANT_SCAN_PERIOD_TICKS;
  return beats[beat] ?? NO_SETTLERS;
}
