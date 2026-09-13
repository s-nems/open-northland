import { MAX_CHAT_LENGTH, type RoomView } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../../../i18n/index.js';
import { button, node } from './controls.js';
import { roomPermissions } from './model.js';
import { roomSeats } from './seats.js';
import { roomSettings } from './settings.js';
import type { NetworkRoomDeps } from './types.js';

export type { NetworkRoomCopy, NetworkRoomDeps } from './types.js';

/** Chat lines kept on screen; older ones scroll away for good. */
const CHAT_LOG_LINES = 80;

export function mountNetworkRoom(deps: NetworkRoomDeps) {
  const { client, copy } = deps;
  let current: RoomView | null = null;
  let connected = false;
  const element = node('section', '', 'network-room');
  const heading = node('header', '', 'network-room__heading');
  const title = node('h2', copy.title);
  const identity = node('p', '', 'network-room__muted');
  const titleGroup = node('div');
  titleGroup.append(title, identity);
  heading.append(titleGroup, button(copy.leave, deps.onLeave));
  const noticeLine = node('p', '', 'network-room__notice');
  noticeLine.setAttribute('role', 'status');
  noticeLine.hidden = true;
  const linkLine = node('p', copy.reconnecting, 'network-room__notice');
  linkLine.hidden = true;
  const seats = roomSeats(deps);
  const settings = roomSettings(deps);
  const body = node('div', '', 'network-room__body');
  const roster = node('div', '', 'network-room__roster');
  const members = node('p', '', 'network-room__muted');
  roster.append(seats.root, members);
  body.append(roster, settings.root);
  const checks = node('section', '', 'network-room__card network-room__checks');
  const issues = node('div', '', 'network-room__issues');
  issues.setAttribute('role', 'status');
  const retry = button(copy.retry, deps.onRetryCompatibility);
  checks.append(node('h3', copy.compatibility), issues, retry);
  const chat = node('section', '', 'network-room__card');
  const log = node('div', '', 'network-room__chat-log');
  log.setAttribute('role', 'log');
  const form = node('form', '', 'network-room__chat-form');
  const input = node('input');
  input.type = 'text';
  input.maxLength = MAX_CHAT_LENGTH;
  input.placeholder = copy.chatPlaceholder;
  input.setAttribute('aria-label', copy.chatPlaceholder);
  const send = button(copy.send, () => undefined);
  send.type = 'submit';
  form.append(input, send);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!connected || text === '') return;
    client.say(text);
    input.value = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing && event.key === 'Enter') event.preventDefault();
  });
  chat.append(node('h3', copy.chat), log, form);
  const footer = node('footer', '', 'network-room__actions');
  const hint = node('p', copy.waiting, 'network-room__muted');
  const release = button(copy.releaseSeat, () => client.claimSeat(null));
  const ready = button(copy.becomeReady, () => {
    if (current !== null && !ready.disabled)
      client.setReady(!roomPermissions(current, client.nick, connected).ready);
  });
  const start = button(copy.start, () => {
    if (!start.disabled) client.start();
  });
  start.classList.add('network-room__button--primary');
  const rejoin = deps.rejoin === null ? null : button(copy.rejoin, deps.rejoin);
  rejoin?.classList.add('network-room__button--primary');
  footer.append(hint, release, ready, start, ...(rejoin === null ? [] : [rejoin]));
  element.append(heading, noticeLine, linkLine, checks, footer, body, chat);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && seats.closePalette()) {
      event.stopPropagation();
      event.preventDefault();
    }
  });
  return {
    element,
    update(room: RoomView, online: boolean): void {
      current = room;
      connected = online;
      const permissions = roomPermissions(room, client.nick, connected);
      title.textContent = room.settings.name;
      const world = room.settings.world;
      identity.textContent = `${copy.title} · ${room.id} · ${world.kind === 'map' ? world.mapId : world.sceneId} · ${client.nick}`;
      linkLine.hidden = connected;
      seats.update(room, connected);
      settings.update(room, permissions.creator);
      members.textContent = room.members
        .filter((member) => member.seat === null)
        .map(
          (member) => `${member.nick} · ${copy.unseated}${member.connected ? '' : ` · ${copy.disconnected}`}`,
        )
        .join(' · ');
      const net = messages().net;
      issues.replaceChildren(
        ...(permissions.issues.length === 0
          ? [node('p', copy.compatible)]
          : permissions.issues.map((issue) =>
              node(
                'p',
                formatMessage(
                  issue.reason === 'missing' ? net.compatibilityMissing : net.compatibilityMismatch,
                  { nick: issue.nick, kind: net.compatibilityKinds[issue.kind] },
                ),
              ),
            )),
      );
      retry.disabled = !permissions.interactive;
      input.disabled = !permissions.interactive;
      send.disabled = !permissions.interactive;
      const rejoinable = rejoin !== null;
      release.hidden = rejoinable;
      release.disabled = !permissions.interactive || permissions.self?.seat == null;
      ready.hidden = rejoinable;
      ready.disabled = !permissions.canReady;
      ready.textContent = permissions.ready ? copy.withdrawReady : copy.becomeReady;
      ready.setAttribute('aria-pressed', String(permissions.ready));
      start.hidden = rejoinable || room.creator !== client.nick;
      start.disabled = !permissions.canStart;
      if (rejoin !== null) rejoin.disabled = !permissions.canRejoin;
      hint.textContent = rejoinable ? copy.inProgress : copy.waiting;
      hint.hidden = permissions.canStart;
    },
    observeChat(from: string, text: string): void {
      const row = node('p');
      row.append(node('strong', `${from}: `), document.createTextNode(text));
      log.append(row);
      while (log.childElementCount > CHAT_LOG_LINES) log.firstElementChild?.remove();
      log.scrollTop = log.scrollHeight;
    },
    rejected(of: string): void {
      if (of === 'setSettings') settings.rejected();
    },
    notice(text: string | null): void {
      noticeLine.textContent = text ?? '';
      noticeLine.hidden = text === null;
    },
    dispose(): void {
      settings.dispose();
      connected = false;
      current = null;
      element.remove();
    },
  };
}
