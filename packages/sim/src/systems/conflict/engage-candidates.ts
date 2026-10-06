import type { ContentSet } from '@open-northland/data';
import { Health, Position, Settler, settlerTradeLog } from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { presenceBound, READY_MEMBERSHIP, READY_VALUES, readyAnywhere } from './acting.js';
import { isCombatant } from './combat-grid.js';
import type { CombatIndex } from './combat-index.js';

/**
 * The combatants {@link readyAnywhere} passes, kept per world from a change feed over the stores it reads,
 * so a pass costs the units whose state changed rather than every combatant. Derived state, never hashed;
 * the registered verifier re-derives it.
 */
class ReadyUnits {
  private readonly ready = new Set<Entity>();
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
      if (!pending.has(e) && readyAnywhere(world, this.content, e) !== this.ready.has(e)) {
        return [`combatReadyUnits holds a stale entry for ${e} - it changed without a feed entry`];
      }
    }
    for (const e of this.ready) {
      if (!pending.has(e) && !isCombatant(world, e))
        return [`combatReadyUnits still holds ${e}, no longer a combatant`];
    }
    return [];
  }

  private place(world: World, e: Entity): void {
    if (isCombatant(world, e) && readyAnywhere(world, this.content, e)) this.ready.add(e);
    else this.ready.delete(e);
  }

  private rebuild(world: World): void {
    this.ready.clear();
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
 * The combatants a combat pass asks `mayEngage` about, in ascending id: the owned units near a stranger and
 * the kept ready set. Every other combatant proves `mayEngage` false. Read after the queued alarms are
 * answered, since an alarm hands its answerers ladder state.
 */
export function engageCandidates(world: World, ctx: SystemContext, index: CombatIndex): readonly Entity[] {
  const scratch = candidateScratchOf(world);
  const { candidates } = scratch;
  let count = index.unitsNearStrangers(presenceBound(ctx.content), candidates, 0);
  readyUnitsOf(world, ctx.content)
    .sync(world)
    .forEach((e) => {
      candidates[count++] = e;
    });
  // A typed array sorts numerically without a comparator call per compare.
  if (scratch.sorted.length < count)
    scratch.sorted = new Uint32Array(Math.max(count, 2 * scratch.sorted.length));
  const sorted = scratch.sorted.subarray(0, count);
  for (let i = 0; i < count; i++) sorted[i] = candidates[i] as Entity;
  sorted.sort();
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const id = sorted[i] as Entity;
    if (kept === 0 || candidates[kept - 1] !== id) candidates[kept++] = id;
  }
  candidates.length = kept;
  return candidates;
}

/** The buffers one pass's candidate list is gathered and sorted in, reused across passes: the returned
 *  list lives until the next pass asks. */
interface CandidateScratch {
  readonly candidates: Entity[];
  sorted: Uint32Array;
}

/** Ids the sort buffer holds before its first growth. */
const INITIAL_SORT_CAPACITY = 256;

const candidateScratches = new WeakMap<World, CandidateScratch>();

function candidateScratchOf(world: World): CandidateScratch {
  let scratch = candidateScratches.get(world);
  if (scratch === undefined) {
    scratch = { candidates: [], sorted: new Uint32Array(INITIAL_SORT_CAPACITY) };
    candidateScratches.set(world, scratch);
  }
  return scratch;
}
