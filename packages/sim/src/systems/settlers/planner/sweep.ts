import { Position, Settler } from '../../../components/index.js';
import {
  includesSortedId,
  indexAboveId,
  insertSortedById,
  removeSortedById,
} from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { ShelterSites } from '../../defence/index.js';
import {
  idleRelease,
  RELEASE_IDLE_MEMBERSHIP,
  RELEASE_IDLE_VALUES,
  releaseStaleIntent,
  takesCoverFrom,
} from './replan.js';

const byId = (e: Entity): number => e;

/**
 * The positioned settlers split by what their planner visit may do, each list in ascending id:
 * `acting` holds every one {@link idleRelease} does not pass by, wildlife included since the release
 * is the only failed-route recovery a parked creature has; `travelling` holds the quiet walkers only
 * an alarm can divert. Kept across ticks per world from a change feed.
 */
class SweepCandidates {
  private readonly acting: Entity[] = [];
  private readonly travelling: Entity[] = [];
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);
  /** Inserts and removals in `acting` so far: the index of the last answer stays a valid start for
   *  the next, later cursor while this holds still, so a pass walks forward instead of searching. */
  private actingEdits = 0;
  private lastAt = 0;
  private lastAtEdits = -1;

  constructor(private readonly world: World) {
    this.feed = world.watchChanges([Settler, Position, ...RELEASE_IDLE_MEMBERSHIP], RELEASE_IDLE_VALUES);
    this.rebuild();
  }

  /**
   * The first settler above `cursor` to visit, caught up first, so one another's plan woke earlier in
   * this pass is still reached in id order. With `shelters` on alarm a quiet walker counts too when
   * its owner's cover may draw it; each walker is looked at once per pass, since the scan stops at the
   * next acting settler.
   */
  after(cursor: number, shelters: ShelterSites): Entity | undefined {
    this.catchUp();
    const acting = this.acting[this.actingAbove(cursor)];
    if (shelters.size === 0) return acting;
    for (let i = indexAboveId(this.travelling, cursor, byId); i < this.travelling.length; i++) {
      const walker = this.travelling[i];
      if (walker === undefined || (acting !== undefined && walker > acting)) break;
      if (takesCoverFrom(this.world, walker, shelters)) return walker;
    }
    return acting;
  }

  private actingAbove(cursor: number): number {
    let at = this.lastAt;
    const previous = this.acting[at - 1];
    if (this.lastAtEdits !== this.actingEdits || (previous !== undefined && previous > cursor)) {
      at = indexAboveId(this.acting, cursor, byId);
    } else {
      while ((this.acting[at] ?? Number.POSITIVE_INFINITY) <= cursor) at++;
    }
    this.lastAt = at;
    this.lastAtEdits = this.actingEdits;
    return at;
  }

  private catchUp(): void {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
  }

  private refresh(e: Entity): void {
    const positioned = this.world.has(e, Settler) && this.world.has(e, Position);
    const idle = positioned ? idleRelease(this.world, e) : undefined;
    if (setMember(this.acting, e, idle === null)) this.actingEdits++;
    setMember(this.travelling, e, idle === 'travelling');
  }

  private rebuild(): void {
    this.actingEdits++;
    this.acting.length = 0;
    this.travelling.length = 0;
    for (const e of this.world.canonicalQuery(Settler, Position)) {
      const idle = idleRelease(this.world, e);
      if (idle === null) this.acting.push(e);
      else if (idle === 'travelling') this.travelling.push(e);
    }
  }

  verify(): string[] {
    this.catchUp();
    const all = this.world.canonicalQuery(Settler, Position);
    const acting = all.filter((e) => idleRelease(this.world, e) === null);
    const travelling = all.filter((e) => idleRelease(this.world, e) === 'travelling');
    const problems: string[] = [];
    if (!sameIds(acting, this.acting))
      problems.push('plannerSweep acting settlers diverge from a fresh scan');
    if (!sameIds(travelling, this.travelling)) {
      problems.push('plannerSweep quiet walkers diverge from a fresh scan');
    }
    return problems;
  }
}

/** Whether `ids` changed. */
function setMember(ids: Entity[], e: Entity, wanted: boolean): boolean {
  if (wanted === includesSortedId(ids, e, byId)) return false;
  if (wanted) insertSortedById(ids, e, byId);
  else removeSortedById(ids, e, byId);
  return true;
}

function sameIds(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((e, i) => b[i] === e);
}

const candidates = new WeakMap<World, SweepCandidates>();

/**
 * The settlers the planner sweep visits this pass, in ascending id, read live between visits: the
 * ones whose {@link releaseStaleIntent} may change something. The pass's claim maps hand out targets
 * first come, first served, so this order decides who wins. Only settlers positioned when the sweep
 * starts take part; a settler never loses either component while alive, so one created mid-pass is
 * the only newcomer.
 */
export function* sweepOrder(world: World, shelters: ShelterSites): Generator<Entity> {
  let held = candidates.get(world);
  if (held === undefined) {
    const created = new SweepCandidates(world);
    world.registerCacheVerifier('plannerSweep', () => created.verify());
    candidates.set(world, created);
    held = created;
  }
  const createdMidPass = world.nextEntityId;
  for (let e = held.after(0, shelters); e !== undefined && e < createdMidPass; e = held.after(e, shelters)) {
    yield e;
  }
}
