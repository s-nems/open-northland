import type { ContentSet } from '@open-northland/data';
import {
  type Entity,
  entityById,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  type UnitSelectionCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import { num, ownerPlayerOf, progressionGatesSettler } from '../../../game/snapshot/index.js';
import { technologyReason } from '../../../game/technology.js';
import { goodLabel, type UnitPanelModelContext } from '../../../hud/details-panel/model/context.js';
import {
  type GoodGate,
  HIDDEN,
  harvestableGoodsFor,
  settlerGoodGate,
} from '../../../hud/details-panel/model/good-gate.js';
import { messages } from '../../../i18n/index.js';
import { type JobGoodChoice, orderRecipients, type SettlerActionsOptions } from '../action-ring/index.js';
import type { TechnologyStatusRead } from '../types.js';
import type { AnsweredOrders } from './answered.js';
import { enqueueUnitSelection } from './group.js';

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
  readonly onOrderLimit?: (() => void) | undefined;
}

type ProfessionGates = Pick<
  SettlerActionsOptions,
  'jobVisible' | 'jobUnlocked' | 'jobBlockedReason' | 'jobGoods' | 'onSetJob'
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
  const goodsContext: UnitPanelModelContext = {
    ...deps.content,
    goodAllowed: (good, tribe, player) =>
      deps.technologyStatus?.('good', good, tribe, player)?.allowed ?? true,
  };
  const goodGateOf = (snapshot: WorldSnapshot, id: number): GoodGate | undefined => {
    const ent = entityById(snapshot, id);
    return ent === undefined
      ? undefined
      : settlerGoodGate(goodsContext, ent.components, progressionGatesSettler(snapshot, ent));
  };

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
    jobGoods: (ids, jobType) => {
      if (deps.content.jobs.find((job) => job.typeId === jobType)?.changesProduction === false) return [];
      const goods = harvestableGoodsFor(deps.content, jobType);
      if (goods.length < 2) return [];
      const snapshot = deps.snapshot();
      const gates = targets(ids)
        .filter((id) => deps.canChooseJob(id, jobType))
        .flatMap((id) => goodGateOf(snapshot, id) ?? []);
      // A good shows while any settler taking the trade may see it, and opens while any one of them may
      // gather it; the pick holds only those to it.
      const choices = goods.flatMap((good): JobGoodChoice[] => {
        const verdicts = gates.map((gate) => gate(good.typeId));
        if (verdicts.length > 0 && verdicts.every((verdict) => verdict === HIDDEN)) return [];
        const open = verdicts.length === 0 || verdicts.includes(null);
        const reason = open ? undefined : verdicts.find((verdict) => typeof verdict === 'string');
        const label = goodLabel(goodsContext, good.typeId);
        return [
          { goodType: good.typeId, goodId: good.id, label, ...(reason === undefined ? {} : { reason }) },
        ];
      });
      return choices.length < 2 ? [] : choices;
    },
    onSetJob: (ids, jobType, goods) => {
      const asked = targets(ids);
      if (new Set(asked).size > MAX_UNIT_ORDER_MEMBERS) {
        deps.onOrderLimit?.();
        return;
      }
      deps.answered.after(Promise.all(asked.map((id) => deps.askCanChooseJob(id, jobType))), (verdicts) => {
        const snapshot = deps.snapshot();
        // A settler who may not gather a picked good gathers everything instead of standing idle.
        const goodsFor = (id: number): readonly number[] | undefined => {
          if (goods === undefined || goods.length === 0) return goods;
          const gate = goodGateOf(snapshot, id);
          return gate !== undefined && goods.every((good) => gate(good) === null) ? goods : [];
        };
        const commands: UnitSelectionCommand[] = asked.flatMap((id, index) => {
          if (verdicts[index] !== true) return [];
          const held = goodsFor(id);
          return [
            { kind: 'setJob', entity: id as Entity, jobType, ...(held === undefined ? {} : { goods: held }) },
          ];
        });
        enqueueUnitSelection(commands, deps.enqueue, deps.onOrderLimit);
      });
    },
  };
}
