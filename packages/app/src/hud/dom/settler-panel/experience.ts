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
    label: row.job,
    labelGlyph: GLYPH.lock,
    labelNote: `(${row.track})`,
    tooltip: formatMessage(messages().hud.settlerPanel.unlockTooltip, { job: row.job, track: row.track }),
    value: [{ text: `${row.current} / ${row.required}` }],
  };
}

/** Doświadczenie: the current trade's tracks (the rest folded behind "N więcej" in the title), then
 *  the upcoming unlocks with a thin meter each. */
export interface ExperienceSection {
  readonly element: HTMLElement;
  update(model: SettlerPanelModel, structural: boolean): void;
}

export function createExperienceSection(): ExperienceSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const rows = element('div', 'on-experience');
  const root = element('div', '');
  root.append(title.element, rows);
  let open = false;
  let trained: Ledger[] = [];
  let unlocks: { ledger: Ledger; meter: HTMLElement }[] = [];
  let hidden = 0;
  const paintToggle = (): void => {
    const copy = messages().hud.settlerPanel;
    setHidden(toggle, hidden === 0);
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
    update(model, structural): void {
      const empty = model.experience.length === 0 && model.upcomingUnlocks.length === 0;
      setHidden(root, empty);
      if (empty) return;
      if (structural) open = false;
      title.update(messages().hud.experience);
      if (trained.length !== model.experience.length || unlocks.length !== model.upcomingUnlocks.length) {
        trained = model.experience.map(() => createLedger());
        unlocks = model.upcomingUnlocks.map(() => ({
          ledger: createLedger(),
          meter: element('div', 'on-meter on-meter--mini'),
        }));
        rows.replaceChildren(
          ...trained.map((ledger) => ledger.element),
          ...unlocks.flatMap((unlock) => [unlock.ledger.element, unlock.meter]),
        );
      }
      const shown = experienceShown(model.experience);
      hidden = model.experience.length - shown;
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
        setClass(unlock.ledger.element, 'on-ledger--unlock', true);
        const width = `${Math.round((row.current / Math.max(1, row.required)) * 100)}%`;
        if (unlock.meter.style.getPropertyValue('--value') !== width)
          unlock.meter.style.setProperty('--value', width);
      });
      paintToggle();
    },
  };
}
