import type { PlayerFlag, RoomView } from '@open-northland/net-protocol';
import { messages } from '../../../../i18n/index.js';
import { node } from '../../dom.js';
import { nickWithFlag } from '../flags/catalog.js';
import { banMemberControl } from './ban-member.js';
import { button } from './controls.js';
import { moveMemberControl } from './move-member.js';
import type { NetworkRoomDeps } from './types.js';

/** Observers occupy no map seat. One free row always follows the occupied rows. */
export function roomObservers(deps: NetworkRoomDeps) {
  const { client, copy } = deps;
  const text = messages().mainMenu.lobby;
  const root = node('section', 'network-room__observers');
  const list = node('div');
  const free = node('div', 'network-room__observer');
  const join = button(text.choose, () => client.claimSeat(null));
  const label = node('div');
  label.append(node('strong', '', text.observerName), node('p', 'network-room__muted', text.observerDetail));
  free.append(label, join);
  root.append(node('h3', '', copy.observers), list, free);
  // Rows are kept by nick and moved only when the order changes: a detached row would close the
  // creator's open move menu.
  const rows = new Map<string, ReturnType<typeof observerRow>>();
  // A member keeps its flag for as long as it is in the room, so its row takes the flag once.
  function observerRow(nick: string, flag: PlayerFlag | undefined) {
    const row = node('div', 'network-room__observer');
    const you = node('span', 'network-room__badge network-room__badge--you', copy.you);
    const away = node('span', 'network-room__muted', copy.disconnected);
    const move = moveMemberControl(deps);
    const ban = banMemberControl(deps);
    you.hidden = nick !== client.nick;
    row.append(nickWithFlag('strong', '', nick, flag), you, away, move.root, ban.root);
    return {
      row,
      update(room: RoomView, connected: boolean, interactive: boolean): void {
        away.hidden = connected;
        move.update(room, nick, null, interactive);
        ban.update(room, nick, interactive);
      },
    };
  }
  return {
    root,
    update(room: RoomView, connected: boolean): void {
      const observers = room.members.filter((member) => member.seat === null);
      for (const [nick, row] of rows)
        if (!observers.some((member) => member.nick === nick)) {
          row.row.remove();
          rows.delete(nick);
        }
      const interactive = connected && room.state === 'lobby';
      observers.forEach((member, index) => {
        let row = rows.get(member.nick);
        if (row === undefined) {
          row = observerRow(member.nick, member.flag);
          rows.set(member.nick, row);
        }
        row.update(room, member.connected, interactive);
        if (list.children.item(index) !== row.row) list.insertBefore(row.row, list.children.item(index));
      });
      const self = room.members.find((member) => member.nick === client.nick);
      join.disabled = !connected || room.state !== 'lobby' || self === undefined || self.seat === null;
    },
  };
}
