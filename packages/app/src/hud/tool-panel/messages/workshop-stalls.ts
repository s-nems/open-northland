import {
  type GatheringTrade,
  groupedBy,
  indexesOf,
  TICKS_PER_SECOND,
  type WorkStatus,
  type WorldSnapshot,
} from '@open-northland/sim';
import { workerRoleOf } from '../../../game/sandbox/index.js';
import {
  buildingTypeOf,
  isBuilding,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  staffOf,
  supplyRunsTo,
} from '../../../game/snapshot.js';
import { type MessageNaming, type MessageRaiser, nodeOf } from './raise.js';
import { type ProductionStall, type ProductionStallReason, USER_MESSAGE_TYPE } from './types.js';
import type { WorkStatusAsks, WorkStatusRead } from './work-asks.js';

/**
 * Ticks a workshop stands - no cycle, nobody fetching for it or carrying a load off it - before its
 * operator's diagnosis is weighed: about an operator's longest ordinary pause, the walk back from a
 * store at the edge of its signpost reach (25 cells at 18 ticks a cell) and an idle beat before its next
 * errand. Ordinary pauses then cost no ask, and a blocker that clears within it raises nothing.
 * Approximation.
 */
export const PRODUCTION_STALL_GRACE_TICKS = 45 * TICKS_PER_SECOND;

/** What the stall notes read about the seat's workshops, and the idle notes about their workers. */
export interface WorkshopSeam {
  /** The building types that craft from recipes. */
  readonly types: readonly number[];
  readonly workStatus: WorkStatusRead;
}

/** Whether a workshop's stall stands, and why: undefined while not swept yet, null for none. */
export type StallVerdict = ProductionStall | null | undefined;

/** Read side for the retire rules. */
export interface StallReader {
  verdict(building: number): StallVerdict;
  /** Whether the workshop runs no cycle, whether or not a stall was found: its staff's idle notes then
   *  leave the word to the stall note. */
  isResting(workplace: number): boolean;
}

const OWNER_KEY_SPAN = 1 << 16;

function restingKey(owner: number, type: number): number {
  return owner * OWNER_KEY_SPAN + type;
}

/** Finished buildings running no production cycle, by owner and type. The sim keeps `Production` only
 *  while a cycle runs, so a workshop enters and leaves this index per change, not per sweep. */
const RESTING_BUILDINGS = groupedBy(
  (e) => {
    const c = e.components;
    if (!isBuilding(e) || c.Production !== undefined || c.UnderConstruction !== undefined) return undefined;
    const type = buildingTypeOf(e);
    const owner = ownerPlayerOf(e);
    return type === undefined || owner === undefined ? undefined : restingKey(owner, type);
  },
  'resting buildings by owner and type',
  { values: ['Building', 'Owner'], presence: ['Production', 'UnderConstruction'] },
);

const NO_BUILDINGS: readonly SnapshotEntity[] = [];

/** The `owner`'s finished buildings of `type` running no production cycle. */
export function restingBuildingsOf(
  snapshot: WorldSnapshot,
  owner: number,
  type: number,
): readonly SnapshotEntity[] {
  return indexesOf(snapshot).get(RESTING_BUILDINGS).get(restingKey(owner, type)) ?? NO_BUILDINGS;
}

/** The reason an input only a trade gathers names when nobody gathers it: the trade to assign. */
const NO_GATHERER: Readonly<Record<GatheringTrade, ProductionStallReason>> = {
  collector: 'noCollector',
  hunter: 'noHunter',
  fisher: 'noFisher',
};

/**
 * The blocker a worker's diagnosis names, or null when it names none the player has to fix: an input
 * that a store, a producer or a gatherer in reach supplies, or a full shelf a store in reach takes from,
 * is the operator's own errand. A blocker is an input nothing of the seat holds, makes or gathers, or
 * only out of signpost reach; products no store takes, or only stores out of reach; products the seat
 * cannot make yet; a herd short of a breeding pair; or a gate the diagnosis cannot name.
 */
export function stallOf(status: WorkStatus): ProductionStall | null {
  switch (status.kind) {
    case 'waitingInput': {
      const stranded = status.missingInputs.find((input) => input.source === 'outOfReach');
      if (stranded !== undefined) return { reason: 'inputOutOfReach', goodType: stranded.goodType };
      const unsourced = status.missingInputs.find((input) => input.source === 'none');
      if (unsourced === undefined) return null;
      const reason = unsourced.gatheredBy === null ? 'noInputSource' : NO_GATHERER[unsourced.gatheredBy];
      return { reason, goodType: unsourced.goodType };
    }
    case 'outputFull': {
      // One product a store takes frees its own shelf, and the rotation makes it again.
      if (status.outputs.some((output) => output.destination !== 'none')) return null;
      return { reason: 'noOutputStore', goodType: status.outputs[0]?.goodType ?? null };
    }
    case 'noOutputDestination':
      if (status.reason === 'outOfReach') return { reason: 'outputOutOfReach', goodType: status.goodType };
      return status.reason === 'noStorage' ? { reason: 'noOutputStore', goodType: status.goodType } : null;
    case 'productsLocked':
      return { reason: 'productsLocked', goodType: status.goodTypes[0] ?? null };
    case 'herdNotReady':
      // Young growing up and a full herd waiting for them clear by themselves; missing animals do not.
      if (status.wait === 'noAnimals') return { reason: 'noLivestock', goodType: status.goodType };
      return status.wait === 'tooFew' ? { reason: 'tooFewLivestock', goodType: status.goodType } : null;
    case 'unknown':
      return status.reason === 'productionGate' ? { reason: 'unknown', goodType: null } : null;
    default:
      return null;
  }
}

