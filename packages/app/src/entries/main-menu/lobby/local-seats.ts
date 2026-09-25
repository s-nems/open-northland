import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { colorChip, colorPalette } from '../lobby-controls/color.js';
import { seatRow } from '../lobby-controls/seat.js';
import { seatModeControl } from '../lobby-controls/seat-mode.js';
import type { MapSelectItem } from '../map-select-model.js';
import type { LobbySlotRow } from './model.js';
import { type RosterState, type VacantMode, wornByAnother } from './roster-state.js';

interface SeatActions {
  readonly togglePicker: (player: number) => void;
  readonly pickColor: (player: number, color: number) => void;
  readonly setMode: (player: number, mode: VacantMode) => void;
  readonly claim: (player: number) => void;
}

export function localSeatElements(
  item: MapSelectItem,
  state: RosterState,
  pickerSlot: number | null,
  actions: SeatActions,
) {
  const lobby = messages().mainMenu.lobby;
  const colorName = (color: number): string => messages().animation.playerColors[color] ?? String(color);
  const chipButton = (row: LobbySlotRow): HTMLButtonElement => {
    const chip = colorChip({ label: lobby.teamColour, name: colorName }, row.slot.player, () => {
      actions.togglePicker(row.slot.player);
    });
    chip.update({
      value: row.colorId,
      disabled: item.fixedColors,
      expanded: pickerSlot === row.slot.player,
      lockedNote: lobby.teamColourLocked,
    });
    return chip.root;
  };

  const pickerStrip = (row: LobbySlotRow): HTMLElement =>
    colorPalette(
      {
        label: lobby.teamColour,
        name: colorName,
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
    // A seat without an AI offer (`playeroption` Human/Closed-only) can only idle or leave the map.
    const choices: { readonly id: VacantMode; readonly label: string }[] = [
      ...(row.slot.aiAllowed ? [{ id: 'ai' as const, label: lobby.vacantComputer }] : []),
      { id: 'idle', label: lobby.vacantIdle },
      { id: 'absent', label: lobby.vacantAbsent },
    ];
    const control = seatModeControl(
      {
        label: lobby.vacantToggleTitle,
        choices,
        change: (mode) => {
          if (mode !== 'human') actions.setMode(row.slot.player, mode);
        },
      },
      'segments',
    );
    control.root.classList.add('main-menu__lobby-vacant');
    control.root.title = lobby.vacantToggleTitle;
    control.update(row.vacantMode, false);
    for (const [index, button] of [...control.root.querySelectorAll('button')].entries())
      button.dataset.focus = `vacant:${row.slot.player}:${choices[index]?.id ?? ''}`;
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
          : { ai: lobby.vacantComputerSub, idle: lobby.vacantIdleSub, absent: lobby.vacantAbsentSub }[
              row.vacantMode
            ];

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
