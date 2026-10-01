import { formatMessage, messages } from '../../../i18n/index.js';
import type { GroupDetailRow, GroupScopeModel } from '../../details-panel/model/index.js';
import { button, element, setAttribute, setHidden, write } from '../parts/dom.js';
import { createLedger, type Ledger } from '../parts/ledger.js';
import { createSection } from '../parts/section.js';
import type { GroupPanelDeps } from './actions.js';

/** Szczegóły: counts of the scope's members in some state (wounded, hungry, unarmoured...), each a link
 *  that selects only them, and the scope's combat experience. Folded under its title until opened; the
 *  choice holds for every group the panel shows. */
export interface DetailsSection {
  readonly element: HTMLElement;
  update(scope: GroupScopeModel): void;
  /** Hide the open rows while the panel lacks room for them, without changing the player's choice;
   *  true when they were showing. */
  squeeze(): boolean;
  /** Show the rows again if the player keeps them open. */
  unsqueeze(): void;
}

/** `onToggle` hears the player's own open or close press. */
export function createDetailsSection(deps: GroupPanelDeps, onToggle: () => void): DetailsSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const list = element('div', 'on-group-details');
  const root = element('div', '');
  root.append(title.element, list);
  let open = false;
  let squeezed = false;
  let rows: readonly GroupDetailRow[] = [];
  let shape = '';
  let ledgers: Ledger[] = [];
  const paintToggle = (): void => {
    const copy = messages().hud.groupPanel;
    const showing = open && !squeezed;
    write(toggle, showing ? copy.detailsHide : copy.detailsShow);
    setAttribute(toggle, 'aria-expanded', String(showing));
    setHidden(list, !open || squeezed);
  };
  toggle.addEventListener('click', () => {
    open = !(open && !squeezed);
    squeezed = false;
    paintToggle();
    onToggle();
  });
  return {
    element: root,
    update(scope): void {
      const copy = messages().hud.groupPanel;
      rows = scope.details;
      setHidden(root, rows.length === 0);
      title.update(copy.details);
      paintToggle();
      const nextShape = rows.map((row) => `${row.detail}${row.ids === null ? '' : '+'}`).join(',');
      if (nextShape !== shape) {
        shape = nextShape;
        ledgers = rows.map((_, index) =>
          createLedger({
            onLink: () => {
              const ids = rows[index]?.ids;
              if (ids !== null && ids !== undefined) deps.actions.select(ids);
            },
          }),
        );
        list.replaceChildren(...ledgers.map((ledger) => ledger.element));
      }
      rows.forEach((row, index) => {
        ledgers[index]?.update({
          label: copy.detailRows[row.detail],
          value: [
            row.ids === null
              ? { text: row.value }
              : {
                  text: row.value,
                  link: true,
                  tooltip: formatMessage(copy.selectThese, { count: row.ids.length }),
                },
          ],
        });
      });
    },
    squeeze(): boolean {
      if (!open || squeezed) return false;
      squeezed = true;
      paintToggle();
      return true;
    },
    unsqueeze(): void {
      if (!squeezed) return;
      squeezed = false;
      paintToggle();
    },
  };
}
