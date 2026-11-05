import type { ContentSet, EquipCategory, EquipClass } from '@open-northland/data';
import {
  AssistantGrants,
  AssistantRecruit,
  assistantCivilianOnlyGoods,
  assistantSoldierOnlyGoods,
  assistantUpgradesTools,
  Carrying,
  Equipment,
  type EquipmentData,
  type EquipmentSlot,
  EquipOrder,
  equipSlotValue,
  ownerOf,
  PickupClaim,
  Position,
  Settler,
  SiteAssignment,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { SpatialGate } from '../../../nav/node-circle.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { holdsSiteClaim, isSoloSite } from '../../economy/site-claim.js';
import { isWornAtMost } from '../../equipment/index.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import { isFighterJob, isScoutJob, mayChangeEquipment } from '../../readviews/index.js';
import { equipFetchLimitFor } from '../../signposts/index.js';
import { anotherSystemOwns } from '../action-owner.js';
import { equipFetchesHeld } from '../drives/equip-fetches.js';
import { FetchableStock, nearestStoreHoldingWithin } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { wakeIdle } from './idle-replan.js';
import type { PlannerPass } from './pass.js';

// The assistant's auto-equip pass sends settlers with a matching free slot to fetch a player's granted
// goods. The manual states the intent ("you want to have shoes given out to all civilians - if there are
// shoes available in your village"), which the dispatch matches against the player's store stock, and the
// extras window ships per-good hoard commands (decoded `miscwindow` 503-509). Original behavior: each of
// the original's grant switches (shoes, wooden tools, iron tools and mead for civilians; shoes and mead for
// soldiers) sends at most six random takers every thirty seconds, whatever their stance, and passes over a
// man it sent for that good in the last three minutes. Potions and amulets are this project's additions.
// Departure: this pass visits every settler on a short stride and brakes on the stock alone, so every unit
// in store has at most one fetcher after it and a village is dressed in one round of errands.
// Project addition: with the player's upgrade switch on, a worker whose tool is weaker than a granted one
// swaps it at the store, the take-off rule destroying a part-used tool and stowing a fresh one.

/** One settler's grant consideration beat, staggered by entity id, so the per-tick scan costs
 *  `settlers / period` and a freshly-freed slot is re-dressed within seconds. Approximation, shared
 *  with the recruit-arming pass. */
export const ASSISTANT_SCAN_PERIOD_TICKS = 2 * TICKS_PER_SECOND;

/** A tool upgrade is weighed on every Nth beat visit only, so a worker with an empty slot, weighed on each,
 *  usually takes a new unit first, and a tool past half its uses before a fresher one. Approximation: a
 *  head start, not a guarantee. */
const UPGRADE_VISIT_STRIDE_WORN = 2;
const UPGRADE_VISIT_STRIDE_FRESH = 5;
/** "Worn" for the stride: more than `1/divisor` of the tool's rated uses spent. */
const UPGRADE_WORN_DIVISOR = 2;

/**
 * Whether the assistant hands `jobType` a tool. Authored: a working trade takes one, a fighter sheds it
 * on enlisting, and the scout and the civilist are passed over so scarce tools go to the trades that
 * work with them, a civilist never operating a workplace. It binds only the assistant; the player may
 * still equip a scout by hand.
 */
export function toolHelpsJob(content: ContentSet, jobType: number): boolean {
  return !isFighterJob(content, jobType) && !isScoutJob(content, jobType) && jobType !== CIVILIST_JOB;
}

/** One granted good, its slot group pre-resolved from content. */
interface GrantSpec {
  readonly goodType: number;
  readonly category: EquipCategory;
  /** The tool rank ({@link toolRankOf}) a held tool must stay below to be upgraded to this good. */
  readonly toolRank: number;
  /** The misc goods whose presence in a row already satisfies the grant besides the good itself: the
   *  drinks of the same effect, so a man with a small healing potion is not sent for the big one. */
  readonly equivalents?: ReadonlySet<number>;
}

export function dispatchAssistantGrants(pass: PlannerPass): void {
  const { world, ctx, targets } = pass;
  const grants = collectGrantSpecs(world, ctx);
  if (grants.size === 0) return; // no player granted anything: the pass costs one empty query
  // Manual orders are included, so the assistant also respects a unit the player already sent someone after.
  // Read at the first settler that passes the gates, before this pass stamps any errand, and not read again
  // while it stamps them: the errands stamped here are counted apart.
  let underwayAtStart: ReadonlyMap<number, ReadonlyMap<number, number>> | undefined;
  const stampedHere = new PlayerGoodCounts();
  const stock = FetchableStock.of(world, ctx);
  // Each granting player's goods kept from civilians (the soldiers-only ones) and from fighters (the
  // civilians-only ones), read once per pass rather than per settler.
  const keptFromCivilians = new Map<number, readonly number[]>();
  const keptFromFighters = new Map<number, readonly number[]>();
  const upgrades = new Map<number, boolean>();
  const upgradesOf = (player: number): boolean => {
    let on = upgrades.get(player);
    if (on === undefined) {
      on = assistantUpgradesTools(world, player);
      upgrades.set(player, on);
    }
    return on;
  };
  const keptFrom = (player: number, fighter: boolean): readonly number[] => {
    const held = fighter ? keptFromFighters : keptFromCivilians;
    let goods = held.get(player);
    if (goods === undefined) {
      goods = fighter ? assistantCivilianOnlyGoods(world, player) : assistantSoldierOnlyGoods(world, player);
      held.set(player, goods);
    }
    return goods;
  };

  for (const e of dueThisBeat(world, ctx.tick)) {
    if (!world.has(e, Position)) continue; // the pass plans positioned settlers only
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;
    const wanted = grants.get(owner);
    if (wanted === undefined) continue;
    if (world.has(e, EquipOrder) || anotherSystemOwns(world, e)) continue;
    // A booked recruit still owed his weapon waits for the arming pass: a grant errand first would hold
    // the equip order his weapon fetch needs, and he would fight bare-handed while out for mead.
    if (awaitsRecruitWeapon(world, e)) continue;
    if (!mayChangeEquipment(world, ctx.content, e)) continue; // a woman, a child and a hero take no gear
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null) continue; // the ladder never plans a jobless settler
    const fighter = isFighterJob(ctx.content, jobType);
    // A settler on the way to a pickup keeps the unit it claimed. A loaded one is dispatched: the equip
    // rung yields to its delivery and sends it for the gear once its hands are free, which is the only
    // moment a busy porter is ever idle.
    if (world.has(e, PickupClaim)) continue;
    // A builder holding a road or wall site lands its one strike first: the claim keeps every other
    // builder off that site while he is away.
    if (holdsSoloSite(world, e)) continue;
    // Nor does it take a tower's garrison off the wall, up there or on his way back: the wall stays manned
    // unless the player sends him. Owner's ruling.
    if (towerPostFor(world, ctx, e, jobType) !== null) continue;
    const toolless = !toolHelpsJob(ctx.content, jobType);
    const kept = keptFrom(owner, fighter);

    underwayAtStart ??= equipFetchesHeld(world);
    const heldAtStart = underwayAtStart.get(owner);
    const eq = world.tryGet(e, Equipment);
    const upgrade = upgradesOf(owner) && upgradeDue(ctx.content, e, ctx.tick, eq);
    // Resolved once, and only when a grant has both a free slot and spare stock.
    let route: GrantRoute | undefined;
    for (const spec of wanted) {
      const slot = grantSlotFor(ctx.content, spec, eq, toolless, kept, upgrade);
      if (slot === null) continue;
      const underway = (heldAtStart?.get(spec.goodType) ?? 0) + stampedHere.of(owner, spec.goodType);
      if (!stock.exceeds(owner, spec.goodType, underway)) continue;
      route ??= grantRouteFor(pass, e, owner);
      const here = route.here;
      const src = nearestStoreHoldingWithin(
        targets.bands,
        world,
        here,
        spec.goodType,
        owner,
        pass.supply,
        route.gate,
        route.veto,
      );
      if (src === null) continue; // nothing reachable through this settler's signpost network
      world.add(e, EquipOrder, {
        group: spec.category,
        slot,
        goodType: spec.goodType,
        // A spot on a delivery walk is no place to come back to: the economy re-tasks him at the store.
        returnTo: (world.tryGet(e, Carrying)?.amount ?? 0) > 0 ? null : here,
        stage: 'acquire',
        issuer: 'assistant-grant',
        queued: [],
      });
      wakeIdle(world, e); // planned onto the errand this pass
      stampedHere.add(owner, spec.goodType);
      break; // one errand per settler; it chains the rest of its slots from the store
    }
  }
}

