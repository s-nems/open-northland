import {
  Building,
  Owner,
  ownerOf,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../../components/index.js';
import { JournaledCaptures } from '../../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { ContentContext } from '../../../context.js';
import { accessibleStockAmounts, mergedRecipeOf, recipeConsumes } from '../../../stores/index.js';

/** One store's share of the totals: its owner and the units of each good it lends a fetch. */
interface Contribution {
  readonly owner: number | undefined;
  readonly units: ReadonlyMap<number, number>;
  /** The goods of {@link units} with at least one unit; a stock map may keep a zeroed slot. */
  readonly held: readonly number[];
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
  private readonly captures: JournaledCaptures<Contribution>;

  private constructor(
    private readonly world: World,
    readonly content: ContentContext,
  ) {
    this.captures = new JournaledCaptures(
      world,
      {
        membership: [Stockpile, Position, Owner, Building, Upgrading, UnderConstruction],
        values: [Stockpile, Owner, Building, Upgrading],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => contributionOf(world, content, e),
        apply: (e, c) => {
          foldInto(this.totals, c, 1);
          for (const good of c.held) holdersOf(this.holdersByGood, good).add(e);
        },
        withdraw: (e, c) => {
          foldInto(this.totals, c, -1);
          for (const good of c.held) this.holdersByGood.get(good)?.delete(e);
        },
        clear: () => {
          this.totals.clear();
          this.holdersByGood.clear();
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

  private verify(): string[] {
    this.captures.catchUp();
    const fresh = new Map<number, GoodTotal>();
    const freshHolders = new Map<number, Set<Entity>>();
    for (const e of this.world.canonicalQuery(Stockpile, Position)) {
      const c = contributionOf(this.world, this.content, e);
      if (c === null) continue;
      foldInto(fresh, c, 1);
      for (const good of c.held) holdersOf(freshHolders, good).add(e);
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

function contributionOf(world: World, ctx: ContentContext, e: Entity): Contribution | null {
  if (!world.has(e, Stockpile) || !world.has(e, Position)) return null;
  const amounts = accessibleStockAmounts(world, e);
  if (amounts === undefined || amounts.size === 0) return null;
  const reserved = mergedRecipeOf(world, ctx, e)?.inputs;
  const units = new Map<number, number>();
  const held: number[] = [];
  for (const [good, amount] of amounts) {
    if (recipeConsumes(reserved, good)) continue;
    units.set(good, amount);
    if (amount > 0) held.push(good);
  }
  return { owner: ownerOf(world, e), units, held };
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
  for (const [good, units] of contribution.units) {
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
