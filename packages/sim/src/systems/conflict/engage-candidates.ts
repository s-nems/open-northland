import type { ContentSet } from '@open-northland/data';
import { Health, Position, Settler, settlerTradeLog } from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import {
  PRESENCE_RADIUS,
  READY_MEMBERSHIP,
  READY_VALUES,
  readyAnywhere,
  searchesPastPresence,
} from './acting.js';
import { isCombatant } from './combat-grid.js';
import type { CombatIndex } from './combat-index.js';
import { EpochMarks } from './epoch-marks.js';

/**
 * The combatants {@link readyAnywhere} passes, and those {@link searchesPastPresence} names (`wide`), kept
 * per world from a change feed over the stores both read, so a pass costs the units whose state changed
 * rather than every combatant. Derived state, never hashed; the registered verifier re-derives it.
 */
class ReadyUnits {
  private readonly ready = new Set<Entity>();
  readonly wide = new Set<Entity>();
  /** Whether the set was ever built; until then the feed's entries describe nothing held. */
  private built = false;

  /** The settlers whose job changed since the last sync. */
  private readonly jobChanges: Set<Entity>;

  constructor(
    world: World,
    readonly content: ContentSet,
    private readonly feed: ChangeFeed,
  ) {
    this.jobChanges = settlerTradeLog(world, 'combatReady');
  }

  sync(world: World): ReadonlySet<Entity> {
    if (!this.built || this.feed.drain((e) => this.place(world, e))) {
      this.feed.drain(() => {});
      this.rebuild(world);
    } else {
      // forEach rather than for-of: a Set iterator hands out a result object per member.
      this.jobChanges.forEach((e) => {
        this.place(world, e);
      });
    }
    this.jobChanges.clear();
    return this.ready;
  }

  verify(world: World): string[] {
    if (!this.built) return [];
    const pending = new Set<Entity>(this.jobChanges);
    if (this.feed.peek((e) => pending.add(e))) return [];
    for (const e of world.query(Settler, Health, Position)) {
      if (pending.has(e)) continue;
      if (
        readyAnywhere(world, this.content, e) !== this.ready.has(e) ||
        searchesPastPresence(world, this.content, e) !== this.wide.has(e)
      ) {
        return [`combatReadyUnits holds a stale entry for ${e} - it changed without a feed entry`];
      }
    }
    for (const held of [this.ready, this.wide]) {
      for (const e of held) {
        if (!pending.has(e) && !isCombatant(world, e))
          return [`combatReadyUnits still holds ${e}, no longer a combatant`];
      }
    }
    return [];
  }

  private place(world: World, e: Entity): void {
    const combatant = isCombatant(world, e);
    if (combatant && readyAnywhere(world, this.content, e)) this.ready.add(e);
    else this.ready.delete(e);
    if (combatant && searchesPastPresence(world, this.content, e)) this.wide.add(e);
    else this.wide.delete(e);
  }

  private rebuild(world: World): void {
    this.ready.clear();
    this.wide.clear();
    for (const e of world.query(Settler, Health, Position)) this.place(world, e);
    this.built = true;
  }
}

const readySets = new WeakMap<World, ReadyUnits>();

function readyUnitsOf(world: World, content: ContentSet): ReadyUnits {
  const held = readySets.get(world);
  if (held !== undefined && held.content === content) return held;
  const ready = new ReadyUnits(world, content, world.watchChanges(READY_MEMBERSHIP, READY_VALUES));
  readySets.set(world, ready);
  world.registerCacheVerifier('combatReadyUnits', () => readySets.get(world)?.verify(world) ?? []);
  return ready;
}

/**
 * The combatants a combat pass asks `mayEngage` about, in ascending id: the owned units near a stranger
 * within {@link PRESENCE_RADIUS}, the units searching past it, and the kept ready set. Every other
 * combatant proves `mayEngage` false. Read after the queued alarms are answered, since an alarm hands its
 * answerers ladder state.
 */
export function engageCandidates(world: World, ctx: SystemContext, index: CombatIndex): EngageCandidates {
  const scratch = candidateScratchOf(world);
  // Gathered unsorted, with repeats; never shrunk, so a pass grows it only past the longest one before.
  const { gathered } = scratch;
  const units = readyUnitsOf(world, ctx.content);
  const ready = units.sync(world);
  let count = index.unitsNearStrangers(PRESENCE_RADIUS, gathered, 0);
  units.wide.forEach((e) => {
    gathered[count++] = e;
  });
  scratch.markNear(count);
  ready.forEach((e) => {
    gathered[count++] = e;
  });
  // A typed array sorts numerically without a comparator call per compare.
  if (scratch.sorted.length < count)
    scratch.sorted = new Uint32Array(Math.max(count, 2 * scratch.sorted.length));
  const { sorted } = scratch;
  for (let i = 0; i < count; i++) sorted[i] = gathered[i] as Entity;
  sorted.subarray(0, count).sort();
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const id = sorted[i] as number;
    if (kept === 0 || sorted[kept - 1] !== id) sorted[kept++] = id;
  }
  scratch.count = kept;
  return scratch;
}

/** One pass's candidates, and which of them the index listed near a stranger. Lives until the next pass. */
export interface EngageCandidates {
  /** How many candidates the pass holds. */
  readonly count: number;
  /** The `i`th candidate, ascending by id. */
  candidateAt(i: number): Entity;
  /** Whether owned unit `e` needs its presence test run: the index listed it near a stranger, or it searches
   *  past {@link PRESENCE_RADIUS}. One in a player slot not listed proves every `othersWithin` test false. */
  nearStranger(e: Entity): boolean;
}

/** Ids the sort buffer holds before its first growth. */
const INITIAL_SORT_CAPACITY = 256;

/** The buffers one pass's candidate list is gathered and sorted in, reused across passes. */
class CandidateScratch implements EngageCandidates {
  readonly gathered: Entity[] = [];
  /** The pass's candidates in their first {@link count} slots, ascending and distinct. */
  sorted = new Uint32Array(INITIAL_SORT_CAPACITY);
  count = 0;
  /** The units whose presence test the running pass runs. */
  private readonly near = new EpochMarks();

  /** Mark the first `count` gathered units, those whose presence test runs, for this pass. */
  markNear(count: number): void {
    this.near.begin();
    for (let i = 0; i < count; i++) this.near.mark(this.gathered[i] as Entity);
  }

  candidateAt(i: number): Entity {
    return this.sorted[i] as Entity;
  }

  nearStranger(e: Entity): boolean {
    return this.near.has(e);
  }
}

const candidateScratches = new WeakMap<World, CandidateScratch>();

function candidateScratchOf(world: World): CandidateScratch {
  let scratch = candidateScratches.get(world);
  if (scratch === undefined) {
    scratch = new CandidateScratch();
    candidateScratches.set(world, scratch);
  }
  return scratch;
}
