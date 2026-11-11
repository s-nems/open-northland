import type { UiCue } from '@open-northland/audio';
import type { PickerEntry } from '../../../catalog/professions.js';
import { type ChoiceGroup, createChoiceWindow } from '../../../hud/dom/choice-window.js';
import type { GoodIconPainter } from '../../../hud/dom/good-art.js';
import { professionChoices } from '../../../hud/dom/profession-choices.js';
import { messages, uiLabel } from '../../../i18n/index.js';
import type { CameraGestures } from '../../camera/index.js';
import type { JobGoodChoice } from './types.js';

export interface ProfessionPickerOptions {
  readonly professions: readonly PickerEntry[];
  readonly scale: number;
  readonly camera: CameraGestures;
  /** `goods` is the second page's pick: one good, or empty for every good. */
  readonly onPick: (jobType: number, goods?: readonly number[]) => void;
  readonly onDismiss: () => void;
  readonly cue: (cue: UiCue) => void;
  /** Paints each trade's good before its name; absent lists the names alone. */
  readonly icons?: GoodIconPainter;
}
export interface ProfessionPicker {
  show(
    visible: (jobType: number) => boolean,
    unlocked: (jobType: number) => boolean,
    reason?: (jobType: number) => string,
    goods?: (jobType: number) => readonly JobGoodChoice[],
  ): void;
  refresh(): void;
  hide(): void;
  scrollTop(): number;
  setScrollTop(top: number): void;
  dispose(): void;
}

/** The second page's key for "every good". */
const ALL_GOODS = 'all';

/** The second page: every good first, then each good the trade may be held to. */
function goodChoices(goods: readonly JobGoodChoice[]): ChoiceGroup[] {
  const copy = messages().hud;
  return [
    {
      label: copy.choiceGathers,
      rows: [
        { key: ALL_GOODS, label: copy.choiceGatherAll },
        ...goods.map((good) => ({
          key: String(good.goodType),
          label: good.label,
          goodId: good.goodId,
          ...(good.reason === undefined ? {} : { reason: good.reason }),
        })),
      ],
    },
  ];
}

/** The profession list. A gathering trade with goods to choose opens a second page of them, so the trade
 *  and its good are two clicks; dismissing that page steps back to the list. */
export function createProfessionPicker(opts: ProfessionPickerOptions): ProfessionPicker {
  let visible: ((jobType: number) => boolean) | undefined;
  let unlocked: ((jobType: number) => boolean) | undefined;
  let reason: ((jobType: number) => string) | undefined;
  let goodsOf: ((jobType: number) => readonly JobGoodChoice[]) | undefined;
  /** The trade whose goods page is open, and where the list stood when it opened. */
  let goodsJob: number | undefined;
  let listScroll = 0;
  const mayPick = (job: number): boolean => visible?.(job) === true && unlocked?.(job) === true;
  const showList = (): void => {
    const back = goodsJob !== undefined;
    goodsJob = undefined;
    refresh();
    dialog.show();
    if (back) dialog.setScrollTop(listScroll);
  };
  const dialog = createChoiceWindow({
    title: uiLabel('changeProfession'),
    camera: opts.camera,
    scale: opts.scale,
    cue: opts.cue,
    ...(opts.icons === undefined ? {} : { icons: opts.icons }),
    onDismiss: () => {
      if (goodsJob === undefined) opts.onDismiss();
      else showList();
    },
    onPick: (key) => {
      if (goodsJob !== undefined) {
        const job = goodsJob;
        if (!mayPick(job)) return;
        opts.onPick(job, key === ALL_GOODS ? [] : [Number(key)]);
        return;
      }
      const job = Number(key);
      if (!mayPick(job)) return;
      const goods = goodsOf?.(job) ?? [];
      if (goods.length === 0) {
        opts.onPick(job);
        return;
      }
      listScroll = dialog.scrollTop();
      goodsJob = job;
      dialog.update(goodChoices(goods));
      const trade = opts.professions.find((entry) => entry.kind === 'profession' && entry.jobType === job);
      dialog.show(trade?.label);
    },
  });
  const refresh = (): void => {
    if (visible === undefined || unlocked === undefined) return;
    if (goodsJob === undefined) {
      dialog.update(professionChoices(opts.professions, visible, unlocked, reason));
      return;
    }
    const goods = mayPick(goodsJob) ? (goodsOf?.(goodsJob) ?? []) : [];
    if (goods.length === 0) showList();
    else dialog.update(goodChoices(goods));
  };
  return {
    show: (shown, permits, blockedReason, goods) => {
      visible = shown;
      unlocked = permits;
      reason = blockedReason;
      goodsOf = goods;
      showList();
    },
    refresh,
    hide: () => {
      visible = undefined;
      unlocked = undefined;
      goodsJob = undefined;
      dialog.hide();
    },
    scrollTop: () => (goodsJob === undefined ? dialog.scrollTop() : listScroll),
    setScrollTop: dialog.setScrollTop,
    dispose: dialog.dispose,
  };
}
