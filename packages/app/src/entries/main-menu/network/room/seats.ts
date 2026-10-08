import type { RoomSeatView, RoomView, VacantSeatMode } from '@open-northland/net-protocol';
import { components } from '@open-northland/sim';
import { localizedMapText } from '../../../../game/map-strings.js';
import { currentLocale, formatMessage, messages, tribeName } from '../../../../i18n/index.js';
import { memberLoadText } from '../../../../view/net/member-load.js';
import { node } from '../../dom.js';
import { colorChip, colorPalette } from '../../lobby-controls/color.js';
import { seatModeControl } from '../../lobby-controls/seat-mode.js';
import { tribePicker } from '../../lobby-controls/tribe.js';
import { button, selectControl } from './controls.js';
import {
  canClaimSeat,
  canSetSeatDifficulty,
  canSetSeatTribe,
  roomPermissions,
  savedSeatHint,
  seatCivilization,
} from './model.js';
import type { NetworkRoomDeps } from './types.js';

const { AI_DIFFICULTIES } = components;

const ROOM_VACANT_ORDER: readonly VacantSeatMode[] = ['idle', 'ai', 'absent'];

export function roomSeats(deps: NetworkRoomDeps) {
  const { client, copy } = deps;
  const root = node('section', 'network-room__seats');
  const header = node('div', 'network-room__seat-head');
  header.setAttribute('aria-hidden', 'true');
  header.append(
    ...[
      copy.human,
      copy.color,
      copy.seatMode,
      messages().mainMenu.lobby.difficultyHeader,
      messages().mainMenu.lobby.tribe,
    ].map((label) => node('span', '', label)),
  );
  const difficultyHeading = header.children.item(3);
  root.append(header);
  const rows = new Map<number, ReturnType<typeof seatRow>>();
  let shown: { readonly room: RoomView; readonly connected: boolean } | null = null;
  /** The seat whose colour palette is open; one at a time, like the local lobby. */
  let paletteSeat: number | null = null;
  const colorName = (color: number): string => messages().animation.playerColors[color] ?? String(color);
  function repaint(): void {
    if (shown === null) return;
    for (const seat of shown.room.seats) rows.get(seat.player)?.update(shown.room, seat, shown.connected);
  }
  function showPalette(player: number | null): void {
    const focus = player ?? paletteSeat;
    paletteSeat = player;
    repaint();
    if (focus !== null) rows.get(focus)?.chip.focus();
    if (player !== null) rows.get(player)?.palette.scrollIntoView({ block: 'nearest' });
  }
  function seatTribe(player: number, authored: number) {
    const picker = tribePicker(authored, (tribe) => client.setSeat(player, { tribe }), 'network-room__field');
    return {
      root: picker.root,
      update: (seat: RoomSeatView, disabled: boolean) => picker.update(seat.tribe ?? authored, disabled),
    };
  }
  function seatRow(
    player: number,
    offers: readonly VacantSeatMode[],
    resumed: boolean,
    civilization: number | null,
  ) {
    const colorOptions = {
      label: copy.color,
      name: colorName,
      change: (color: number) => {
        showPalette(null);
        client.setSeat(player, { color });
      },
    };
    const chip = colorChip(colorOptions, player, () => showPalette(paletteSeat === player ? null : player));
    const color = node('div', 'network-room__field');
    color.append(node('span', '', copy.color), chip.root);
    const palette = node('div', 'network-room__palette');
    palette.hidden = true;
    function paintPalette(room: RoomView, seat: RoomSeatView, frozen: boolean): void {
      const expanded = paletteSeat === player;
      palette.hidden = !expanded;
      // The strip is rebuilt on every room view, so a focused swatch is found again by its key.
      const focused = document.activeElement;
      const focusKey =
        focused instanceof HTMLElement && palette.contains(focused) ? focused.dataset.focus : undefined;
      palette.replaceChildren();
      if (!expanded) return;
      palette.append(
        colorPalette(
          colorOptions,
          {
            value: seat.color,
            disabled: frozen,
            unavailable: (color) =>
              room.seats.some((other) => other.player !== player && other.color === color),
          },
          player,
        ),
      );
      if (focusKey !== undefined) palette.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`)?.focus();
    }
    const mode = seatModeControl(
      {
        fieldClassName: 'network-room__field',
        label: copy.seatMode,
        choices: [
          ...ROOM_VACANT_ORDER.filter((mode) => offers.includes(mode)).map((mode) => ({
            id: mode,
            label: copy[mode],
            // A resumed save's world is already built, so there is nothing left to take off the map.
            disabled: mode === 'absent' && resumed,
          })),
          { id: 'human', label: copy.human, disabled: true },
        ],
        change: (mode) => {
          if (mode !== 'human') client.setSeat(player, { mode });
        },
      },
      'select',
    );
    const tribe = civilization === null ? null : seatTribe(player, civilization);
    const levels = messages().mainMenu.lobby.difficulty;
    const difficulty = selectControl(
      messages().mainMenu.lobby.difficultyHeader,
      AI_DIFFICULTIES.map((id) => [id, levels[id]] as const),
      (value) => {
        const level = AI_DIFFICULTIES.find((id) => id === value);
        if (level !== undefined) client.setSeat(player, { difficulty: level });
      },
    );
    difficulty.root.classList.add('network-room__difficulty');
    const take = button(copy.takeSeat, () => client.claimSeat(player));
    take.classList.add('network-room__claim');
    const row = node('div', 'network-room__seat');
    row.setAttribute('role', 'group');
    row.tabIndex = -1;
    const identity = node('div', 'network-room__seat-identity');
    const nameLine = node('div', 'network-room__seat-name-line');
    const name = node('strong', 'network-room__seat-name');
    const yours = node('span', 'network-room__badge network-room__badge--you', copy.you);
    const host = node('span', 'network-room__badge', copy.host);
    const faction = node('span', 'network-room__faction');
    const detail = node('span', 'network-room__muted');
    const readiness = node('span', 'network-room__readiness');
    nameLine.append(name, yours, host, detail);
    const identityText = node('div', 'network-room__seat-description');
    identityText.append(nameLine, faction);
    identity.append(identityText, take);
    const human = node('span', 'network-room__human', copy.human);
    human.append(readiness);
    row.append(
      identity,
      color,
      mode.root,
      human,
      difficulty.root,
      ...(tribe === null ? [] : [tribe.root]),
      palette,
    );
    return {
      row,
      chip: chip.root,
      palette,
      update(room: RoomView, seat: RoomSeatView, connected: boolean): void {
        const permissions = roomPermissions(room, client.nick, connected);
        const frozen = !permissions.canSetupSeats;
        const member = room.members.find((member) => member.nick === seat.nick);
        const status =
          member?.connected === false
            ? copy.disconnected
            : seat.nick === null
              ? ''
              : seat.ready
                ? copy.ready
                : copy.notReady;
        const saved = savedSeatHint(deps.savedRoster?.() ?? null, player, client.nick);
        const details = [`${copy.seat} ${player + 1}`, memberLoadText(member)];
        if (saved !== null) {
          details.push(formatMessage(copy.savedPlayer, { nick: saved.nick }));
          if (saved.recommended) details.push(copy.previousSeat);
        }
        const mine = seat.nick === client.nick;
        name.textContent =
          seat.nick ?? (seat.mode === 'ai' ? copy.ai : seat.mode === 'absent' ? copy.absentSeat : copy.empty);
        const slot = deps.mapPreview?.(room.settings.world)?.players.find((slot) => slot.player === player);
        faction.textContent =
          localizedMapText(slot?.name, currentLocale()) ??
          (civilization === null ? '' : tribeName(seat.tribe ?? civilization));
        faction.hidden = faction.textContent === '';
        yours.hidden = !mine;
        host.hidden = seat.nick !== room.creator;
        detail.textContent = details.filter(Boolean).join(' · ');
        readiness.textContent = status;
        readiness.hidden = status === '';
        readiness.classList.toggle('is-ready', seat.ready && member?.connected === true);
        row.classList.toggle('is-yours', mine);
        row.classList.toggle('is-occupied', seat.nick !== null);
        row.setAttribute(
          'aria-label',
          `${copy.seat} ${player + 1}: ${name.textContent}${mine ? ` · ${copy.you}` : ''}`,
        );
        take.textContent = permissions.self?.seat == null ? copy.takeSeat : copy.changeSeat;
        mode.root.hidden = seat.nick !== null;
        human.hidden = seat.nick === null;
        chip.update({ value: seat.color, disabled: frozen, expanded: paletteSeat === player });
        paintPalette(room, seat, frozen);
        mode.update(seat.mode, !permissions.creator || seat.nick !== null);
        tribe?.update(seat, !canSetSeatTribe(room, seat, client.nick, connected));
        // Only a seat the computer plays takes a level.
        difficulty.root.classList.toggle('is-unused', seat.difficulty === undefined || seat.mode !== 'ai');
        if (seat.difficulty !== undefined)
          difficulty.update(seat.difficulty, !canSetSeatDifficulty(room, client.nick, connected));
        take.disabled = !canClaimSeat(room, seat, client.nick, connected);
        take.hidden = seat.nick !== null;
      },
    };
  }
  return {
    root,
    /** True when a palette was open and is now closed. */
    closePalette(): boolean {
      if (paletteSeat === null) return false;
      showPalette(null);
      return true;
    },
    update(room: RoomView, connected: boolean): void {
      shown = { room, connected };
      const hasDifficulty = room.seats.some((seat) => seat.mode === 'ai' && seat.difficulty !== undefined);
      root.classList.toggle('has-difficulty', hasDifficulty);
      if (difficultyHeading instanceof HTMLElement) difficultyHeading.hidden = !hasDifficulty;
      const present = new Set(room.seats.map((seat) => seat.player));
      for (const [player, row] of rows)
        if (!present.has(player)) {
          row.row.remove();
          rows.delete(player);
        }
      for (const seat of room.seats) {
        let row = rows.get(seat.player);
        if (row === undefined) {
          row = seatRow(
            seat.player,
            seat.offers,
            room.settings.initialSave !== undefined,
            seatCivilization(seat),
          );
          rows.set(seat.player, row);
          root.append(row.row);
        }
        row.update(room, seat, connected);
      }
    },
  };
}
