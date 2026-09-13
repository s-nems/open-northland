import { MAX_SEATS, type RoomSeatView, type RoomView } from '@open-northland/net-protocol';
import { formatMessage } from '../../../../i18n/index.js';
import { colorSelect } from '../../lobby-controls/color.js';
import { seatRow as createSeatRow } from '../../lobby-controls/seat.js';
import { seatModeControl } from '../../lobby-controls/seat-mode.js';
import { button, node, selectControl } from './controls.js';
import { canClaimSeat, roomPermissions, savedSeatHint } from './model.js';
import type { NetworkRoomDeps } from './types.js';

export function roomSeats(deps: NetworkRoomDeps) {
  const { client, copy } = deps;
  const root = node('section', '', 'network-room__seats');
  const rows = new Map<number, ReturnType<typeof seatRow>>();
  function seatRow(player: number) {
    const color = colorSelect(
      {
        label: copy.color,
        name: (color) => String(color + 1),
        change: (color) => client.setSeat(player, { color }),
      },
      'network-room__field',
    );
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
      controls: [color.root, team.root, mode.root],
    });
    return {
      row: row.root,
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
        color.update({ value: seat.color, disabled: frozen });
        team.update(String(seat.team ?? ''), frozen);
        mode.update(seat.mode, !permissions.creator || seat.nick !== null);
        take.disabled = !canClaimSeat(room, seat, client.nick, connected);
        take.hidden = seat.nick !== null;
      },
    };
  }
  return {
    root,
    update(room: RoomView, connected: boolean): void {
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
