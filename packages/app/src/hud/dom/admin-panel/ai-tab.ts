import { messages } from '../../../i18n/index.js';
import { element, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { AdminAiSeat, AdminAiTable } from './model.js';

export interface AiTab {
  readonly element: HTMLElement;
  show(seats: readonly AdminAiSeat[]): void;
}

function tableOf(data: AdminAiTable): HTMLTableElement {
  const table = element('table', 'on-admin__ai-table');
  if (data.head !== null) {
    const head = table.createTHead().insertRow();
    for (const text of data.head) {
      const cell = element('th', '');
      write(cell, text);
      head.append(cell);
    }
  }
  const body = table.createTBody();
  for (const row of data.rows) {
    const tr = body.insertRow();
    row.forEach((text, i) => {
      // The first cell names the row.
      const cell = element(i === 0 ? 'th' : 'td', '');
      write(cell, text);
      tr.append(cell);
    });
  }
  return table;
}

/** The AI tab: one block of plain tables per running computer seat, repainted only when its text moves. */
export function createAiTab(): AiTab {
  const copy = messages().admin.ai;
  const root = element('div', 'on-admin__pane on-admin__ai');
  const empty = element('p', 'on-admin__empty');
  write(empty, copy.empty);
  root.append(empty);
  let shown = '';

  return {
    element: root,
    show(seats): void {
      const key = JSON.stringify(seats);
      if (key === shown) return;
      shown = key;
      if (seats.length === 0) {
        root.replaceChildren(empty);
        return;
      }
      const blocks: HTMLElement[] = [];
      for (const seat of seats) {
        const section = createSection();
        section.update(seat.title);
        blocks.push(section.element);
        if (seat.note !== null) {
          const note = element('p', 'on-admin__note');
          write(note, seat.note);
          blocks.push(note);
        }
        for (const table of seat.tables) blocks.push(tableOf(table));
      }
      root.replaceChildren(...blocks);
    },
  };
}
