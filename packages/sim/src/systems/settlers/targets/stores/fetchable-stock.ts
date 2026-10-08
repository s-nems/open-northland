import {
  Building,
  GroundDrop,
  Owner,
  ownerOf,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../../components/index.js';
import { ChangeFeed } from '../../../../ecs/change-feed.js';
import { JournaledCaptures } from '../../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { ContentContext } from '../../../context.js';
import { accessibleStockAmounts, mergedRecipeOf, recipeConsumes } from '../../../stores/index.js';

/** One store's share of the totals: its owner and the units of each good it lends a fetch. Refilled in
 *  place when the store is recaptured, so the arrays only grow and entries past the counts are stale. */
interface Contribution {
  owner: number | undefined;
  /** How many goods it lends: `units[i]` units of `goods[i]` for `i < lent`, in stock order. */
  lent: number;
  readonly goods: number[];
  readonly units: number[];
  /** How many of the lent goods hold at least one unit, the first `heldCount` of `held`; a stock map may
   *  keep a zeroed slot. */
  heldCount: number;
  readonly held: number[];
}

/** One good's units across the stores: those on unowned piles count for every player. */
interface GoodTotal {
  unowned: number;
  readonly byOwner: Map<number, number>;
}

const NO_HOLDERS: ReadonlySet<Entity> = new Set();

/**
 * Every good's fetchable store and pile stock: the units per owner, for the assistant's grant budget,
 * and the stores holding any, for the holding band. A from-scratch construction site and a workshop's
 * own input reserve are excluded, matching {@link storeYieldsGood}; an unowned pile counts for every
 * player.
 *
 * Kept across ticks per world, so a tick pays for the stores that changed rather than every stockpile.
 * Stock in other signpost networks and buried piles is counted too: the totals only bound the grant
 * reservation (approximation), and the holding band applies the buried check itself.
 */
export class FetchableStock {
  private readonly totals = new Map<number, GoodTotal>();
  private readonly holdersByGood = new Map<number, Set<Entity>>();
  private readonly holderFeeds = new Map<number, ChangeFeed>();
  private readonly captures: JournaledCaptures<Contribution>;

  private constructor(
    private readonly world: World,
    readonly content: ContentContext,
  ) {
    this.captures = new JournaledCaptures(
      world,
      {
        // GroundDrop is read by no capture: it recaptures a pile so the holding band re-judges its burial.
        membership: [Stockpile, Position, Owner, Building, Upgrading, UnderConstruction, GroundDrop],
        values: [Stockpile, Owner, Building, Upgrading],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e, spent) => contributionOf(world, content, e, spent),
        apply: (e, c) => {
          foldInto(this.totals, c, 1);
          for (let i = 0; i < c.heldCount; i++) {
            const good = c.held[i] as number;
            holdersOf(this.holdersByGood, good).add(e);
            this.holderFeeds.get(good)?.record(e);
          }
        },
        withdraw: (e, c) => {
          foldInto(this.totals, c, -1);
          for (let i = 0; i < c.heldCount; i++) {
            const good = c.held[i] as number;
            this.holdersByGood.get(good)?.delete(e);
            this.holderFeeds.get(good)?.record(e);
          }
        },
        clear: () => {
          this.totals.clear();
          this.holdersByGood.clear();
          for (const feed of this.holderFeeds.values()) feed.lose();
        },
      },
    );
  }

  /** `world`'s ledger, caught up to its current stock. */
  static of(world: World, ctx: ContentContext): FetchableStock {
    let ledger = ledgers.get(world);
    if (ledger === undefined || ledger.content.content !== ctx.content) {
      if (ledger === undefined) {
        world.registerCacheVerifier('fetchableStock', () => ledgers.get(world)?.verify() ?? []);
      }
      ledger = new FetchableStock(world, { content: ctx.content });
      ledgers.set(world, ledger);
    } else {
      ledger.captures.catchUp();
    }
    return ledger;
  }

  /** Whether a store `player` owns lends a unit of `goodType`; unowned piles do not count. */
  ownsAny(player: number, goodType: number): boolean {
    return (this.totals.get(goodType)?.byOwner.get(player) ?? 0) > 0;
  }

  /** Whether `player` holds more than `units` of `goodType`. */
  exceeds(player: number, goodType: number, units: number): boolean {
    const total = this.totals.get(goodType);
    return total !== undefined && total.unowned + (total.byOwner.get(player) ?? 0) > units;
  }

  /** The stores lending at least one unit of `goodType`, in no particular order. The live set: read it,
   *  never keep it past the next catch-up. */
  holders(goodType: number): ReadonlySet<Entity> {
    return this.holdersByGood.get(goodType) ?? NO_HOLDERS;
  }

  /** A feed of the stores entering or leaving {@link holders} of `goodType`, or recaptured while in it,
   *  from now on. One reader per good: a new watch replaces the previous feed. */
  watchHolders(goodType: number): ChangeFeed {
    const feed = new ChangeFeed();
    this.holderFeeds.set(goodType, feed);
    return feed;
  }

  private verify(): string[] {
    this.captures.catchUp();
    const fresh = new Map<number, GoodTotal>();
    const freshHolders = new Map<number, Set<Entity>>();
    for (const e of this.world.canonicalQuery(Stockpile, Position)) {
      const c = contributionOf(this.world, this.content, e, undefined);
      if (c === null) continue;
      foldInto(fresh, c, 1);
      for (let i = 0; i < c.heldCount; i++) holdersOf(freshHolders, c.held[i] as number).add(e);
    }
    const goods = new Set([...fresh.keys(), ...this.totals.keys()]);
    const heldGoodTypes = new Set([...freshHolders.keys(), ...this.holdersByGood.keys()]);
    return [
      ...[...goods]
        .filter((good) => !sameTotal(this.totals.get(good), fresh.get(good)))
        .map((good) => `fetchableStock totals of good ${good} disagree with a fresh store scan`),
      ...[...heldGoodTypes]
        .filter((good) => !sameMembers(this.holders(good), freshHolders.get(good) ?? NO_HOLDERS))
        .map((good) => `fetchableStock holders of good ${good} disagree with a fresh store scan`),
    ];
  }
}