/** A settler's store-search inputs, read once per beat visit: the node he stands on, his signpost network
 *  met with the goods-search limit there, and the goals he cannot reach. */
interface GrantRoute {
  readonly here: NodeId;
  readonly gate: SpatialGate | undefined;
  readonly veto: ((cell: NodeId) => boolean) | undefined;
}

function grantRouteFor(pass: PlannerPass, e: Entity, owner: number): GrantRoute {
  const { world, ctx, terrain } = pass;
  const limit = equipFetchLimitFor(world, ctx.content, terrain, e);
  const p = world.get(e, Position);
  const here = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
  return {
    here,
    gate: pass.targets.bands.goodsGate(here, owner, limit ?? undefined),
    veto: unreachableGoalVeto(world, ctx, e),
  };
}

/** Whether `e` holds an arming booking ({@link AssistantRecruit}) whose weapon is not yet paid. */
function awaitsRecruitWeapon(world: World, e: Entity): boolean {
  const booking = world.tryGet(e, AssistantRecruit);
  return booking !== undefined && booking.intent !== 'trainSoldiers' && !booking.armed;
}

function holdsSoloSite(world: World, e: Entity): boolean {
  const site = world.tryGet(e, SiteAssignment)?.site;
  return site !== undefined && isSoloSite(world, site) && holdsSiteClaim(world, site, e);
}

