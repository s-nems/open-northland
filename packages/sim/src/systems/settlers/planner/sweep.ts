import { Owner, ownerOf, Position, Settler } from '../../../components/index.js';
import {
  includesSortedId,
  indexAboveId,
  insertSortedById,
  removeSortedById,
} from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { ShelterSites } from '../../defence/index.js';
import { IDLE_REPLAN_PERIOD_TICKS, idleBeatOf } from './idle-replan.js';
import {
  type IdleRelease,
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
 * is the only failed-route recovery a parked creature has; `travellingByOwner` holds the quiet walkers
 * only an alarm can divert, by owner; `idle` holds the idlers whose visit does something only on their
 * re-plan beat, alarm or cut-off check, also split by beat and by owner. The owner split lets an alarm
 * scan only its owner's settlers. Kept across ticks per world from a change feed.
 */
class SweepCandidates {
  private readonly acting: Entity[] = [];
  private readonly travellingByOwner = new Map<number, Entity[]>();
  private readonly idle: Entity[] = [];
  private readonly idleByOwner = new Map<number, Entity[]>();
  private readonly idleByBeat: Entity[][] = Array.from({ length: IDLE_REPLAN_PERIOD_TICKS }, () => []);
  /** The owner each walker or idler is filed under, so a re-owned one leaves its old owner's lists. */
  private readonly filedOwner = new Map<Entity, number>();
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);
  /** Inserts and removals in `acting` so far: the index of the last answer stays a valid start for
   *  the next, later cursor while this holds still, so a pass walks forward instead of searching. */
  private actingEdits = 0;
  private lastAt = 0;
  private lastAtEdits = -1;

  constructor(private readonly world: World) {
    this.feed = world.watchChanges(
      [Settler, Position, Owner, ...RELEASE_IDLE_MEMBERSHIP],
      RELEASE_IDLE_VALUES,
    );
    this.rebuild();
  }

  /**
   * The first settler above `cursor` to visit, caught up first, so one another's plan woke earlier in
   * this pass is still reached in id order. An idler counts on `beat`, or on every beat when that is
   * undefined. With `shelters` on alarm a quiet walker or an idler of an alarmed owner counts too when
   * its cover may draw it; each is looked at about once per pass, since a scan stops at the next settler
   * already chosen.
   */
  after(cursor: number, shelters: ShelterSites, beat: number | undefined): Entity | undefined {
    this.catchUp();
    const idlers = beat === undefined ? this.idle : this.idlersOn(beat);
    let next = earlier(this.acting[this.actingAbove(cursor)], idlers[indexAboveId(idlers, cursor, byId)]);
    if (shelters.size === 0) return next;
    for (const owner of shelters.keys()) {
      next = this.firstTakingCover(this.travellingByOwner.get(owner), cursor, next, shelters);
      if (beat !== undefined) {
        next = this.firstTakingCover(this.idleByOwner.get(owner), cursor, next, shelters);
      }
    }
    return next;
  }

  /** The first of `ids` above `cursor` and below `bound` whose owner's cover may draw it, else `bound`. */
  private firstTakingCover(
    ids: readonly Entity[] | undefined,
    cursor: number,
    bound: Entity | undefined,
    shelters: ShelterSites,
  ): Entity | undefined {
    if (ids === undefined) return bound;
    for (let i = indexAboveId(ids, cursor, byId); i < ids.length; i++) {
      const e = ids[i];
      if (e === undefined || (bound !== undefined && e > bound)) break;
      if (takesCoverFrom(this.world, e, shelters)) return e;
    }
    return bound;
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
    const release = positioned ? idleRelease(this.world, e) : undefined;
    if (setMember(this.acting, e, release === null)) this.actingEdits++;
    setMember(this.idle, e, release === 'idle');
    setMember(this.idlersOn(idleBeatOf(e)), e, release === 'idle');
    const prior = this.filedOwner.get(e);
    const owner = positioned ? ownerOf(this.world, e) : undefined;
    if (prior !== undefined && prior !== owner) {
      setMember(ownerList(this.travellingByOwner, prior), e, false);
      setMember(ownerList(this.idleByOwner, prior), e, false);
    }
    if (owner === undefined) {
      this.filedOwner.delete(e);
      return;
    }
    setMember(ownerList(this.travellingByOwner, owner), e, release === 'travelling');
    setMember(ownerList(this.idleByOwner, owner), e, release === 'idle');
    if (release === 'travelling' || release === 'idle') this.filedOwner.set(e, owner);
    else this.filedOwner.delete(e);
  }

  private rebuild(): void {
    this.actingEdits++;
    this.acting.length = 0;
    this.idle.length = 0;
    this.travellingByOwner.clear();
    this.idleByOwner.clear();
    this.filedOwner.clear();
    for (const beat of this.idleByBeat) beat.length = 0;
    for (const e of this.world.canonicalQuery(Settler, Position)) {
      const release = idleRelease(this.world, e);
      if (release === null) this.acting.push(e);
      else if (release === 'idle') {
        this.idle.push(e);
        this.idlersOn(idleBeatOf(e)).push(e);
      }
      const owner = ownerOf(this.world, e);
      if (owner === undefined || (release !== 'travelling' && release !== 'idle')) continue;
      ownerList(release === 'travelling' ? this.travellingByOwner : this.idleByOwner, owner).push(e);
      this.filedOwner.set(e, owner);
    }
  }

  private idlersOn(beat: number): Entity[] {
    const idlers = this.idleByBeat[beat];
    if (idlers === undefined) throw new Error(`plannerSweep: no idle beat ${beat}`);
    return idlers;
  }

  verify(): string[] {
    this.catchUp();
    const all = this.world.canonicalQuery(Settler, Position);
    const acting = all.filter((e) => idleRelease(this.world, e) === null);
    const idle = all.filter((e) => idleRelease(this.world, e) === 'idle');
    const problems: string[] = [];
    if (!sameIds(acting, this.acting))
      problems.push('plannerSweep acting settlers diverge from a fresh scan');
    if (!sameIds(idle, this.idle)) problems.push('plannerSweep idlers diverge from a fresh scan');
    this.idleByBeat.forEach((ids, beat) => {
      const fresh = idle.filter((e) => idleBeatOf(e) === beat);
      if (!sameIds(fresh, ids))
        problems.push(`plannerSweep idlers on beat ${beat} diverge from a fresh scan`);
    });
    const byOwner = (release: IdleRelease): Map<number, Entity[]> => {
      const lists = new Map<number, Entity[]>();
      for (const e of all) {
        const owner = ownerOf(this.world, e);
        if (owner !== undefined && idleRelease(this.world, e) === release) ownerList(lists, owner).push(e);
      }
      return lists;
    };
    if (!sameOwnerLists(byOwner('travelling'), this.travellingByOwner)) {
      problems.push('plannerSweep quiet walkers by owner diverge from a fresh scan');
    }
    if (!sameOwnerLists(byOwner('idle'), this.idleByOwner)) {
      problems.push('plannerSweep idlers by owner diverge from a fresh scan');
    }
    return problems;
  }
}