const ledgers = new WeakMap<World, FetchableStock>();

/** `e`'s contribution, refilling `spent` when given. */
function contributionOf(
  world: World,
  ctx: ContentContext,
  e: Entity,
  spent: Contribution | undefined,
): Contribution | null {
  if (!world.has(e, Stockpile) || !world.has(e, Position)) return null;
  const amounts = accessibleStockAmounts(world, e);
  if (amounts === undefined || amounts.size === 0) return null;
  const reserved = mergedRecipeOf(world, ctx, e)?.inputs;
  const c = spent ?? { owner: undefined, lent: 0, goods: [], units: [], heldCount: 0, held: [] };
  c.owner = ownerOf(world, e);
  c.lent = 0;
  c.heldCount = 0;
  // keys() plus get: destructured entries would allocate a pair per slot of every store written.
  for (const good of amounts.keys()) {
    if (recipeConsumes(reserved, good)) continue;
    const amount = amounts.get(good) ?? 0;
    c.goods[c.lent] = good;
    c.units[c.lent++] = amount;
    if (amount > 0) c.held[c.heldCount++] = good;
  }
  return c;
}

function holdersOf(byGood: Map<number, Set<Entity>>, good: number): Set<Entity> {
  let holders = byGood.get(good);
  if (holders === undefined) {
    holders = new Set();
    byGood.set(good, holders);
  }
  return holders;
}

function foldInto(totals: Map<number, GoodTotal>, contribution: Contribution, sign: 1 | -1): void {
  for (let i = 0; i < contribution.lent; i++) {
    const good = contribution.goods[i] as number;
    const units = contribution.units[i] as number;
    let total = totals.get(good);
    if (total === undefined) {
      total = { unowned: 0, byOwner: new Map() };
      totals.set(good, total);
    }
    if (contribution.owner === undefined) total.unowned += sign * units;
    else total.byOwner.set(contribution.owner, (total.byOwner.get(contribution.owner) ?? 0) + sign * units);
  }
}

/** Equal totals, reading a missing good or owner as zero units. */
function sameTotal(a: GoodTotal | undefined, b: GoodTotal | undefined): boolean {
  if ((a?.unowned ?? 0) !== (b?.unowned ?? 0)) return false;
  const owners = new Set([...(a?.byOwner.keys() ?? []), ...(b?.byOwner.keys() ?? [])]);
  return [...owners].every((o) => (a?.byOwner.get(o) ?? 0) === (b?.byOwner.get(o) ?? 0));
}

function sameMembers(a: ReadonlySet<Entity>, b: ReadonlySet<Entity>): boolean {
  if (a.size !== b.size) return false;
  for (const e of a) if (!b.has(e)) return false;
  return true;
}
