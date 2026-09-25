import { PRAYER_SITE } from '@open-northland/data';
import {
  Building,
  Health,
  needsEnabled,
  ownerOf,
  Person,
  Position,
  Settler,
  UnderConstruction,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { isFinishedPrayerSite } from '../readviews/index.js';
import { applyNeedUnits, carriesNeeds, NEED_SATED_THRESHOLD } from './needs/index.js';

/** Map points (hex distance) from a temple's anchor its blessing reaches. Original behavior. */
export const TEMPLE_AURA_RANGE = 50;
/** Religion reserve units a blessing adds, only to a bar at or under the sated level. Original behavior. */
export const TEMPLE_AURA_PIETY_UNITS = 250;
/** Hitpoints a blessing adds, past the max. Original behavior. */
export const TEMPLE_AURA_HITPOINTS = 50;

/** The most hitpoints a blessing raises a pool of `max` to: the max plus half again. Original behavior:
 *  the only ceiling on a human's hitpoints, so nothing but damage takes the surplus away. */
export function blessedHitpointCeiling(max: number): number {
  return max + Math.trunc(max / 2);
}

const byId = (e: Entity): number => e;

/**
 * Once per game second, each finished temple at full hitpoints blesses every person of its owner within
 * {@link TEMPLE_AURA_RANGE}: hitpoints above the max, and religion up to the sated level for a settler
 * whose bars move. One wound on the temple stops the blessing until it is whole again. Original behavior;
 * the original also blesses children, whose bars this sim does not keep. Deliberate departure: the original
 * blesses once per temple in reach, so a cluster of temples multiplies the bonus; here a person is blessed
 * once a second however many temples reach it.
 */
export const templeAuraSystem: System = (world, ctx) => {
  // Caught up every tick, so a busy tick's building writes never pile past the feed's limit.
  const temples = finishedTemplesOf(world, ctx).finished();
  if (ctx.tick % TICKS_PER_SECOND !== 0 || temples.length === 0) return;
  const anchorsByOwner = activeTempleAnchors(world, temples);
  if (anchorsByOwner.size === 0) return;
  const piety = needsEnabled(world);
  for (const e of world.query(Person, Position, Health)) {
    const owner = ownerOf(world, e);
    const anchors = owner === undefined ? undefined : anchorsByOwner.get(owner);
    if (anchors === undefined) continue;
    const at = world.get(e, Position);
    if (!withinAnyAnchor(anchors, nodeHxOfPosition(at.x, at.y), nodeHyOfPosition(at.y))) continue;
    bless(world, ctx, e, piety);
  }
};

/** Anchors of the owned, unwounded temples, flattened as `hx, hy` pairs per owner. */
function activeTempleAnchors(world: World, temples: readonly Entity[]): Map<number, number[]> {
  const byOwner = new Map<number, number[]>();
  for (const e of temples) {
    const owner = ownerOf(world, e);
    const health = world.tryGet(e, Health);
    if (owner === undefined || (health !== undefined && health.hitpoints < health.max)) continue;
    const at = world.get(e, Position);
    let anchors = byOwner.get(owner);
    if (anchors === undefined) {
      anchors = [];
      byOwner.set(owner, anchors);
    }
    anchors.push(nodeHxOfPosition(at.x, at.y), nodeHyOfPosition(at.y));
  }
  return byOwner;
}

function withinAnyAnchor(anchors: readonly number[], hx: number, hy: number): boolean {
  for (let i = 0; i < anchors.length; i += 2) {
    if (hexDistanceBetween(anchors[i] ?? 0, anchors[i + 1] ?? 0, hx, hy) <= TEMPLE_AURA_RANGE) return true;
  }
  return false;
}

function bless(world: World, ctx: SystemContext, e: Entity, piety: boolean): void {
  const health = world.get(e, Health);
  if (health.hitpoints > 0) {
    const raised = Math.min(health.hitpoints + TEMPLE_AURA_HITPOINTS, blessedHitpointCeiling(health.max));
    if (raised > health.hitpoints) world.mut(e, Health).hitpoints = raised;
  }
  if (!piety || !carriesNeeds(world, ctx.content, e)) return;
  if (world.get(e, Settler).piety < NEED_SATED_THRESHOLD) return;
  const s = world.mut(e, Settler);
  s.piety = applyNeedUnits(s.piety, TEMPLE_AURA_PIETY_UNITS);
}

/** The finished temples in ascending id, kept from a change feed so a second's pass reads no other
 *  building. Wounds and owners are read at the pass, since they move without changing the list. */
class FinishedTemples {
  private readonly temples: Entity[] = [];
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(
    private readonly world: World,
    private ctx: SystemContext,
  ) {
    this.feed = world.watchChanges([Building, UnderConstruction], [Building]);
    this.rebuild();
  }

  finished(): readonly Entity[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.temples;
  }

  retarget(ctx: SystemContext): void {
    const contentChanged = ctx.content !== this.ctx.content;
    this.ctx = ctx;
    if (contentChanged) this.rebuild();
  }

  private refresh(e: Entity): void {
    const wanted = this.isTemple(e);
    if (wanted === includesSortedId(this.temples, e, byId)) return;
    if (wanted) insertSortedById(this.temples, e, byId);
    else removeSortedById(this.temples, e, byId);
  }

  private rebuild(): void {
    this.temples.length = 0;
    for (const e of this.world.canonicalQuery(Building, Position)) {
      if (this.isTemple(e)) this.temples.push(e);
    }
  }

  private isTemple(e: Entity): boolean {
    return (
      this.world.isAlive(e) &&
      this.world.has(e, Position) &&
      isFinishedPrayerSite(this.world, this.ctx, e, PRAYER_SITE.temple)
    );
  }

  verify(): string[] {
    const held = [...this.finished()];
    const fresh = this.world.canonicalQuery(Building, Position).filter((e) => this.isTemple(e));
    const same = held.length === fresh.length && held.every((e, i) => fresh[i] === e);
    return same ? [] : ['finishedTemples diverge from a fresh scan'];
  }
}

const templeLists = new WeakMap<World, FinishedTemples>();

function finishedTemplesOf(world: World, ctx: SystemContext): FinishedTemples {
  let held = templeLists.get(world);
  if (held === undefined) {
    const created = new FinishedTemples(world, ctx);
    world.registerCacheVerifier('finishedTemples', () => created.verify());
    templeLists.set(world, created);
    held = created;
  } else {
    held.retarget(ctx);
  }
  return held;
}
