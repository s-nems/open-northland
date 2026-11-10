import type { ContentSet } from '@open-northland/data';
import {
  AiControl,
  DeliveryFlag,
  Owner,
  ownerOf,
  Position,
  Settler,
  Sheltering,
  YardDeliveryRoute,
} from '../../../components/index.js';
import { indexAboveId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { ShelterSites } from '../../defence/index.js';
import {
  beatKeyOf,
  COMPUTER_IDLE_REPLAN_PERIOD_TICKS,
  IDLE_REPLAN_PERIOD_TICKS,
  idleBeatOf,
  idleBeatOfTick,
  idleStandPeriodOf,
} from './idle-replan.js';
import {
  type IdleRelease,
  idleRelease,
  RELEASE_IDLE_MEMBERSHIP,
  RELEASE_IDLE_VALUES,
  releaseStaleIntent,
  shelterHasRoom,
  takesCoverFrom,
  waitsInside,
} from './replan.js';

const byId = (e: Entity): number => e;

/** The idle beats of both cadences as one index space: a human seat's beats, then a computer seat's. */
const IDLE_SLOTS = IDLE_REPLAN_PERIOD_TICKS + COMPUTER_IDLE_REPLAN_PERIOD_TICKS;

/** The slot idle `e` is filed on: its stand's period and the beat of {@link beatKeyOf} within it. */
function idleSlotOf(world: World, e: Entity): number {
  const period = idleStandPeriodOf(world, e);
  const beat = idleBeatOf(beatKeyOf(world, e), period);
  return period === IDLE_REPLAN_PERIOD_TICKS ? beat : IDLE_REPLAN_PERIOD_TICKS + beat;
}

/**
 * The positioned settlers split by what their planner visit may do, each list in ascending id:
 * `acting` holds every one {@link idleRelease} does not pass by, wildlife included since the release
 * is the only failed-route recovery a parked creature has; `travellingByOwner` holds the quiet walkers
 * only an alarm can divert, by owner; `idle` holds the idlers whose visit does something only on their
 * re-plan beat, alarm or cut-off check, also split by {@link idleSlotOf} and by owner. The
 * owner split lets an alarm scan only its owner's settlers. Kept across ticks per world from a change feed,
 * which also watches the flags of the yard routes passed by, since losing one makes its walkers act, and
 * rebuilt when the seats' AiControl moves, which picks each idler's period.
 */
class SweepCandidates {
  private readonly acting: Entity[] = [];
  private readonly travellingByOwner = new Map<number, Entity[]>();
  private readonly idle: Entity[] = [];
  private readonly idleByOwner = new Map<number, Entity[]>();
  private readonly idleBySlot: Entity[][] = Array.from({ length: IDLE_SLOTS }, () => []);
  /** How each positioned settler is filed, so a change that leaves its release, beat and owner as they
   *  were edits no list, and a re-owned or re-beaten one leaves its old lists. */
  private readonly filed = new Map<Entity, Filing>();
  /** The passed-by settlers holding a yard route, by the route's flag. */
  private readonly routedTo = new Map<Entity, Set<Entity>>();
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);
  /** List edits so far: a remembered index stays a valid start for a later cursor while this holds
   *  still, so a pass walks forward instead of searching. */
  private edits = 0;
  private readonly actingAt = new ForwardIndex();
  private readonly idleAt = new ForwardIndex();
  private readonly computerIdleAt = new ForwardIndex();
  private aiControlGeneration = -1;
  private aiControlValueGeneration = -1;

  constructor(private readonly world: World) {
    this.feed = world.watchChanges(
      [Settler, Position, Owner, DeliveryFlag, ...RELEASE_IDLE_MEMBERSHIP],
      RELEASE_IDLE_VALUES,
    );
    this.rebuild();
  }

  /**
   * The first settler above `cursor` to visit, caught up first, so one another's plan woke earlier in
   * this pass is still reached in id order. An idler counts when it is due on `idleTick`, or on every
   * tick when that is undefined. With `shelters` on alarm a quiet walker or an idler of an alarmed owner counts too when
   * {@link takesCoverFrom} holds and it has no shelter yet, a walker only while its owner has a place
   * left; each is looked at about once per pass, since a scan stops at the next settler already chosen.
   */
  after(
    cursor: number,
    content: ContentSet,
    shelters: ShelterSites,
    idleTick: number | undefined,
    shelterRoom: ReadonlySet<number>,
  ): Entity | undefined {
    this.catchUp();
    let next = earlier(
      this.acting[this.actingAt.above(this.acting, cursor, this.edits)],
      idleTick === undefined
        ? this.idle[this.idleAt.above(this.idle, cursor, this.edits)]
        : this.firstIdlerDue(cursor, idleTick),
    );
    if (shelters.size === 0) return next;
    for (const owner of shelters.keys()) {
      // A visit between beats only claims a place, so a walker or an idler waits while its owner has none
      // left. One waiting inside a building runs its whole ladder instead, on the room the pass began with.
      const room = shelterHasRoom(shelters, owner);
      if (room) {
        next = this.firstTakingCover(this.travellingByOwner.get(owner), cursor, next, content, shelters);
      }
      if (idleTick !== undefined && (room || shelterRoom.has(owner))) {
        next = this.firstTakingCover(this.idleByOwner.get(owner), cursor, next, content, shelters, !room);
      }
    }
    return next;
  }

  /** The first of `ids` above `cursor` and below `bound` whose owner's cover may draw it and that holds
   *  no shelter yet, else `bound`; with `insideOnly`, only of those waiting inside a building. */
  private firstTakingCover(
    ids: readonly Entity[] | undefined,
    cursor: number,
    bound: Entity | undefined,
    content: ContentSet,
    shelters: ShelterSites,
    insideOnly = false,
  ): Entity | undefined {
    if (ids === undefined) return bound;
    for (let i = indexAboveId(ids, cursor, byId); i < ids.length; i++) {
      const e = ids[i];
      if (e === undefined || (bound !== undefined && e > bound)) break;
      if (this.world.has(e, Sheltering)) continue;
      if (insideOnly && !waitsInside(this.world, e)) continue;
      if (takesCoverFrom(this.world, content, e, shelters)) return e;
    }
    return bound;
  }

  /** The first idler above `cursor` due on `idleTick`, of either cadence. */
  private firstIdlerDue(cursor: number, idleTick: number): Entity | undefined {
    const human = this.idlersOn(idleBeatOfTick(idleTick, IDLE_REPLAN_PERIOD_TICKS));
    const computer = this.idlersOn(
      IDLE_REPLAN_PERIOD_TICKS + idleBeatOfTick(idleTick, COMPUTER_IDLE_REPLAN_PERIOD_TICKS),
    );
    return earlier(
      human[this.idleAt.above(human, cursor, this.edits)],
      computer[this.computerIdleAt.above(computer, cursor, this.edits)],
    );
  }

  private catchUp(): void {
    if (
      this.world.componentGeneration(AiControl) !== this.aiControlGeneration ||
      this.world.componentValueGeneration(AiControl) !== this.aiControlValueGeneration
    ) {
      if (this.feed.pending) this.feed.drain(() => {});
      this.rebuild();
      return;
    }
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
  }

  private refresh(e: Entity): void {
    const positioned = this.world.has(e, Settler) && this.world.has(e, Position);
    const release = positioned ? idleRelease(this.world, e) : undefined;
    const beat = release === 'idle' ? idleSlotOf(this.world, e) : undefined;
    const owner = release === 'travelling' || release === 'idle' ? ownerOf(this.world, e) : undefined;
    const routeFlag = routeFlagOf(this.world, e, release);
    const filing = this.filed.get(e);
    const priorRelease = filing?.release;
    const priorBeat = filing?.beat;
    const priorOwner = filing?.owner;
    // A change to a route's flag re-files the walkers it passes by.
    const routed = this.routedTo.get(e);
    if (routed !== undefined) for (const walker of [...routed]) this.refresh(walker);
    if (routeFlag !== filing?.routeFlag) {
      if (filing?.routeFlag !== undefined) this.unroute(filing.routeFlag, e);
      if (routeFlag !== undefined) this.route(routeFlag, e);
    }
    if (release === priorRelease && beat === priorBeat && owner === priorOwner) {
      if (filing !== undefined) filing.routeFlag = routeFlag;
      return;
    }
    if (release !== priorRelease) {
      if (release === null || priorRelease === null) this.editMember(this.acting, e, release === null);
      if (release === 'idle' || priorRelease === 'idle') this.editMember(this.idle, e, release === 'idle');
    }
    if (beat !== priorBeat) {
      if (priorBeat !== undefined) this.editMember(this.idlersOn(priorBeat), e, false);
      if (beat !== undefined) this.editMember(this.idlersOn(beat), e, true);
    }
    if (owner !== priorOwner || release !== priorRelease) {
      if (priorOwner !== undefined) this.editMember(this.ownerListOf(priorRelease, priorOwner), e, false);
      if (owner !== undefined) this.editMember(this.ownerListOf(release, owner), e, true);
    }
    if (release === undefined) this.filed.delete(e);
    else if (filing === undefined) this.filed.set(e, { release, beat, owner, routeFlag });
    else {
      filing.release = release;
      filing.beat = beat;
      filing.owner = owner;
      filing.routeFlag = routeFlag;
    }
  }

  private route(flag: Entity, e: Entity): void {
    let walkers = this.routedTo.get(flag);
    if (walkers === undefined) {
      walkers = new Set();
      this.routedTo.set(flag, walkers);
    }
    walkers.add(e);
  }

  private unroute(flag: Entity, e: Entity): void {
    const walkers = this.routedTo.get(flag);
    walkers?.delete(e);
    if (walkers?.size === 0) this.routedTo.delete(flag);
  }

  /** Insert `e`, which the filing says `ids` lacks, or remove it, which the filing says `ids` holds. */
  private editMember(ids: Entity[], e: Entity, present: boolean): void {
    if (present) insertSortedById(ids, e, byId);
    else removeSortedById(ids, e, byId);
    this.edits++;
  }

  /** The owner list a walker or idler of `owner` is filed in. */
  private ownerListOf(release: IdleRelease | null | undefined, owner: number): Entity[] {
    return ownerList(release === 'travelling' ? this.travellingByOwner : this.idleByOwner, owner);
  }

  private rebuild(): void {
    this.edits++;
    this.aiControlGeneration = this.world.componentGeneration(AiControl);
    this.aiControlValueGeneration = this.world.componentValueGeneration(AiControl);
    this.acting.length = 0;
    this.idle.length = 0;
    this.travellingByOwner.clear();
    this.idleByOwner.clear();
    this.filed.clear();
    this.routedTo.clear();
    for (const slot of this.idleBySlot) slot.length = 0;
    for (const e of this.world.canonicalQuery(Settler, Position)) {
      const release = idleRelease(this.world, e);
      let beat: number | undefined;
      if (release === null) this.acting.push(e);
      else if (release === 'idle') {
        beat = idleSlotOf(this.world, e);
        this.idle.push(e);
        this.idlersOn(beat).push(e);
      }
      const owner = release === 'travelling' || release === 'idle' ? ownerOf(this.world, e) : undefined;
      const routeFlag = routeFlagOf(this.world, e, release);
      this.filed.set(e, { release, beat, owner, routeFlag });
      if (routeFlag !== undefined) this.route(routeFlag, e);
      if (owner !== undefined) this.ownerListOf(release, owner).push(e);
    }
  }

  private idlersOn(slot: number): Entity[] {
    const idlers = this.idleBySlot[slot];
    if (idlers === undefined) throw new Error(`plannerSweep: no idle slot ${slot}`);
    return idlers;
  }

  verify(): string[] {
    this.catchUp();
    const all = this.world.canonicalQuery(Settler, Position);
    const acting = all.filter((e) => idleRelease(this.world, e) === null);
    const idle = all.filter((e) => idleRelease(this.world, e) === 'idle');
    const problems: string[] = [];
    if (
      this.filed.size !== all.length ||
      all.some((e) => this.filed.get(e)?.release !== idleRelease(this.world, e))
    )
      problems.push('plannerSweep filed releases diverge from a fresh scan');
    if (!sameIds(acting, this.acting))
      problems.push('plannerSweep acting settlers diverge from a fresh scan');
    if (!sameIds(idle, this.idle)) problems.push('plannerSweep idlers diverge from a fresh scan');
    this.idleBySlot.forEach((ids, slot) => {
      const fresh = idle.filter((e) => idleSlotOf(this.world, e) === slot);
      if (!sameIds(fresh, ids))
        problems.push(`plannerSweep idlers on slot ${slot} diverge from a fresh scan`);
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
    const routed = all.filter((e) => routeFlagOf(this.world, e, idleRelease(this.world, e)) !== undefined);
    if (
      routed.length !== [...this.routedTo.values()].reduce((n, walkers) => n + walkers.size, 0) ||
      routed.some((e) => !this.routedTo.get(this.world.get(e, YardDeliveryRoute).flag)?.has(e))
    ) {
      problems.push('plannerSweep yard-route walkers by flag diverge from a fresh scan');
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

/** The flag of `e`'s yard route when the sweep passes `e` by under `release`, else undefined. */
function routeFlagOf(world: World, e: Entity, release: IdleRelease | null | undefined): Entity | undefined {
  return release === null || release === undefined ? undefined : world.tryGet(e, YardDeliveryRoute)?.flag;
}

function earlier(a: Entity | undefined, b: Entity | undefined): Entity | undefined {
  if (a === undefined) return b;
  return b === undefined || a < b ? a : b;
}

/** Where {@link SweepCandidates} files one positioned settler: its release, and its idle slot and
 *  owner where its release files it by them, and the flag of a yard route it is passed by with. */
interface Filing {
  release: IdleRelease | null;
  beat: number | undefined;
  owner: number | undefined;
  routeFlag: Entity | undefined;
}

/** An index into one ascending-id list remembered between asks: while the list holds still and the
 *  cursor does not fall below the remembered answer, the next answer is a forward walk from it. */
class ForwardIndex {
  private list: readonly Entity[] | undefined;
  private at = 0;
  private edits = -1;

  /** The index of the first id in `list` above `cursor`; `edits` is the owner's count of list edits. */
  above(list: readonly Entity[], cursor: number, edits: number): number {
    let at = this.at;
    const previous = list[at - 1];
    if (this.list !== list || this.edits !== edits || (previous !== undefined && previous > cursor)) {
      at = indexAboveId(list, cursor, byId);
    } else {
      while ((list[at] ?? Number.POSITIVE_INFINITY) <= cursor) at++;
    }
    this.list = list;
    this.at = at;
    this.edits = edits;
    return at;
  }
}

function sameIds(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((e, i) => b[i] === e);
}

const candidates = new WeakMap<World, SweepCandidates>();

/**
 * The settlers the planner sweep visits this pass, in ascending id, read live between visits: the
 * ones whose {@link releaseStaleIntent} may change something, and the idlers due on `idleTick`, or all
 * of them when that is undefined. The pass's claim maps hand out targets first come, first served, so
 * this order decides who wins. Only settlers positioned when the sweep starts take part; a settler
 * never loses either component while alive, so one created mid-pass is the only newcomer.
 */
export function sweepOrder(
  world: World,
  content: ContentSet,
  shelters: ShelterSites,
  idleTick: number | undefined,
  /** {@link ownersWithShelterRoom} of `shelters` as the pass began. */
  shelterRoom: ReadonlySet<number>,
): PlannerSweep {
  let held = candidates.get(world);
  if (held === undefined) {
    const created = new SweepCandidates(world);
    world.registerCacheVerifier('plannerSweep', () => created.verify());
    candidates.set(world, created);
    held = created;
  }
  return new PlannerSweep(held, content, shelters, idleTick, shelterRoom, world.nextEntityId);
}

/** A cursor over {@link sweepOrder}'s settlers: a pass asks for the next one after each visit, so the
 *  walk allocates nothing per settler. */
class PlannerSweep {
  private cursor = 0;
  private done = false;

  constructor(
    private readonly held: SweepCandidates,
    private readonly content: ContentSet,
    private readonly shelters: ShelterSites,
    private readonly idleTick: number | undefined,
    private readonly shelterRoom: ReadonlySet<number>,
    private readonly createdMidPass: number,
  ) {}

  /** The next settler to visit, or undefined once the sweep is over. */
  next(): Entity | undefined {
    if (this.done) return undefined;
    const e = this.held.after(this.cursor, this.content, this.shelters, this.idleTick, this.shelterRoom);
    if (e === undefined || e >= this.createdMidPass) {
      this.done = true;
      return undefined;
    }
    this.cursor = e;
    return e;
  }
}
