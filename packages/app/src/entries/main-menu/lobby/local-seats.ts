import { playerSwatchHex } from '../../../catalog/roster.js';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { colorPalette } from '../lobby-controls/color.js';
import { seatRow } from '../lobby-controls/seat.js';
import { seatModeControl } from '../lobby-controls/seat-mode.js';
import type { MapSelectItem } from '../map-select-model.js';
import type { LobbySlotRow } from './model.js';
import { type RosterState, wornByAnother } from './roster-state.js';

interface SeatActions {
  readonly togglePicker: (player: number) => void;
  readonly pickColor: (player: number, color: number) => void;
  readonly toggleMode: (player: number) => void;
  readonly claim: (player: number) => void;
}

export function localSeatElements(
  item: MapSelectItem,
  state: RosterState,
  pickerSlot: number | null,
  actions: SeatActions,
) {
  const lobby = messages().mainMenu.lobby;
  const chipButton = (row: LobbySlotRow): HTMLButtonElement => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'main-menu__lobby-chip';
    chip.style.background = playerSwatchHex(row.colorId);
    chip.textContent = String(row.slot.player + 1);
    const colourName = messages().animation.playerColors[row.colorId] ?? String(row.colorId);
    chip.title = item.fixedColors
      ? `${lobby.teamColour}: ${colourName} (${lobby.teamColourLocked})`
      : `${lobby.teamColour}: ${colourName}`;
    chip.setAttribute('aria-label', chip.title);
    chip.disabled = item.fixedColors;
    chip.dataset.focus = `chip:${row.slot.player}`;
    chip.setAttribute('aria-expanded', String(pickerSlot === row.slot.player));
    chip.addEventListener('click', () => {
      actions.togglePicker(row.slot.player);
    });
    return chip;
  };

  const pickerStrip = (row: LobbySlotRow): HTMLElement =>
    colorPalette(
      {
        label: lobby.teamColour,
        name: (color) => messages().animation.playerColors[color] ?? String(color),
        change: (color) => actions.pickColor(row.slot.player, color),
      },
      {
        value: row.colorId,
        disabled: item.fixedColors,
        unavailable: (color) => wornByAnother(state, row.slot.player, color),
      },
      row.slot.player,
    );

  const controlCell = (row: LobbySlotRow): HTMLElement => {
    if (row.kind === 'yours') {
      const cell = document.createElement('div');
      cell.className = 'main-menu__lobby-human';
      cell.textContent = lobby.human;
      return cell;
    }
    if (row.kind === 'scenario') {
      const cell = document.createElement('div');
      cell.className = 'main-menu__lobby-locked';
      cell.textContent = lobby.scenarioControl;
      return cell;
    }
    if (!row.slot.aiAllowed) {
      // No AI offer for this seat (`playeroption` Human/Closed-only): vacant means idle, no choice.
      const cell = document.createElement('div');
      cell.className = 'main-menu__lobby-locked';
      cell.textContent = lobby.vacantIdle;
      return cell;
    }
    const control = seatModeControl(
      {
        label: lobby.vacantToggleTitle,
        choices: [
          { id: 'ai', label: lobby.vacantComputer },
          { id: 'idle', label: lobby.vacantIdle },
        ],
        change: () => actions.toggleMode(row.slot.player),
      },
      'segments',
    );
    control.root.classList.add('main-menu__lobby-vacant');
    control.root.title = lobby.vacantToggleTitle;
    control.update(row.vacantMode, false);
    for (const [index, button] of [...control.root.querySelectorAll('button')].entries())
      button.dataset.focus = `vacant:${row.slot.player}:${index === 0 ? 'ai' : 'idle'}`;
    return control.root;
  };

  const slotRow = (row: LobbySlotRow): HTMLElement => {
    const title =
      row.slot.name ??
      (row.kind === 'open'
        ? lobby.freeSlot
        : formatMessage(lobby.playerSlotLabel, { n: row.slot.player + 1 }));
    const tribe = tribeName(row.slot.tribeId);
    const subText =
      row.kind === 'yours'
        ? lobby.yourSub
        : row.kind === 'scenario'
          ? lobby.scenarioSub
          : row.vacantMode === 'ai'
            ? lobby.vacantComputerSub
            : lobby.vacantIdleSub;

    const action = document.createElement('div');
    action.className = 'main-menu__lobby-action';
    if (row.kind === 'open') {
      const sit = document.createElement('button');
      sit.type = 'button';
      sit.className = 'main-menu__lobby-sit';
      sit.textContent = lobby.sit;
      sit.dataset.focus = `sit:${row.slot.player}`;
      sit.addEventListener('click', () => {
        actions.claim(row.slot.player);
      });
      action.append(sit);
    }

    const seat = seatRow({
      className: 'main-menu__lobby-row',
      labelClass: 'main-menu__lobby-label',
      nameClass: 'main-menu__lobby-name',
      detailClass: 'main-menu__lobby-sub',
      beforeLabel: [chipButton(row)],
      controls: [controlCell(row), action],
    });
    seat.update(title, `${tribe} · ${subText}`, row.kind === 'yours');
    seat.root.classList.toggle('is-scenario', row.kind === 'scenario');
    return seat.root;
  };

  return { row: slotRow, picker: pickerStrip };
}
