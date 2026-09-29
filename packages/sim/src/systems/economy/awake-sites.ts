import type { ContentSet } from '@open-northland/data';
import {
  Building,
  Health,
  Palisade,
  RoadSite,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { carriesSiteClaim, isSoloSite } from './site-claim.js';

// Everything the construction pass reads off a site. A site none of these changed on since its last
// visit, and that waits on nothing outside itself, would pass exactly as it did last time: a no-op.
const SITE_MEMBERSHIP = [UnderConstruction, Stockpile, Health, Building, Palisade, RoadSite, Upgrading];
const SITE_VALUES = [UnderConstruction, Stockpile, Health, Building, Palisade, RoadSite];

const ascending = (a: Entity, b: Entity): number => a - b;

/**
 * The construction sites the pass must visit, so it scales with sites being worked rather than every
 * pending foundation: those a watched write touched since the last pass, plus the one-builder sites whose
 * outcome hangs on another entity (a claim whose builder may lapse, a struck wall waiting for its cells
 * to clear).
 */
export class AwakeSites {
  private readonly awake = new Set<Entity>();
  private readonly feed: ChangeFeed;
  private readonly wake = (e: Entity): void => {
    if (this.world.has(e, UnderConstruction)) this.awake.add(e);
  };

  constructor(
    private readonly world: World,
    private content: ContentSet,
  ) {
    this.feed = world.watchChanges(SITE_MEMBERSHIP, SITE_VALUES);
    this.wakeAll();
  }

  /** This tick's sites to visit, in ascending id. */
  take(ctx: SystemContext): Entity[] {
    if (ctx.content !== this.content) {
      this.content = ctx.content;
      this.wakeAll();
    }
    if (this.feed.pending && this.feed.drain(this.wake)) this.wakeAll();
    return [...this.awake].sort(ascending);
  }

  /** Put `site` to sleep after its visit unless it waits on another entity. */
  settle(site: Entity): void {
    if (!waitsOnOthers(this.world, site)) this.awake.delete(site);
  }

  private wakeAll(): void {
    for (const e of this.world.canonicalQuery(UnderConstruction)) this.awake.add(e);
  }

  verify(): string[] {
    const pending = new Set<Entity>();
    if (this.feed.peek((e) => pending.add(e))) return [];
    const missed = this.world
      .canonicalQuery(UnderConstruction)
      .filter((e) => waitsOnOthers(this.world, e) && !this.awake.has(e) && !pending.has(e));
    return missed.length === 0 ? [] : [`awakeSites sleeps ${missed.length} site(s) that wait on others`];
  }
}

function waitsOnOthers(world: World, site: Entity): boolean {
  const labor = world.tryGet(site, UnderConstruction)?.labor;
  if (labor === undefined || !isSoloSite(world, site)) return false;
  return labor >= ONE || carriesSiteClaim(world, site);
}

const held = new WeakMap<World, AwakeSites>();

export function awakeSitesOf(world: World, ctx: SystemContext): AwakeSites {
  let sites = held.get(world);
  if (sites === undefined) {
    const created = new AwakeSites(world, ctx.content);
    world.registerCacheVerifier('awakeSites', () => created.verify());
    held.set(world, created);
    sites = created;
  }
  return sites;
}
