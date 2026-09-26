import { Position, Settler } from '../../../components/index.js';
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
 * an alarm can divert; `idle` holds the idlers whose visit does something only on their re-plan beat,
 * alarm or cut-off check, also split by beat. Kept across ticks per world from a change feed.
 */
class SweepCandidates {
  private readonly acting: Entity[] = [];
  private readonly travelling: Entity[] = [];
  private readonly idle: Entity[] = [];
  private readonly idleByBeat: Entity[][] = Array.from({ length: IDLE_REPLAN_PERIOD_TICKS }, () => []);
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
   * this pass is still reached in id order. An idler counts on `beat`, or on every beat when that is
   * undefined. With `shelters` on alarm a quiet walker or an idler counts too when its owner's cover may
   * draw it; each is looked at once per pass, since the scan stops at the next settler already chosen.
   */
  after(cursor: number, shelters: ShelterSites, beat: number | undefined): Entity | undefined {
    this.catchUp();
    const idlers = beat === undefined ? this.idle : this.idlersOn(beat);
    const next = earlier(this.acting[this.actingAbove(cursor)], idlers[indexAboveId(idlers, cursor, byId)]);
    if (shelters.size === 0) return next;
    const walker = this.firstTakingCover(this.travelling, cursor, next, shelters);
    return beat === undefined ? walker : this.firstTakingCover(this.idle, cursor, walker, shelters);
  }

  /** The first of `ids` above `cursor` and below `bound` whose owner's cover may draw it, else `bound`. */
  private firstTakingCover(
    ids: readonly Entity[],
    cursor: number,
    bound: Entity | undefined,
    shelters: ShelterSites,
  ): Entity | undefined {
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
    setMember(this.travelling, e, release === 'travelling');
    setMember(this.idle, e, release === 'idle');
    setMember(this.idlersOn(idleBeatOf(e)), e, release === 'idle');
  }

  private rebuild(): void {
    this.actingEdits++;
    this.acting.length = 0;
    this.travelling.length = 0;
    this.idle.length = 0;
    for (const beat of this.idleByBeat) beat.length = 0;
    for (const e of this.world.canonicalQuery(Settler, Position)) {
      const release = idleRelease(this.world, e);
      if (release === null) this.acting.push(e);
      else if (release === 'travelling') this.travelling.push(e);
      else if (release === 'idle') {
        this.idle.push(e);
        this.idlersOn(idleBeatOf(e)).push(e);
      }
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
    const travelling = all.filter((e) => idleRelease(this.world, e) === 'travelling');
    const idle = all.filter((e) => idleRelease(this.world, e) === 'idle');
    const problems: string[] = [];
    if (!sameIds(acting, this.acting))
      problems.push('plannerSweep acting settlers diverge from a fresh scan');
    if (!sameIds(travelling, this.travelling)) {
      problems.push('plannerSweep quiet walkers diverge from a fresh scan');
    }
    if (!sameIds(idle, this.idle)) problems.push('plannerSweep idlers diverge from a fresh scan');
    this.idleByBeat.forEach((ids, beat) => {
      const fresh = idle.filter((e) => idleBeatOf(e) === beat);
      if (!sameIds(fresh, ids))
        problems.push(`plannerSweep idlers on beat ${beat} diverge from a fresh scan`);
    });
    return problems;
  }
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
