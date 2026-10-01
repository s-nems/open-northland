import {
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
} from '../../../game/snapshot.js';
import { type MessageNaming, type MessageRaiser, nodeOf } from './raise.js';
import { type ProductionStall, USER_MESSAGE_TYPE } from './types.js';

/** Ticks a workshop runs no production cycle before its stall note: long enough for an operator to
 *  fetch inputs or carry products off between two cycles of fifteen seconds. Approximation. */
export const PRODUCTION_STALL_GRACE_TICKS = 60 * TICKS_PER_SECOND;

/** What the stall notes read about the seat's workshops, and the idle notes about their workers. */
export interface WorkshopSeam {
  /** The building types that craft from recipes. */
  readonly types: readonly number[];
  /** The sim's diagnosis of a worker (`Simulation.workStatus`) as the host last answered it; undefined
   *  while unanswered and while nothing stands in the worker's way. */
  readonly workStatus: (entity: number) => WorkStatus | undefined;
}

/** Whether a workshop's stall stands, and why: undefined while not swept yet, null for none. */
export type StallVerdict = ProductionStall | null | undefined;

/** Read side for the retire rules. */
export interface StallReader {
  verdict(building: number): StallVerdict;
  /** Whether a note about one of the workshop's operators standing idle leaves the word to the stall
   *  note: true while the workshop runs no cycle, whether or not a stall was found. */
  holdsIdleNote(workplace: number): boolean;
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

/**
 * The stall a worker's diagnosis names, or null when it names none: a cycle that can start, products
 * the player stopped, or a status about anything but a craft.
 */
export function stallOf(status: WorkStatus): ProductionStall | null {
  switch (status.kind) {
    case 'waitingInput': {
      const stranded = status.missingInputs.find((input) => input.outOfReach);
      if (stranded !== undefined) return { reason: 'inputOutOfReach', goodType: stranded.goodType };
      return { reason: 'missingInput', goodType: status.missingInputs[0]?.goodType ?? null };
    }
    case 'outputFull':
      return { reason: 'outputFull', goodType: status.outputs[0]?.goodType ?? null };
    case 'noOutputDestination':
      return {
        reason: status.reason === 'outOfReach' ? 'outputOutOfReach' : 'outputFull',
        goodType: status.goodType,
      };
    case 'productsLocked':
      return { reason: 'productsLocked', goodType: status.goodTypes[0] ?? null };
    case 'unknown':
      return status.reason === 'productionGate' ? { reason: 'unknown', goodType: null } : null;
    default:
      return null;
  }
}

/** One resting workshop's watch: since when it rests, whose diagnosis was asked, and the verdict. */
interface Watch {
  since: number;
  asked: number | null;
  verdict: StallVerdict;
}

/** Prefer an operator's diagnosis to a carrier's, as the building panel does. */
function operatorOf(staff: readonly SnapshotEntity[]): SnapshotEntity | undefined {
  return staff.find((worker) => {
    const job = settlerJobType(worker);
    return job !== undefined && workerRoleOf(job) !== 'carrier';
  });
}

/**
 * The seat's workshops that stand still, each judged once its rest outlasts
 * {@link PRODUCTION_STALL_GRACE_TICKS} by the sim's own diagnosis of its operator. A sweep visits the
 * seat's resting workshops off a maintained index, so its cost follows those, not the building count.
 * A workshop without an operator is never stalled: nobody was hired, which its panel shows. A crew
 * building a vehicle on its yard site runs no cycle, but is working, so its rest starts over.
 */
export class WorkshopStalls implements StallReader {
  private watched = new Map<number, Watch>();
  private swept = false;

  constructor(
    private readonly seat: number,
    private readonly seam: WorkshopSeam,
  ) {}

  /** Judge the resting workshops and raise a note for each one stalled. */
  sweep(snapshot: WorldSnapshot, raiser: MessageRaiser, naming: MessageNaming): void {
    const resting = indexesOf(snapshot).get(RESTING_BUILDINGS);
    const next = new Map<number, Watch>();
    for (const type of this.seam.types) {
      for (const workshop of resting.get(restingKey(this.seat, type)) ?? NO_BUILDINGS) {
        const watch = this.watched.get(workshop.id) ?? {
          since: snapshot.tick,
          asked: null,
          verdict: undefined,
        };
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

  holdsIdleNote(workplace: number): boolean {
    return this.watched.has(workplace);
  }

  private judge(snapshot: WorldSnapshot, workshop: SnapshotEntity, watch: Watch): void {
    if (snapshot.tick - watch.since < PRODUCTION_STALL_GRACE_TICKS) return;
    const staff = staffOf(snapshot, workshop.id);
    if (staff.some((worker) => worker.components.SiteAssignment !== undefined)) {
      watch.since = snapshot.tick;
      watch.asked = null;
      watch.verdict = null;
      return;
    }
    const operator = operatorOf(staff);
    if (operator === undefined) {
      watch.asked = null;
      watch.verdict = null;
      return;
    }
    const status = this.seam.workStatus(operator.id);
    // The first read only asks; its answer lands before the next sweep.
    if (status === undefined && watch.asked !== operator.id) {
      watch.asked = operator.id;
      return;
    }
    watch.asked = operator.id;
    watch.verdict = status === undefined ? null : stallOf(status);
  }
}

/** Raise the note about one stalled workshop, keyed by the building. A new good under the same reason
 *  rewords the standing note rather than raising another. */
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
