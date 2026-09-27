import type { ContentSet } from '@open-northland/data';
import { type Entity, entityById, type PlayerCommand, type WorldSnapshot } from '@open-northland/sim';
import { num, ownerPlayerOf } from '../../game/snapshot.js';
import { technologyReason } from '../../game/technology.js';
import { messages } from '../../i18n/index.js';
import { orderRecipients, type SettlerActionsOptions } from './action-ring/index.js';
import type { AnsweredOrders } from './answered-orders.js';
import type { TechnologyStatusRead } from './types.js';

export interface ProfessionGateDeps {
  readonly content: ContentSet;
  readonly snapshot: () => WorldSnapshot;
  /** The last answer, for the list the picker draws. */
  readonly canChooseJob: (entity: number, jobType: number) => boolean;
  /** The answer as of now, for the pick that orders. */
  readonly askCanChooseJob: (entity: number, jobType: number) => Promise<boolean>;
  readonly technologyStatus?: TechnologyStatusRead | undefined;
  readonly answered: AnsweredOrders;
  readonly enqueue: (command: PlayerCommand) => void;
}

type ProfessionGates = Pick<
  SettlerActionsOptions,
  'jobVisible' | 'jobUnlocked' | 'jobBlockedReason' | 'onSetJob'
>;

/** The profession list's rows for the selected settlers the order reaches, and the pick that changes
 *  those the sim lets take the trade. */
export function professionGates(deps: ProfessionGateDeps): ProfessionGates {
  const targets = (ids: readonly number[]): number[] =>
    orderRecipients(deps.content, deps.snapshot(), ids, 'changeProfession');
  const currentProfession = (id: number): number | undefined =>
    num((entityById(deps.snapshot(), id)?.components.Settler as { jobType?: unknown } | undefined)?.jobType);
  const mayTake = (ids: readonly number[], jobType: number): boolean =>
    targets(ids).some((id) => deps.canChooseJob(id, jobType));

  return {
    jobVisible: (ids, jobType) =>
      mayTake(ids, jobType) || targets(ids).some((id) => currentProfession(id) === jobType),
    jobUnlocked: mayTake,
    jobBlockedReason: (ids, jobType) => {
      for (const id of targets(ids)) {
        const ent = entityById(deps.snapshot(), id);
        if (ent === undefined) continue;
        const tribe = num((ent.components.Settler as { tribe?: unknown } | undefined)?.tribe);
        if (tribe === undefined) continue;
        const status = deps.technologyStatus?.('job', jobType, tribe, ownerPlayerOf(ent));
        if (status !== undefined) {
          const reason = technologyReason(deps.content, status);
          if (reason !== null) return reason;
        }
      }
      return messages().hud.technologyExperience;
    },
    onSetJob: (ids, jobType) => {
      const asked = targets(ids);
      deps.answered.after(Promise.all(asked.map((id) => deps.askCanChooseJob(id, jobType))), (verdicts) => {
        asked.forEach((id, index) => {
          if (verdicts[index] === true) deps.enqueue({ kind: 'setJob', entity: id as Entity, jobType });
        });
      });
    },
  };
}
