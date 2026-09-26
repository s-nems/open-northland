import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type ExperienceRowModel,
  experienceShown,
  type SettlerPanelModel,
  type UnlockProgressRowModel,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { element } from '../parts/dom.js';
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

/** Doświadczenie: the current trade's tracks two to a line, then the upcoming unlocks with a thin meter
 *  each, across the whole width. Nothing folds: the model caps both lists so the panel keeps the plane. */
export interface ExperienceSection {
  readonly element: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createExperienceSection(): ExperienceSection {
  const title = createSection();
  const rows = element('div', 'on-experience');
  const root = element('div', '');
  root.append(title.element, rows);
  let trained: Ledger[] = [];
  let unlocks: { ledger: Ledger; meter: HTMLElement }[] = [];

  return {
    element: root,
    update(model): void {
      const shown = experienceShown(model.experience);
      const empty = shown === 0 && model.upcomingUnlocks.length === 0;
      root.hidden = empty;
      if (empty) return;
      title.update(messages().hud.experience);
      if (trained.length !== shown || unlocks.length !== model.upcomingUnlocks.length) {
        trained = model.experience.slice(0, shown).map(() => createLedger());
        unlocks = model.upcomingUnlocks.map(() => {
          const ledger = createLedger();
          ledger.element.classList.add('on-ledger--unlock', 'on-experience__wide');
          return { ledger, meter: element('div', 'on-meter on-meter--mini on-experience__wide') };
        });
        rows.replaceChildren(
          ...trained.map((ledger) => ledger.element),
          ...unlocks.flatMap((unlock) => [unlock.ledger.element, unlock.meter]),
        );
      }
      trained.forEach((ledger, index) => {
        const row = model.experience[index];
        if (row !== undefined) ledger.update(trainedRow(row));
      });
      model.upcomingUnlocks.forEach((row, index) => {
        const unlock = unlocks[index];
        if (unlock === undefined) return;
        unlock.ledger.update(unlockRow(row));
        const width = `${Math.round((row.current / Math.max(1, row.required)) * 100)}%`;
        if (unlock.meter.style.getPropertyValue('--value') !== width)
          unlock.meter.style.setProperty('--value', width);
      });
    },
  };
}
