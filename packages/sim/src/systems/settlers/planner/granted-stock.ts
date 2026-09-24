import {
  Building,
  Owner,
  ownerOf,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../components/index.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { accessibleStockAmounts, mergedRecipeOf, recipeConsumes } from '../../stores/index.js';

/** One store's share of the totals: its owner and the units of each good it lends a fetch. */
interface Contribution {
  readonly owner: number | undefined;
  readonly units: ReadonlyMap<number, number>;
}

/** One good's units across the stores: those on unowned piles count for every player. */
interface GoodTotal {
  unowned: number;
  readonly byOwner: Map<number, number>;
}

/**
 * Every good's store and pile stock, per owner, for the assistant's grant budget. A from-scratch
 * construction site and a workshop's own input reserve are excluded, matching {@link nearestStoreHolding};
 * an unowned pile counts for every player.
 *
 * Kept across ticks per world, so a tick pays for the stores that changed rather than every stockpile.
 * Stock in other signpost networks and buried piles is counted too (approximation): this bounds the
 * reservation, the per-settler scan still gates every dispatch.
 */
export class GrantedStock {
  private readonly totals = new Map<number, GoodTotal>();
  private readonly captures: JournaledCaptures<Contribution>;

  private constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {
    this.captures = new JournaledCaptures(
      world,
      {
        membership: [Stockpile, Position, Owner, Building, Upgrading, UnderConstruction],
        values: [Stockpile, Owner, Building, Upgrading],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => contributionOf(world, ctx, e),
        apply: (_e, c) => foldInto(this.totals, c, 1),
        withdraw: (_e, c) => foldInto(this.totals, c, -1),
        clear: () => this.totals.clear(),
      },
    );
  }

  /** `world`'s ledger, caught up to its current stock. */
  static of(world: World, ctx: SystemContext): GrantedStock {
    let ledger = ledgers.get(world);
    if (ledger === undefined) {
      ledger = new GrantedStock(world, ctx);
      ledgers.set(world, ledger);
      world.registerCacheVerifier('grantedStock', () => ledgers.get(world)?.verify() ?? []);
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

  private verify(): string[] {
    this.captures.catchUp();
    const fresh = new Map<number, GoodTotal>();
    for (const e of this.world.canonicalQuery(Stockpile, Position)) {
      const c = contributionOf(this.world, this.ctx, e);
      if (c !== null) foldInto(fresh, c, 1);
    }
    const goods = new Set([...fresh.keys(), ...this.totals.keys()]);
    return [...goods]
      .filter((good) => !sameTotal(this.totals.get(good), fresh.get(good)))
      .map((good) => `grantedStock totals of good ${good} disagree with a fresh store scan`);
  }
}

const ledgers = new WeakMap<World, GrantedStock>();

function contributionOf(world: World, ctx: SystemContext, e: Entity): Contribution | null {
  if (!world.has(e, Stockpile) || !world.has(e, Position)) return null;
  const amounts = accessibleStockAmounts(world, e);
  if (amounts === undefined || amounts.size === 0) return null;
  const reserved = mergedRecipeOf(world, ctx, e)?.inputs;
  const units = new Map<number, number>();
  for (const [good, amount] of amounts) {
    if (!recipeConsumes(reserved, good)) units.set(good, amount);
  }
  return { owner: ownerOf(world, e), units };
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
