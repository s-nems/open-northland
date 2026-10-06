import { type ChatLine, MAX_CHAT_LENGTH, type RoomView } from '@open-northland/net-protocol';
import { quietTextField } from '../../../../hud/dom/parts/text-field.js';
import { formatMessage, messages } from '../../../../i18n/index.js';
import { memberLoadText } from '../../../../view/net/member-load.js';
import { node } from '../../dom.js';
import { createMapDetailsCard } from '../../map-card.js';
import type { MapSelectItem } from '../../map-select-model.js';
import { button } from './controls.js';
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
  const element = node('section', 'network-room');
  const heading = node('header', 'network-room__heading');
  const title = node('h1', '', copy.title);
  const identity = node('p', 'network-room__muted');
  const titleGroup = node('div');
  const titleLine = node('div', 'network-room__title-line');
  const compatible = node('p', 'network-room__compatible', copy.compatible);
  compatible.setAttribute('role', 'status');
  compatible.hidden = true;
  titleLine.append(title, compatible);
  titleGroup.append(titleLine, identity);
  heading.append(titleGroup, button(copy.leave, deps.onLeave));
  const noticeLine = node('p', 'network-room__notice');
  noticeLine.setAttribute('role', 'status');
  noticeLine.hidden = true;
  const linkLine = node('p', 'network-room__notice', copy.reconnecting);
  linkLine.hidden = true;
  const seats = roomSeats(deps);
  const settings = roomSettings(deps);
  const body = node('div', 'network-room__body');
  const setup = node('div', 'network-room__setup');
  const preview = createMapDetailsCard();
  preview.root.classList.add('network-room__map-card');
  let previewItem: MapSelectItem | null = null;
  const roster = node('section', 'network-room__card network-room__roster');
  const members = node('p', 'network-room__muted');
  roster.append(node('h3', '', copy.players), seats.root, members);
  const checks = node('section', 'network-room__card network-room__checks');
  const issues = node('div', 'network-room__issues');
  issues.setAttribute('role', 'status');
  const retry = button(copy.retry, deps.onRetryCompatibility);
  checks.append(node('h3', '', copy.compatibility), issues, retry);
  const chat = node('section', 'network-room__card network-room__chat');
  const log = node('div', 'network-room__chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', copy.chat);
  log.tabIndex = 0;
  const chatEmpty = node('p', 'network-room__muted', copy.chatEmpty);
  const form = node('form', 'network-room__chat-form');
  const input = node('input');
  input.type = 'text';
  quietTextField(input);
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
  chat.append(node('h3', '', copy.chat), chatEmpty, log, form);
  body.append(roster, chat);
  setup.append(settings.root, preview.root);
  const footer = node('footer', 'network-room__actions');
  const guidance = node('div', 'network-room__guidance');
  const mySeat = node('strong');
  const hint = node('p', 'network-room__muted', copy.waiting);
  guidance.append(mySeat, hint);
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
  footer.append(guidance, release, ready, start, ...(rejoin === null ? [] : [rejoin]));
  element.append(heading, noticeLine, linkLine, checks, body, setup, footer);
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
      identity.textContent = `${copy.title} · ${room.id} · ${deps.worldTitle(room.settings.world)} · ${client.nick}`;
      linkLine.hidden = connected;
      seats.update(room, connected);
      settings.update(room, permissions.creator);
      const map = deps.mapPreview?.(room.settings.world) ?? null;
      setup.classList.toggle('has-preview', map !== null);
      if (map !== previewItem) {
        previewItem = map;
        if (map === null) preview.hide();
        else preview.show(map);
      }
      members.textContent = room.members
        .filter((member) => member.seat === null)
        .map((member) =>
          [member.nick, copy.unseated, member.connected ? '' : copy.disconnected, memberLoadText(member)]
            .filter(Boolean)
            .join(' · '),
        )
        .join(' · ');
      members.hidden = members.textContent === '';
      const net = messages().net;
      issues.replaceChildren(
        ...permissions.issues.map((issue) =>
          node(
            'p',
            '',
            formatMessage(issue.reason === 'missing' ? net.compatibilityMissing : net.compatibilityMismatch, {
              nick: issue.nick,
              kind: net.compatibilityKinds[issue.kind],
            }),
          ),
        ),
      );
      compatible.hidden = permissions.issues.length !== 0;
      checks.hidden = permissions.issues.length === 0;
      retry.disabled = !permissions.interactive;
      input.disabled = !permissions.interactive;
      send.disabled = !permissions.interactive;
      const rejoinable = rejoin !== null;
      release.hidden = rejoinable || permissions.self?.seat == null;
      mySeat.textContent =
        permissions.self?.seat == null
          ? copy.unseated
          : formatMessage(copy.yourSeat, { seat: permissions.self.seat + 1 });
      release.disabled = !permissions.interactive || permissions.self?.seat == null;
      ready.hidden = rejoinable;
      ready.disabled = !permissions.canReady;
      ready.textContent = permissions.ready ? copy.withdrawReady : copy.becomeReady;
      ready.setAttribute('aria-pressed', String(permissions.ready));
      start.hidden = rejoinable || room.creator !== client.nick;
      start.disabled = !permissions.canStart;
      if (rejoin !== null) rejoin.disabled = !permissions.canRejoin;
      ready.classList.toggle('network-room__button--primary', !permissions.ready);
      hint.textContent = rejoinable
        ? copy.inProgress
        : !connected
          ? copy.reconnecting
          : permissions.self?.seat == null
            ? copy.chooseSeat
            : permissions.issues.length > 0
              ? copy.checkFiles
              : !permissions.ready
                ? copy.readyHint
                : permissions.canStart
                  ? copy.hostHint
                  : permissions.creator
                    ? copy.waiting
                    : copy.guestHint;
    },
    observeChat(line: ChatLine): void {
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
      chatEmpty.hidden = true;
      log.append(chatRow(line));
      while (log.childElementCount > CHAT_LOG_LINES) log.firstElementChild?.remove();
      if (atEnd || line.from === client.nick) log.scrollTop = log.scrollHeight;
    },
    /** The room's whole log as the relay replays it to a member entering or returning. */
    showChat(lines: readonly ChatLine[]): void {
      chatEmpty.hidden = lines.length > 0;
      log.replaceChildren(...lines.slice(-CHAT_LOG_LINES).map(chatRow));
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

function chatRow(line: ChatLine): HTMLElement {
  const row = node('p');
  row.append(node('strong', '', `${line.from}: `), document.createTextNode(line.text));
  return row;
}