/** Each granting player's specs, strongest first: by tool rank, then by rated uses (the
 *  big potion before the small one), then ascending good id (boots carry neither and sort by id). A
 *  granted id whose content lost its `equip` class is dropped. */
function collectGrantSpecs(world: World, ctx: SystemContext): ReadonlyMap<number, readonly GrantSpec[]> {
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
  const byPlayer = new Map<number, readonly GrantSpec[]>();
  const goods = contentIndex(ctx.content).goods;
  for (const e of world.canonicalQuery(AssistantGrants)) {
    const { player, goods: granted } = world.get(e, AssistantGrants);
    if (byPlayer.has(player)) continue; // lowest-id carrier wins (the rules-singleton convention)
    const specs: (GrantSpec & { readonly uses: number })[] = [];
    for (const goodType of granted) {
      const equip = goods.get(goodType)?.equip;
      if (equip === undefined) continue;
      const equivalents = drinkEquivalents(ctx.content, goodType, equip);
      specs.push({
        goodType,
        category: equip.category,
        ...(equivalents === null ? {} : { equivalents }),
        toolRank: toolRankOf(equip),
        uses: equip.uses ?? 0,
      });
    }
    specs.sort((a, b) => b.toolRank - a.toolRank || b.uses - a.uses || a.goodType - b.goodType);
    byPlayer.set(
      player,
      specs.map(({ uses: _uses, ...spec }) => spec),
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
    readonly byPlayer: ReadonlyMap<number, readonly GrantSpec[]>;
  }
>();

/** The effect a drink (a misc good that wears: mead, a potion) restores, as the sorted keys of its
 *  `restorePct`, or null for any other wearable. */
function drinkEffect(equip: EquipClass): string | null {
  if (equip.category !== 'misc' || !equip.wears || equip.restorePct === undefined) return null;
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
 * good or one of its equivalents, so a mead grant is one bottle each. Empty slots only: a tool upgrade
 * is {@link grantSlotFor}'s.
 */
function freeSlotFor(eq: EquipmentData | undefined, spec: GrantSpec): number | null {
  if (spec.category !== 'misc') {
    return eq === undefined || equipSlotValue(eq, spec.category, 0) === null ? 0 : null;
  }
  if (eq === undefined) return 0;
  let free: number | null = null;
  for (let i = 0; i < eq.misc.length; i++) {
    const held = eq.misc[i];
    if (held === null) {
      free ??= i;
      continue;
    }
    if (held === undefined) continue;
    if (held.goodType === spec.goodType || spec.equivalents?.has(held.goodType) === true) return null;
  }
  return free;
}

/** The slot `spec` fills for a settler wearing `eq`, or null when it is not his: a tool for a `toolless`
 *  trade, a good `kept` from his kind, or a want he already meets. With `upgrade`, a tool weaker than
 *  `spec` is a want too. */
function grantSlotFor(
  content: ContentSet,
  spec: GrantSpec,
  eq: EquipmentData | undefined,
  toolless: boolean,
  kept: readonly number[],
  upgrade: boolean,
): number | null {
  if (toolless && spec.category === 'tool') return null; // its boots and misc grants still apply
  if (kept.includes(spec.goodType)) return null; // the other group's alone
  const free = freeSlotFor(eq, spec);
  if (free !== null || !upgrade || spec.category !== 'tool' || eq === undefined) return free;
  const held = equipSlotValue(eq, 'tool', 0);
  return held !== null && heldToolRank(content, held) < spec.toolRank ? 0 : null;
}

/** A tool good's rank: production bonus first, the work factor breaking a tie. 0 for any other good. */
function toolRankOf(equip: EquipClass): number {
  if (equip.category !== 'tool') return 0;
  return (equip.productionBonusPct ?? 0) * TOOL_RANK_BONUS_WEIGHT + (equip.workFactorPct ?? 0);
}

/** Scales the production bonus past any work factor in {@link toolRankOf}, so the factor only breaks ties. */
const TOOL_RANK_BONUS_WEIGHT = 10_000;

function heldToolRank(content: ContentSet, held: EquipmentSlot): number {
  const equip = contentIndex(content).goods.get(held.goodType)?.equip;
  return equip === undefined ? 0 : toolRankOf(equip);
}

/** Whether `e`'s beat visit on `tick` weighs a tool upgrade: on every {@link UPGRADE_VISIT_STRIDE_WORN}th
 *  visit for a worn tool, every {@link UPGRADE_VISIT_STRIDE_FRESH}th for a fresher one, staggered by id. */
function upgradeDue(content: ContentSet, e: Entity, tick: number, eq: EquipmentData | undefined): boolean {
  const held = eq === undefined ? null : equipSlotValue(eq, 'tool', 0);
  if (held === null) return false; // an empty slot is a plain grant
  const stride = isWornAtMost(content, held, UPGRADE_WORN_DIVISOR)
    ? UPGRADE_VISIT_STRIDE_FRESH
    : UPGRADE_VISIT_STRIDE_WORN;
  return (Math.floor(tick / ASSISTANT_SCAN_PERIOD_TICKS) + e) % stride === 0;
}

/** A grant the assistant still owes one settler: the good and the slot it fills. */
export interface OwedGrant {
  readonly goodType: number;
  readonly category: EquipCategory;
  readonly slot: number;
}

/**
 * The grants `e`'s owner still owes him, strongest first: each good his trade and kind may take, with a
 * free slot for it (or a weaker tool, while the upgrade switch is on) and a unit of his side's stock that
 * no errand underway holds, wherever it lies. The dispatch's rules without its beat and its walk-off gates,
 * for an errand out at a store to chain its next fetch.
 */
export function owedAssistantGrants(world: World, ctx: SystemContext, e: Entity): OwedGrant[] {
  const owner = ownerOf(world, e);
  const jobType = world.tryGet(e, Settler)?.jobType ?? null;
  if (owner === undefined || jobType === null || !mayChangeEquipment(world, ctx.content, e)) return [];
  if (towerPostFor(world, ctx, e, jobType) !== null) return [];
  const wanted = collectGrantSpecs(world, ctx).get(owner);
  if (wanted === undefined) return [];
  const toolless = !toolHelpsJob(ctx.content, jobType);
  const upgrade = assistantUpgradesTools(world, owner);
  const kept = isFighterJob(ctx.content, jobType)
    ? assistantCivilianOnlyGoods(world, owner)
    : assistantSoldierOnlyGoods(world, owner);
  const eq = world.tryGet(e, Equipment);
  const stock = FetchableStock.of(world, ctx);
  const underway = equipFetchesHeld(world).get(owner);
  const owed: OwedGrant[] = [];
  for (const spec of wanted) {
    const slot = grantSlotFor(ctx.content, spec, eq, toolless, kept, upgrade);
    if (slot === null || !stock.exceeds(owner, spec.goodType, underway?.get(spec.goodType) ?? 0)) continue;
    owed.push({ goodType: spec.goodType, category: spec.category, slot });
  }
  return owed;
}

/** Units counted per player and good, made only for the pairs counted. */
class PlayerGoodCounts {
  private readonly byPlayer = new Map<number, Map<number, number>>();

  of(player: number, goodType: number): number {
    return this.byPlayer.get(player)?.get(goodType) ?? 0;
  }

  add(player: number, goodType: number): void {
    let byGood = this.byPlayer.get(player);
    if (byGood === undefined) {
      byGood = new Map();
      this.byPlayer.set(player, byGood);
    }
    byGood.set(goodType, (byGood.get(goodType) ?? 0) + 1);
  }
}

const byId = (e: Entity): number => e;

/** The beat of the scan period `e` is considered on. */
function grantBeatOf(e: Entity): number {
  return e % ASSISTANT_SCAN_PERIOD_TICKS;
}

/** The settlers bucketed by scan beat, ascending id, kept per world from a feed of settler births and
 *  deaths, so a tick visits its own beat's slice instead of the whole roster. */
class GrantBeats {
  private readonly beats: Entity[][] = Array.from({ length: ASSISTANT_SCAN_PERIOD_TICKS }, () => []);
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(private readonly world: World) {
    this.feed = world.watchChanges([Settler], []);
    this.rebuild();
  }

  /** The settlers, ascending-id, whose grant beat falls on `tick`: those with `(e + tick) % period === 0`. */
  due(tick: number): readonly Entity[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.beatOf(
      (ASSISTANT_SCAN_PERIOD_TICKS - (tick % ASSISTANT_SCAN_PERIOD_TICKS)) % ASSISTANT_SCAN_PERIOD_TICKS,
    );
  }

  private refresh(e: Entity): void {
    const beat = this.beatOf(grantBeatOf(e));
    const wanted = this.world.has(e, Settler);
    if (wanted === includesSortedId(beat, e, byId)) return;
    if (wanted) insertSortedById(beat, e, byId);
    else removeSortedById(beat, e, byId);
  }

  private rebuild(): void {
    for (const beat of this.beats) beat.length = 0;
    for (const e of this.world.canonicalQuery(Settler)) this.beatOf(grantBeatOf(e)).push(e);
  }

  private beatOf(beat: number): Entity[] {
    const settlers = this.beats[beat];
    if (settlers === undefined) throw new Error(`assistantGrants: no scan beat ${beat}`);
    return settlers;
  }

  verify(): string[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    const problems: string[] = [];
    const fresh = this.beats.map((): Entity[] => []);
    for (const e of this.world.canonicalQuery(Settler)) fresh[grantBeatOf(e)]?.push(e);
    this.beats.forEach((held, beat) => {
      const want = fresh[beat] ?? [];
      if (held.length !== want.length || held.some((e, i) => want[i] !== e)) {
        problems.push(`assistantGrants settlers on beat ${beat} diverge from a fresh scan`);
      }
    });
    return problems;
  }
}

const grantBeats = new WeakMap<World, GrantBeats>();

function dueThisBeat(world: World, tick: number): readonly Entity[] {
  let held = grantBeats.get(world);
  if (held === undefined) {
    const created = new GrantBeats(world);
    world.registerCacheVerifier('assistantGrantBeats', () => created.verify());
    grantBeats.set(world, created);
    held = created;
  }
  return held.due(tick);
}
