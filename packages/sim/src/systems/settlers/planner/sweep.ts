import type { ContentSet } from '@open-northland/data';
import {
  Age,
  AiControl,
  DeliveryFlag,
  HaulFlag,
  IdleStand,
  LostWay,
  Owner,
  ownerOf,
  Position,
  Settler,
  Sheltering,
  YardDeliveryRoute,
} from '../../../components/index.js';
import { indexAboveId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { ContentContext } from '../../context.js';
import type { ShelterSites } from '../../defence/index.js';
import { cutOffCheckMayAct } from '../drives/cut-off.js';
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
 * re-plan beat, alarm or cut-off check, also split by {@link idleSlotOf} and by owner, and
 * `checkedLists` those of them their seat's cut-off check tick may do something for
 * ({@link checkedOnCutOff}). The owner split lets an alarm scan only its owner's settlers. Kept across ticks per world from a change feed,
 * which also watches the flags of the yard routes passed by, since losing one makes its walkers act, and
 * rebuilt when the seats' AiControl moves, which picks each idler's period.
 */
class SweepCandidates {
  private readonly acting: Entity[] = [];
  private readonly travellingByOwner = new Map<number, Entity[]>();
  private readonly idleByOwner = new Map<number, Entity[]>();
  /** One list per owner in {@link checkedOwners}, {@link NO_OWNER} for the unowned idlers: parallel
   *  arrays, so the walk per visit allocates nothing. */
  private readonly checkedLists: Entity[][] = [];
  private readonly checkedOwners: number[] = [];
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

  private readonly ctx: ContentContext;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
  ) {
    this.ctx = { content };
    this.feed = world.watchChanges(
      [Settler, Position, Owner, Age, DeliveryFlag, LostWay, HaulFlag, ...RELEASE_IDLE_MEMBERSHIP],
      RELEASE_IDLE_VALUES,
    );
    this.rebuild();
  }

  /**
   * The first settler above `cursor` to visit, caught up first, so one another's plan woke earlier in
   * this pass is still reached in id order. An idler counts when it is due on `tick`, and when its
   * seat's cut-off check is due (`checkDue`) and may do something for it. With `shelters` on alarm a quiet walker or
   * an idler of an alarmed owner counts too when
   * {@link takesCoverFrom} holds and it has no shelter yet, a walker only while its owner has a place
   * left; each is looked at about once per pass, since a scan stops at the next settler already chosen.
   */
  after(
    cursor: number,
    shelters: ShelterSites,
    /** The owners of `shelters`, listed once per pass so a visit walks them without an iterator. */
    alarmed: readonly number[],
    tick: number,
    checkDue: (owner: number | undefined) => boolean,
    shelterRoom: ReadonlySet<number>,
  ): Entity | undefined {
    this.catchUp();
    const { content } = this;
    let next = earlier(
      this.acting[this.actingAt.above(this.acting, cursor, this.edits)],
      this.firstIdlerDue(cursor, tick),
    );
    for (let i = 0; i < this.checkedOwners.length; i++) {
      const owner = this.checkedOwners[i];
      const ids = this.checkedLists[i];
      if (ids === undefined || ids.length === 0 || !checkDue(owner === NO_OWNER ? undefined : owner))
        continue;
      next = earlier(next, ids[indexAboveId(ids, cursor, byId)]);
    }
    for (let i = 0; i < alarmed.length; i++) {
      const owner = alarmed[i] as number;
      // A visit between beats only claims a place, so a walker or an idler waits while its owner has none
      // left. One waiting inside a building runs its whole ladder instead, on the room the pass began with.
      const room = shelterHasRoom(shelters, owner);
      if (room) {
        next = this.firstTakingCover(this.travellingByOwner.get(owner), cursor, next, content, shelters);
      }
      if (room || shelterRoom.has(owner)) {
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

  /** The first idler above `cursor` due on `tick`, of either cadence. */
  private firstIdlerDue(cursor: number, tick: number): Entity | undefined {
    const human = this.idlersOn(idleBeatOfTick(tick, IDLE_REPLAN_PERIOD_TICKS));
    const computer = this.idlersOn(
      IDLE_REPLAN_PERIOD_TICKS + idleBeatOfTick(tick, COMPUTER_IDLE_REPLAN_PERIOD_TICKS),
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
    const checked = release === 'idle' && checkedOnCutOff(this.world, this.ctx, e);
    const owner = release === 'travelling' || release === 'idle' ? ownerOf(this.world, e) : undefined;
    const routeFlag = routeFlagOf(this.world, e, release);
    const filing = this.filed.get(e);
    const priorRelease = filing?.release;
    const priorBeat = filing?.beat;
    const priorOwner = filing?.owner;
    const priorChecked = filing?.checked === true;
    if (checked !== priorChecked || (checked && owner !== priorOwner)) {
      if (priorChecked) this.editMember(this.checkedOf(priorOwner), e, false);
      if (checked) this.editMember(this.checkedOf(owner), e, true);
      if (filing !== undefined) filing.checked = checked;
    }
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
    else if (filing === undefined) this.filed.set(e, { release, beat, owner, routeFlag, checked });
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
    this.checkedLists.length = 0;
    this.checkedOwners.length = 0;
    this.travellingByOwner.clear();
    this.idleByOwner.clear();
    this.filed.clear();
    this.routedTo.clear();
    for (const slot of this.idleBySlot) slot.length = 0;
    for (const e of this.world.canonicalQuery(Settler, Position)) {
      const release = idleRelease(this.world, e);
      let beat: number | undefined;
      let checked = false;
      if (release === null) this.acting.push(e);
      else if (release === 'idle') {
        beat = idleSlotOf(this.world, e);
        checked = checkedOnCutOff(this.world, this.ctx, e);
        this.idlersOn(beat).push(e);
      }
      const owner = release === 'travelling' || release === 'idle' ? ownerOf(this.world, e) : undefined;
      if (checked) this.checkedOf(owner).push(e);
      const routeFlag = routeFlagOf(this.world, e, release);
      this.filed.set(e, { release, beat, owner, routeFlag, checked });
      if (routeFlag !== undefined) this.route(routeFlag, e);
      if (owner !== undefined) this.ownerListOf(release, owner).push(e);
    }
  }

  /** The idlers of `owner`'s seat its cut-off check may act for. */
  private checkedOf(owner: number | undefined): Entity[] {
    const key = owner ?? NO_OWNER;
    let at = this.checkedOwners.indexOf(key);
    if (at < 0) {
      at = this.checkedOwners.push(key) - 1;
      this.checkedLists.push([]);
    }
    return this.checkedLists[at] as Entity[];
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
    const checked = new Map<number, Entity[]>();
    for (const e of idle) {
      if (checkedOnCutOff(this.world, this.ctx, e)) {
        ownerList(checked, ownerOf(this.world, e) ?? NO_OWNER).push(e);
      }
    }
    const held = new Map(this.checkedOwners.map((owner, i) => [owner, this.checkedLists[i] ?? []]));
    if (!sameOwnerLists(checked, held)) {
      problems.push('plannerSweep idlers on the cut-off check diverge from a fresh scan');
    }
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

/** The key an unowned idler's cut-off list is filed under. */
const NO_OWNER = -1;

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

/**
 * Whether its seat's cut-off check tick may do something for idler `e` off its beat: it stands on the short
 * beat, whose whole ladder runs on that tick, or it stands in the idle tail and
 * {@link cutOffCheckMayAct}. Reads only IdleStand, re-added whenever its fields change, the settler's
 * trade and markers whose membership the sweep watches.
 */
function checkedOnCutOff(world: World, ctx: ContentContext, e: Entity): boolean {
  const stand = world.tryGet(e, IdleStand);
  if (stand === undefined) return false;
  return stand.shortBeat === true || (stand.standing && cutOffCheckMayAct(world, ctx, e));
}

function earlier(a: Entity | undefined, b: Entity | undefined): Entity | undefined {
  if (a === undefined) return b;
  return b === undefined || a < b ? a : b;
}

/** Where {@link SweepCandidates} files one positioned settler: its release, and its idle slot and
 *  owner where its release files it by them, the flag of a yard route it is passed by with, and whether
 *  it is an idler {@link checkedOnCutOff}. */
interface Filing {
  release: IdleRelease | null;
  beat: number | undefined;
  owner: number | undefined;
  routeFlag: Entity | undefined;
  checked: boolean;
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
 * ones whose {@link releaseStaleIntent} may change something, the idlers due on `tick`, and the idlers
 * their seat's cut-off check, due by `checkDue`, may do something for. The pass's claim maps hand out targets
 * first come, first served, so this order decides who wins. Only settlers positioned when the sweep
 * starts take part; a settler never loses either component while alive, so one created mid-pass is the
 * only newcomer.
 */
export function sweepOrder(
  world: World,
  content: ContentSet,
  shelters: ShelterSites,
  tick: number,
  checkDue: (owner: number | undefined) => boolean,
  /** {@link ownersWithShelterRoom} of `shelters` as the pass began. */
  shelterRoom: ReadonlySet<number>,
): PlannerSweep {
  let held = candidates.get(world);
  if (held === undefined || held.content !== content) {
    const created = new SweepCandidates(world, content);
    if (held === undefined) world.registerCacheVerifier('plannerSweep', () => verifySweep(world));
    candidates.set(world, created);
    held = created;
  }
  return new PlannerSweep(held, shelters, tick, checkDue, shelterRoom, world.nextEntityId);
}

function verifySweep(world: World): string[] {
  return candidates.get(world)?.verify() ?? [];
}

const NO_OWNERS: readonly number[] = [];

/** A cursor over {@link sweepOrder}'s settlers: a pass asks for the next one after each visit, so the
 *  walk allocates nothing per settler. */
class PlannerSweep {
  private cursor = 0;
  private done = false;
  private readonly alarmed: readonly number[];

  constructor(
    private readonly held: SweepCandidates,
    private readonly shelters: ShelterSites,
    private readonly tick: number,
    private readonly checkDue: (owner: number | undefined) => boolean,
    private readonly shelterRoom: ReadonlySet<number>,
    private readonly createdMidPass: number,
  ) {
    this.alarmed = shelters.size === 0 ? NO_OWNERS : [...shelters.keys()];
  }

  /** The next settler to visit, or undefined once the sweep is over. */
  next(): Entity | undefined {
    if (this.done) return undefined;
    const e = this.held.after(
      this.cursor,
      this.shelters,
      this.alarmed,
      this.tick,
      this.checkDue,
      this.shelterRoom,
    );
    if (e === undefined || e >= this.createdMidPass) {
      this.done = true;
      return undefined;
    }
    this.cursor = e;
    return e;
  }
}