function ownerList(lists: Map<number, Entity[]>, owner: number): Entity[] {
  let ids = lists.get(owner);
  if (ids === undefined) {
    ids = [];
    lists.set(owner, ids);
  }
  return ids;
}

/** Whether `held` files the same settlers per owner as `fresh`; an emptied list counts as absent. */
function sameOwnerLists(fresh: Map<number, Entity[]>, held: Map<number, Entity[]>): boolean {
  const owners = new Set([...fresh.keys(), ...held.keys()]);
  return [...owners].every((owner) => sameIds(fresh.get(owner) ?? [], held.get(owner) ?? []));
}

function earlier(a: Entity | undefined, b: Entity | undefined): Entity | undefined {
  if (a === undefined) return b;
  return b === undefined || a < b ? a : b;
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
 * ones whose {@link releaseStaleIntent} may change something, and the idlers due on `idleBeat`, or all
 * of them when that is undefined. The pass's claim maps hand out targets first come, first served, so
 * this order decides who wins. Only settlers positioned when the sweep starts take part; a settler
 * never loses either component while alive, so one created mid-pass is the only newcomer.
 */
export function* sweepOrder(
  world: World,
  shelters: ShelterSites,
  idleBeat: number | undefined,
): Generator<Entity> {
  let held = candidates.get(world);
  if (held === undefined) {
    const created = new SweepCandidates(world);
    world.registerCacheVerifier('plannerSweep', () => created.verify());
    candidates.set(world, created);
    held = created;
  }
  const createdMidPass = world.nextEntityId;
  for (
    let e = held.after(0, shelters, idleBeat);
    e !== undefined && e < createdMidPass;
    e = held.after(e, shelters, idleBeat)
  ) {
    yield e;
  }
}
