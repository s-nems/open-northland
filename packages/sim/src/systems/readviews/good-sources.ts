import type { ContentSet } from '@open-northland/data';
import { Building, Owner, ownerOf, Settler } from '../../components/index.js';
import { isCarrierJobId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { jobGatherGoods } from '../economy/gather-goods.js';

/** The goods one entity may bring into its side's economy, and the side it brings them to. */
interface SourceCapture {
  readonly owner: number | undefined;
  readonly goods: readonly number[];
}

/** The owner key an unowned source files under; player slots are never negative. */
const UNOWNED_KEY = -1;

const NO_SOURCES: ReadonlySet<Entity> = new Set();

/**
 * Per good and owner, the entities that may bring the good in: a settler whose trade gathers it or
 * operates a workplace type turning it out, and a building that refills its own stock of it. Keyed by
 * trade and building type alone, so a capture reads only its own entity; whether the settler's
 * workplace is finished, still makes the good, or keeps it for its own recipe is the caller's check.
 * Carriers are never sources: a farm with only its carrier grows no wheat.
 *
 * Kept across ticks per world and caught up per change, so a diagnosis costs the good's candidate
 * sources on its side rather than a walk over every workplace. Derived bookkeeping, never hashed or
 * saved, and read only by diagnoses, so it cannot change a simulation result.
 */
export class GoodSources {
  private readonly byGood = new Map<number, Map<number, Set<Entity>>>();
  private readonly captures: JournaledCaptures<SourceCapture>;

  private constructor(
    private readonly world: World,
    readonly content: ContentContext,
  ) {
    this.captures = new JournaledCaptures(
      world,
      { membership: [Settler, Building, Owner], values: [Settler, Building, Owner] },
      () => universeOf(world),
      {
        capture: (e) => sourceCaptureOf(world, content, e),
        apply: (e, c) => {
          for (const good of c.goods) membersOf(this.byGood, good, ownerKey(c.owner)).add(e);
        },
        withdraw: (e, c) => {
          for (const good of c.goods) this.byGood.get(good)?.get(ownerKey(c.owner))?.delete(e);
        },
        clear: () => this.byGood.clear(),
      },
    );
  }

  /** `world`'s ledger, caught up to its current settlers and buildings. */
  static of(world: World, ctx: ContentContext): GoodSources {
    let ledger = ledgers.get(world);
    if (ledger === undefined || ledger.content.content !== ctx.content) {
      if (ledger === undefined) {
        world.registerCacheVerifier('goodSources', () => ledgers.get(world)?.verify() ?? []);
      }
      ledger = new GoodSources(world, { content: ctx.content });
      ledgers.set(world, ledger);
    } else {
      ledger.captures.catchUp();
    }
    return ledger;
  }

  /** The candidate sources of `goodType` on `owner`'s side: its own and the unowned ones, or every one
   *  for an unowned asker. Live sets: read them, never keep them past the next catch-up. */
  *sources(goodType: number, owner: number | undefined): Generator<Entity> {
    const byOwner = this.byGood.get(goodType);
    if (byOwner === undefined) return;
    if (owner === undefined) {
      for (const members of byOwner.values()) yield* members;
      return;
    }
    yield* byOwner.get(owner) ?? NO_SOURCES;
    yield* byOwner.get(UNOWNED_KEY) ?? NO_SOURCES;
  }

  private verify(): string[] {
    this.captures.catchUp();
    const fresh = new Map<number, Map<number, Set<Entity>>>();
    for (const e of universeOf(this.world)) {
      const c = sourceCaptureOf(this.world, this.content, e);
      if (c !== null) for (const good of c.goods) membersOf(fresh, good, ownerKey(c.owner)).add(e);
    }
    const goods = new Set([...fresh.keys(), ...this.byGood.keys()]);
    return [...goods]
      .filter((good) => !sameMembers(this.byGood.get(good), fresh.get(good)))
      .map((good) => `goodSources of good ${good} disagree with a fresh settler and building scan`);
  }
}

const ledgers = new WeakMap<World, GoodSources>();

function universeOf(world: World): Entity[] {
  return [...world.canonicalQuery(Settler), ...world.canonicalQuery(Building)];
}

function sourceCaptureOf(world: World, ctx: ContentContext, e: Entity): SourceCapture | null {
  const settler = world.tryGet(e, Settler);
  let goods: readonly number[] | undefined;
  if (settler !== undefined) {
    goods = settler.jobType === null ? undefined : jobSourceGoods(ctx, settler.jobType);
  } else {
    const building = world.tryGet(e, Building);
    if (building !== undefined) goods = refilledGoods(ctx.content, building.buildingType);
  }
  return goods === undefined || goods.length === 0 ? null : { owner: ownerOf(world, e), goods };
}

const jobGoodsByContent = new WeakMap<ContentSet, Map<number, readonly number[]>>();

/** The goods a trade may bring in: those it gathers, and the products of every workplace type it
 *  operates. A carrier brings in none, even where it is a type's only operator. */
function jobSourceGoods(ctx: ContentContext, jobType: number): readonly number[] {
  let byJob = jobGoodsByContent.get(ctx.content);
  if (byJob === undefined) {
    byJob = new Map();
    jobGoodsByContent.set(ctx.content, byJob);
  }
  let goods = byJob.get(jobType);
  if (goods === undefined) {
    const index = contentIndex(ctx.content);
    const job = index.jobs.get(jobType);
    const found = new Set<number>();
    if (job !== undefined && !isCarrierJobId(job.id)) {
      for (const good of jobGatherGoods(ctx, jobType)) found.add(good);
      for (const [type, operators] of index.operatorJobsByBuilding) {
        if (!operators.has(jobType)) continue;
        for (const good of index.buildings.get(type)?.produces ?? []) found.add(good);
        for (const output of index.mergedRecipeByBuilding.get(type)?.outputs ?? [])
          found.add(output.goodType);
      }
    }
    goods = [...found].sort((a, b) => a - b);
    byJob.set(jobType, goods);
  }
  return goods;
}

/** The goods a building type tops up with no worker, the well's water and the hive's honey. */
function refilledGoods(content: ContentSet, buildingType: number): readonly number[] | undefined {
  const row = contentIndex(content).buildings.get(buildingType);
  return row?.refillsOwnStock === true ? row.produces : undefined;
}

function ownerKey(owner: number | undefined): number {
  return owner ?? UNOWNED_KEY;
}

function membersOf(byGood: Map<number, Map<number, Set<Entity>>>, good: number, key: number): Set<Entity> {
  let byOwner = byGood.get(good);
  if (byOwner === undefined) {
    byOwner = new Map();
    byGood.set(good, byOwner);
  }
  let members = byOwner.get(key);
  if (members === undefined) {
    members = new Set();
    byOwner.set(key, members);
  }
  return members;
}

function sameMembers(
  a: ReadonlyMap<number, ReadonlySet<Entity>> | undefined,
  b: ReadonlyMap<number, ReadonlySet<Entity>> | undefined,
): boolean {
  const keys = new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])]);
  for (const key of keys) {
    const x = a?.get(key) ?? NO_SOURCES;
    const y = b?.get(key) ?? NO_SOURCES;
    if (x.size !== y.size) return false;
    for (const e of x) if (!y.has(e)) return false;
  }
  return true;
}
