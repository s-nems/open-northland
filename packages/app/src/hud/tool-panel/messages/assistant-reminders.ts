import {
  type AssistantGrantId,
  GIVE_SWITCH_GOODS,
  GIVE_SWITCH_IDS,
  type GiveSwitchId,
} from '../../../game/assistant-grant-ids.js';
import type { SnapshotEntity } from '../../../game/snapshot/index.js';
import type { AssistantShortages } from '../../../view/assistant/shortages.js';
import type { MessageNaming, MessageRaiser } from './raise.js';
import type { MessageTextParts } from './text.js';
import { type AssistantReminderSwitch, type IdleReason, USER_MESSAGE_TYPE } from './types.js';

/** The viewer seat's assistant as the reminders read it, once a sweep. */
export interface AssistantReminderSeam {
  readonly switches: () => Readonly<Record<AssistantGrantId, boolean>>;
  /** How many men each give switch would still dress. */
  readonly shortages: () => AssistantShortages;
  /** The seat's stock of a good, by catalog slug. */
  readonly stockOf: (goodId: string) => number;
  /** A give switch's row label in the assistant window, which its reminder names. */
  readonly labelOf: (id: GiveSwitchId) => string;
}

const NO_NAMES = { subjectName: null, jobLabel: null, goodName: null, stanceName: null } as const;

/** One note per switch, whatever raised it. */
function raiseReminder(
  raiser: MessageRaiser,
  naming: MessageNaming,
  id: AssistantReminderSwitch,
  parts: MessageTextParts,
): void {
  const type = USER_MESSAGE_TYPE.assistantSwitchOff;
  raiser.raise(
    `${type}|${id}`,
    {
      type,
      subject: null,
      at: null,
      about: null,
      goodType: null,
      technologies: null,
      jobType: null,
      assistantSwitch: id,
    },
    () => naming.text(type, parts),
  );
}

/** Raise the reminder that the give switch `id`, named `label`, is off. */
export function raiseGiveSwitchReminder(
  raiser: MessageRaiser,
  naming: MessageNaming,
  id: GiveSwitchId,
  label: string,
): void {
  raiseReminder(raiser, naming, id, { ...NO_NAMES, goodName: label });
}

/** Whether a switch a reminder is about is on: undefined before the first sweep. */
export type AssistantSwitchReader = (id: AssistantReminderSwitch) => boolean | undefined;

/**
 * The reminders of the assistant switches that are off while they have something to do. A give switch
 * earns one once its good lies in the seat's stock and a man would take it, so the note arrives with the
 * first unit made, bought or found on the map rather than with the discovery, when there is nothing to
 * hand out yet. The flag follow earns one when an extractor's patch by his flag runs out. Each stands
 * until its switch goes on. Approximation: the stock counts units under the storage minimum, which the
 * assistant leaves in the store.
 */
export class AssistantReminders {
  private on: Readonly<Record<AssistantGrantId, boolean>> | null = null;

  constructor(private readonly seam: AssistantReminderSeam) {}

  /** Read the switches and raise the give switches' reminders. */
  sweep(raiser: MessageRaiser, naming: MessageNaming): void {
    const on = this.seam.switches();
    this.on = on;
    const shortages = this.seam.shortages();
    for (const id of GIVE_SWITCH_IDS) {
      if (on[id] || shortages[id].lacking === 0) continue;
      if (!GIVE_SWITCH_GOODS[id].some((goodId) => this.seam.stockOf(goodId) > 0)) continue;
      raiseGiveSwitchReminder(raiser, naming, id, this.seam.labelOf(id));
    }
  }

  /** Raise the flag follow's reminder for `e`, idle for `reason`, when the patch by his own flag or his
   *  post's ran out while the switch is off. Hunters and fishers name other reasons, and the flag follow
   *  leaves them alone. The note names nobody, since it outlives the extractor that raised it. */
  idleAtFlag(
    raiser: MessageRaiser,
    naming: MessageNaming,
    e: SnapshotEntity,
    reason: IdleReason | null,
  ): void {
    if (reason?.kind !== 'noResourceInArea') return;
    if (e.components.WorkFlag === undefined && e.components.HaulFlag === undefined) return;
    if (this.on === null || this.on.moveFlags) return;
    raiseReminder(raiser, naming, 'moveFlags', { ...NO_NAMES, assistantFlags: true });
  }

  readonly isOn: AssistantSwitchReader = (id) => this.on?.[id];
}
