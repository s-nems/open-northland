import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type ExperienceRowModel,
  experienceShown,
  type SettlerPanelModel,
  type UnlockProgressRowModel,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setHidden, write } from '../parts/dom.js';
import { createLedger, type Ledger, type LedgerModel } from '../parts/ledger.js';
import { createSection } from '../parts/section.js';

function trainedRow(row: ExperienceRowModel): LedgerModel {
  const copy = messages().hud.settlerPanel;
  const repeats = String(row.repeats);
  return {
    label: row.label,
    tooltip:
      row.bonusPct === null
        ? formatMessage(copy.repeats, { count: row.repeats })
        : formatMessage(copy.repeatsBonus, { count: row.repeats, bonus: row.bonusPct }),
    value:
      row.bonusPct === null
        ? [{ text: repeats }]
        : [{ text: repeats }, { text: `+${row.bonusPct}%`, tone: 'bonus' }],
  };
}

function unlockRow(row: UnlockProgressRowModel): LedgerModel {
  return {
    label: row.unlocks,
    labelGlyph: GLYPH.lock,
    labelNote: `(${row.track})`,
    tooltip: formatMessage(messages().hud.settlerPanel.unlockTooltip, {
      unlocks: row.unlocks,
      track: row.track,
    }),
    value: [{ text: `${row.current} / ${row.required}` }],
  };
}

/** The upcoming unlocks a folded section keeps; the rest wait behind the toggle. */
export const UNLOCKS_FOLDED_MAX = 2;

/**
 * Doświadczenie: the current trade's tracks one to a line, then the upcoming unlocks with a thin meter
 * each. Every row shows until the panel would run past the plane: then the section folds to the
 * trade's first tracks and unlocks behind one "jeszcze N" in the title, which the player opens and
 * closes; a person whose rows fit sees no toggle, and a new person starts open again.
 */
export interface ExperienceSection {
  readonly element: HTMLElement;
  /** Paint the rows; `fresh` (another person) opens the fold. True when the rows changed shape, so
   *  the owner asks the frame whether the open section fits. */
  update(model: SettlerPanelModel, fresh: boolean): boolean;
  /** The open section does not fit the frame: fold it. */
  fold(): void;
}

export function createExperienceSection(): ExperienceSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const rows = element('div', 'on-experience');
  const root = element('div', '');
  root.append(title.element, rows);
  let open = true;
  /** The section had to fold for this person, so the toggle stays offered while it is open again. */
  let folded = false;
  let trained: Ledger[] = [];
  let unlocks: { ledger: Ledger; meter: HTMLElement }[] = [];
  /** How many rows the fold hides. */
  let hidden = 0;
  const paintToggle = (): void => {
    const copy = messages().hud.settlerPanel;
    setHidden(toggle, hidden === 0 || !folded);
    write(toggle, open ? copy.fewerRows : formatMessage(copy.moreRows, { count: hidden }));
    setAttribute(toggle, 'aria-expanded', String(open));
    setClass(rows, 'on-experience--open', open);
  };
  toggle.addEventListener('click', () => {
    open = !open;
    paintToggle();
  });

  return {
    element: root,
    update(model, fresh): boolean {
      const empty = model.experience.length === 0 && model.upcomingUnlocks.length === 0;
      setHidden(root, empty);
      if (empty) return false;
      if (fresh) {
        open = true;
        folded = false;
      }
      title.update(messages().hud.experience);
      const reshaped =
        trained.length !== model.experience.length || unlocks.length !== model.upcomingUnlocks.length;
      if (reshaped) {
        trained = model.experience.map(() => createLedger());
        unlocks = model.upcomingUnlocks.map(() => {
          const ledger = createLedger();
          ledger.element.classList.add('on-ledger--unlock');
          return { ledger, meter: element('div', 'on-meter on-meter--mini') };
        });
        rows.replaceChildren(
          ...trained.map((ledger) => ledger.element),
          ...unlocks.flatMap((unlock) => [unlock.ledger.element, unlock.meter]),
        );
      }
      const shown = experienceShown(model.experience);
      const shownUnlocks = Math.min(model.upcomingUnlocks.length, UNLOCKS_FOLDED_MAX);
      hidden = model.experience.length - shown + model.upcomingUnlocks.length - shownUnlocks;
      model.experience.forEach((row, index) => {
        const ledger = trained[index];
        if (ledger === undefined) return;
        ledger.update(trainedRow(row));
        setClass(ledger.element, 'on-ledger--more', index >= shown);
      });
      model.upcomingUnlocks.forEach((row, index) => {
        const unlock = unlocks[index];
        if (unlock === undefined) return;
        unlock.ledger.update(unlockRow(row));
        setClass(unlock.ledger.element, 'on-ledger--more', index >= shownUnlocks);
        setClass(unlock.meter, 'on-ledger--more', index >= shownUnlocks);
        const width = `${Math.round((row.current / Math.max(1, row.required)) * 100)}%`;
        if (unlock.meter.style.getPropertyValue('--value') !== width)
          unlock.meter.style.setProperty('--value', width);
      });
      paintToggle();
      return fresh || reshaped;
    },
    fold(): void {
      if (!open || hidden === 0) return;
      open = false;
      folded = true;
      paintToggle();
    },
  };
}
