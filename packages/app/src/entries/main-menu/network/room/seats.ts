import { MAX_SEATS, type RoomSeatView, type RoomView } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../../../i18n/index.js';
import { node } from '../../dom.js';
import { colorChip, colorPalette } from '../../lobby-controls/color.js';
import { seatRow as createSeatRow } from '../../lobby-controls/seat.js';
import { seatModeControl } from '../../lobby-controls/seat-mode.js';
import { button, selectControl } from './controls.js';
import { canClaimSeat, roomPermissions, savedSeatHint } from './model.js';
import type { NetworkRoomDeps } from './types.js';

export function roomSeats(deps: NetworkRoomDeps) {
  const { client, copy } = deps;
  const root = node('section', 'network-room__seats');
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
  function seatRow(player: number) {
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
    const team = selectControl(
      copy.team,
      [
        ['', copy.authored],
        ...Array.from({ length: MAX_SEATS }, (_, index) => [String(index), String(index + 1)] as const),
      ],
      (value) => client.setSeat(player, { team: value === '' ? null : Number(value) }),
    );
    const mode = seatModeControl(
      {
        fieldClassName: 'network-room__field',
        label: copy.seatMode,
        choices: [
          { id: 'idle', label: copy.idle },
          { id: 'ai', label: copy.ai },
          { id: 'human', label: copy.human, disabled: true },
        ],
        change: (mode) => {
          if (mode !== 'human') client.setSeat(player, { mode });
        },
      },
      'select',
    );
    const take = button(copy.takeSeat, () => client.claimSeat(player));
    take.classList.add('network-room__claim');
    const row = createSeatRow({
      className: 'network-room__seat',
      nameClass: 'network-room__seat-name',
      detailClass: 'network-room__muted',
      action: take,
      controls: [color, team.root, mode.root, palette],
    });
    return {
      row: row.root,
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
        const detail = [status];
        if (saved !== null) {
          detail.push(formatMessage(copy.savedPlayer, { nick: saved.nick }));
          if (saved.recommended) detail.push(copy.previousSeat);
        }
        row.update(
          `${copy.seat} ${player + 1} · ${seat.nick ?? copy.empty}`,
          detail.filter(Boolean).join(' · '),
          seat.nick === client.nick,
        );
        chip.update({ value: seat.color, disabled: frozen, expanded: paletteSeat === player });
        paintPalette(room, seat, frozen);
        team.update(String(seat.team ?? ''), frozen);
        mode.update(seat.mode, !permissions.creator || seat.nick !== null);
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
      const present = new Set(room.seats.map((seat) => seat.player));
      for (const [player, row] of rows)
        if (!present.has(player)) {
          row.row.remove();
          rows.delete(player);
        }
      for (const seat of room.seats) {
        let row = rows.get(seat.player);
        if (row === undefined) {
          row = seatRow(seat.player);
          rows.set(seat.player, row);
          root.append(row.row);
        }
        row.update(room, seat, connected);
      }
    },
  };
}