/** One resting workshop's watch: since when it stands, and the verdict. */
interface Watch {
  since: number;
  verdict: StallVerdict;
}

/** Whether a settler is under way with goods: carrying a load, or walking out on a supply errand. */
function isUnderWay(settler: SnapshotEntity): boolean {
  const c = settler.components;
  return (
    c.Carrying !== undefined ||
    c.MoveGoal !== undefined ||
    c.PathRequest !== undefined ||
    c.PathFollow !== undefined
  );
}

/**
 * Whether goods move for a resting workshop: a settler on a supply errand to it is under way, or one of
 * its staff carries a load, as an operator taking its products to a store does, or is taking up a
 * harvest, as its own collector walking to a tree and felling it is.
 */
function goodsMoveFor(snapshot: WorldSnapshot, workshop: number, staff: readonly SnapshotEntity[]): boolean {
  return (
    supplyRunsTo(snapshot, workshop).some(isUnderWay) ||
    staff.some(
      (worker) => worker.components.Carrying !== undefined || worker.components.HarvestFocus !== undefined,
    )
  );
}

/** The craftsman whose diagnosis speaks for the craft; a collector or carrier posted there only serves it. */
function operatorOf(staff: readonly SnapshotEntity[]): SnapshotEntity | undefined {
  return staff.find((worker) => {
    const job = settlerJobType(worker);
    return job !== undefined && workerRoleOf(job) === 'craftsman';
  });
}

/**
 * The seat's workshops that stand still for a blocker the player has to fix. A workshop stands while it
 * runs no cycle and no goods move for it; once it has stood {@link PRODUCTION_STALL_GRACE_TICKS}, the
 * sim's diagnosis of its operator names the blocker, if any. Goods moving again, a cycle, or a diagnosis
 * with nothing in the way ends the verdict, which retires the note. A sweep visits the seat's resting
 * workshops off a maintained index, so its cost follows those, not the building count. A workshop
 * without an operator is never stalled: nobody was hired, which its panel shows. A crew building a
 * vehicle on its yard site runs no cycle, but is working, so its stand starts over.
 */
export class WorkshopStalls implements StallReader {
  private watched = new Map<number, Watch>();
  private swept = false;

  constructor(
    private readonly seat: number,
    private readonly types: readonly number[],
    private readonly asks: WorkStatusAsks,
  ) {}

  /** Judge the resting workshops and raise a note for each one stalled. */
  sweep(snapshot: WorldSnapshot, raiser: MessageRaiser, naming: MessageNaming): void {
    const next = new Map<number, Watch>();
    for (const type of this.types) {
      for (const workshop of restingBuildingsOf(snapshot, this.seat, type)) {
        const watch = this.watched.get(workshop.id) ?? { since: snapshot.tick, verdict: undefined };
        next.set(workshop.id, watch);
        this.judge(snapshot, workshop, watch);
        if (watch.verdict !== null && watch.verdict !== undefined) {
          raiseStall(raiser, naming, workshop, watch.verdict);
        }
      }
    }
    this.watched = next;
    this.swept = true;
  }

  verdict(building: number): StallVerdict {
    const watch = this.watched.get(building);
    if (watch !== undefined) return watch.verdict;
    return this.swept ? null : undefined;
  }

  isResting(workplace: number): boolean {
    return this.watched.has(workplace);
  }

  private judge(snapshot: WorldSnapshot, workshop: SnapshotEntity, watch: Watch): void {
    const staff = staffOf(snapshot, workshop.id);
    const working =
      staff.some((worker) => worker.components.SiteAssignment !== undefined) ||
      goodsMoveFor(snapshot, workshop.id, staff);
    if (working) {
      watch.since = snapshot.tick;
      watch.verdict = null;
      return;
    }
    // A workshop not yet judged keeps an undefined verdict, so a note restored from an earlier mount stands.
    if (snapshot.tick - watch.since < PRODUCTION_STALL_GRACE_TICKS) return;
    const operator = operatorOf(staff);
    if (operator === undefined) {
      watch.verdict = null;
      return;
    }
    // No answer yet keeps the verdict; a diagnosis with nothing in the way is no stall.
    const answer = this.asks.status(operator.id);
    if (answer !== undefined) watch.verdict = answer.status === undefined ? null : stallOf(answer.status);
  }
}

/** Raise the note about one stalled workshop, keyed by the building and the reason: a new reason is a
 *  new note, while a new good under the same reason rewords the standing one. */
export function raiseStall(
  raiser: MessageRaiser,
  naming: MessageNaming,
  workshop: SnapshotEntity,
  stall: ProductionStall,
): void {
  const type = USER_MESSAGE_TYPE.productionStalled;
  raiser.raise(
    `${type}|building:${workshop.id}`,
    {
      type,
      subject: { kind: 'building', entity: workshop.id },
      at: nodeOf(workshop),
      about: null,
      goodType: stall.goodType,
      technologies: null,
      jobType: null,
      stall,
    },
    () =>
      naming.text(type, {
        subjectName: naming.building(workshop),
        jobLabel: null,
        goodName: stall.goodType === null ? null : (naming.technology('good', stall.goodType) ?? null),
        stanceName: null,
        stall: stall.reason,
      }),
    true,
  );
}
