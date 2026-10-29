import {
  Building,
  Carrying,
  playerPlacementTribes,
  professionProgressionEnabled,
  TrainingOrder,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeManhattan } from '../../../nav/halfcell.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { isBuilt, ownedSettlers } from '../../ai-shared/seat-roster.js';
import { tradeExperience } from '../../ai-shared/workforce/experience.js';
import type { SpareForce } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { trainingSeats } from '../../orders/training-seats.js';
import { jobEnabled } from '../../progression/index.js';
import { technologyTable } from './requirements.js';

/** What fills one more slot of a gated trade when no spare man qualifies for it: a pupil already in the
 *  trade's lesson (`promised`), a spare sent to school now (`learn`), `wait` while the school is full or
 *  nobody is spare, or `none` when no school the seat has standing teaches the trade. */
export type Enrolment =
  | { readonly kind: 'learn'; readonly command: PlayerCommand }
  | { readonly kind: 'promised' | 'wait' | 'none' };

const PROMISED: Enrolment = { kind: 'promised' };
const WAIT: Enrolment = { kind: 'wait' };
const NONE: Enrolment = { kind: 'none' };

/**
 * One decision's school lessons for the seat's gated trades (owner ruling: once the school stands, the
 * next baker is schooled rather than another worker promoted out of a running building). A slot of a
 * discovered trade the school teaches is filled by a pupil already in its lesson, counted once, or else
 * by a spare man sent to the nearest standing school with a free seat (its `schoolSize`, counting every
 * order there and this decision's pupils), the man least practised in other trades first. The graduate
 * qualifies for the slot and is posted by the next allocation.
 */
export class Schooling {
  private pupils: Map<number, number> | undefined;
  private readonly promisedSlots = new Map<Entity, Map<number, number>>();
  private readonly freeSeats = new Map<Entity, number>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly player: number,
    private readonly owned: readonly Entity[],
  ) {}

  /** The slots of `job` at `building` this decision's lessons fill. */
  promised(building: Entity, job: number): number {
    return this.promisedSlots.get(building)?.get(job) ?? 0;
  }

  enrol(job: number, building: Entity, force: SpareForce): Enrolment {
    const { world, ctx, player } = this;
    if (!professionProgressionEnabled(world)) return NONE;
    const tribe = playerPlacementTribes(world, player)?.[0];
    const gate = tribe === undefined ? undefined : technologyTable(ctx.content, tribe)?.jobs.get(job);
    if (tribe === undefined || gate === undefined || gate.needs.length === 0 || gate.school === null)
      return NONE;
    if (!jobEnabled(world, ctx, player, tribe, job)) return NONE;
    const { schools } = gate.school;
    const standing = this.owned.filter(
      (e) => schools.includes(world.get(e, Building).buildingType) && isBuilt(world, e),
    );
    if (standing.length === 0) return NONE;
    this.pupils ??= this.livePupils();
    const waiting = this.pupils.get(job) ?? 0;
    if (waiting > 0) {
      this.pupils.set(job, waiting - 1);
      this.promise(building, job);
      return PROMISED;
    }
    const school = this.nearestWithSeat(building, standing);
    if (school === null) return WAIT;
    // A man holding a load waits until he sets it down, since the trade change would drop it.
    const spare = force.take(
      (e) => !world.has(e, Carrying),
      (e) => -tradeExperience(world, ctx, e),
    );
    if (spare === null) return WAIT;
    this.freeSeats.set(school, (this.freeSeats.get(school) ?? 0) - 1);
    this.promise(building, job);
    return {
      kind: 'learn',
      command: { kind: 'learn', entity: spare, house: school, target: 'job', typeId: job },
    };
  }

  private promise(building: Entity, job: number): void {
    let byJob = this.promisedSlots.get(building);
    if (byJob === undefined) {
      byJob = new Map();
      this.promisedSlots.set(building, byJob);
    }
    byJob.set(job, (byJob.get(job) ?? 0) + 1);
  }

  /** The seat's men in a job lesson now, by the job they learn. */
  private livePupils(): Map<number, number> {
    const pupils = new Map<number, number>();
    for (const e of ownedSettlers(this.world, this.player)) {
      const lesson = this.world.tryGet(e, TrainingOrder)?.lesson;
      if (lesson?.kind === 'job') pupils.set(lesson.typeId, (pupils.get(lesson.typeId) ?? 0) + 1);
    }
    return pupils;
  }

  /** The standing school nearest `building` with a seat left, the lowest id on a tie. */
  private nearestWithSeat(building: Entity, standing: readonly Entity[]): Entity | null {
    const at = anchorNodeOf(this.world, building);
    let best: Entity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const school of standing) {
      if (this.seatsLeft(school) <= 0) continue;
      const node = anchorNodeOf(this.world, school);
      const distance = at === null || node === null ? 0 : nodeManhattan(at, node);
      if (distance < bestDistance) {
        best = school;
        bestDistance = distance;
      }
    }
    return best;
  }

  private seatsLeft(school: Entity): number {
    let left = this.freeSeats.get(school);
    if (left === undefined) {
      const capacity = trainingSeats(this.world, this.ctx, school);
      left = Number.POSITIVE_INFINITY;
      if (capacity !== undefined) {
        let claimed = 0;
        for (const e of this.world.query(TrainingOrder))
          if (this.world.get(e, TrainingOrder).house === school) claimed++;
        left = capacity - claimed;
      }
      this.freeSeats.set(school, left);
    }
    return left;
  }
}
