// @vitest-environment jsdom
import { MAP_TYPE } from '@open-northland/data';
import { PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { type MapSelectItem, mapItem } from '../../../../../src/entries/main-menu/map-select/model.js';
import {
  mountNetworkRoom,
  type NetworkRoomDeps,
} from '../../../../../src/entries/main-menu/network/room/index.js';
import { formatClockTime, messages } from '../../../../../src/i18n/index.js';
import { TINY_FINGERPRINT } from '../../../../support/catalog-maps.js';

const mounted: Array<ReturnType<typeof mountNetworkRoom>> = [];
afterEach(() => {
  for (const room of mounted.splice(0)) room.dispose();
  document.body.replaceChildren();
});

function lobby(): RoomView {
  return {
    id: 'test',
    creator: 'Astrid',
    state: 'lobby',
    settings: {
      name: 'Expedition',
      world: { kind: 'map', mapId: 'test' },
      seed: 1,
      rules: {
        fog: null,
        progression: null,
        needs: null,
        weather: null,
        dayNight: null,
        alliedVision: null,
        peace: null,
      },
      speed: 1,
      kickedSeatMode: 'idle',
    },
    seats: [
      {
        player: 0,
        mode: 'idle',
        claimable: true,
        offers: ['idle', 'computer'],
        color: 0,
        nick: null,
        ready: false,
      },
    ],
    members: [
      {
        nick: 'Astrid',
        seat: null,
        connected: true,
        compatibility: {
          content: 'a'.repeat(64),
          map: 'b'.repeat(64),
          client: 'test',
          protocol: PROTOCOL_VERSION,
        },
        load: null,
        loading: null,
        roundTripMs: null,
        delayTicks: null,
        behindTicks: 0,
      },
    ],
  };
}
function mount(
  mapPreview: NetworkRoomDeps['mapPreview'] = () => null,
  mapSlots?: NetworkRoomDeps['mapSlots'],
) {
  const client = {
    nick: 'Astrid',
    claimSeat: vi.fn(),
    moveMember: vi.fn(),
    setSeat: vi.fn(),
    setSettings: vi.fn(),
    setReady: vi.fn(),
    start: vi.fn(),
    say: vi.fn(),
  };
  const room = mountNetworkRoom({
    client,
    mapPreview,
    ...(mapSlots === undefined ? {} : { mapSlots }),
    copy: messages().networkRoom,
    onLeave: vi.fn(),
    rejoin: null,
    onRetryCompatibility: vi.fn(),
    worldTitle: () => 'Test map',
  });
  mounted.push(room);
  document.body.append(room.element);
  const button = (text: string): HTMLButtonElement => {
    const result = [...room.element.querySelectorAll('button')].find((button) => button.textContent === text);
    if (result === undefined) throw new Error(`Missing button: ${text}`);
    return result;
  };
  return { room, client, button };
}

describe('multiplayer entry', () => {
  it('hides claims for scenario seats while allowing a claimable computer seat', () => {
    const { room, client, button } = mount();
    const view = lobby();
    room.update(
      { ...view, seats: view.seats.map((seat) => ({ ...seat, mode: 'computer', claimable: false })) },
      true,
    );
    const take = button(messages().networkRoom.takeSeat);
    expect(take.hidden).toBe(true);
    expect(take.disabled).toBe(true);
    take.click();
    expect(client.claimSeat).not.toHaveBeenCalled();
    room.update({ ...view, seats: view.seats.map((seat) => ({ ...seat, mode: 'computer' })) }, true);
    expect(take.hidden).toBe(false);
    expect(take.disabled).toBe(false);
    take.click();
    expect(client.claimSeat).toHaveBeenCalledWith(0);
  });

  it('offers the creator a move for every member, seated or observing', () => {
    const { room, client } = mount();
    const view = lobby();
    const [host] = view.members;
    const [open] = view.seats;
    if (host === undefined || open === undefined) throw new Error('lobby fixture lost its member or seat');
    const seated: RoomView = {
      ...view,
      seats: [
        { ...open, nick: 'Bjorn', ready: true },
        { ...open, player: 1, color: 1 },
      ],
      members: [host, { ...host, nick: 'Bjorn', seat: 0 }],
    };
    room.update(seated, true);
    const moves = [...room.element.querySelectorAll<HTMLElement>('.network-room__move')];
    const visible = moves.filter((move) => !move.hidden);
    expect(visible).toHaveLength(2);
    // jsdom lacks the popover API the menu opens with.
    const proto = HTMLElement.prototype as Partial<Pick<HTMLElement, 'showPopover' | 'hidePopover'>>;
    proto.showPopover = () => {};
    proto.hidePopover = () => {};
    onTestFinished(() => {
      delete proto.showPopover;
      delete proto.hidePopover;
    });
    const pick = (move: HTMLElement | undefined, label: string): void => {
      move?.querySelector('button')?.click();
      const found = [...(move?.querySelectorAll('button') ?? [])].find((button) =>
        button.textContent?.startsWith(label),
      );
      if (found === undefined) throw new Error(`Missing option: ${label}`);
      found.click();
    };
    const seatTwo = `${messages().networkRoom.seat} 2`;
    pick(visible[0], seatTwo);
    expect(client.moveMember).toHaveBeenCalledWith('Bjorn', 1);
    pick(visible[1], seatTwo);
    expect(client.moveMember).toHaveBeenCalledWith('Astrid', 1);
    room.update({ ...seated, creator: 'Bjorn' }, true);
    expect(moves.filter((move) => !move.hidden)).toHaveLength(0);
  });
});

describe('room guidance and chat', () => {
  it('hides a transferred hidden seat even when the local listing shows it', () => {
    const slots = [
      {
        player: 0,
        type: 'human' as const,
        tribeId: 1,
        colorId: 0,
        claimable: true,
        hidden: true,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: true,
      },
    ];
    const stale = mapItem({
      id: 'test',
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      players: slots.map((slot) => ({ ...slot, hidden: false })),
    });
    for (const preview of [null, stale]) {
      const { room } = mount(
        () => preview,
        () => slots,
      );
      room.update(lobby(), true);
      expect(room.element.querySelector<HTMLElement>('.network-room__seat')?.hidden).toBe(true);
    }
  });
  it('hides authored hidden seats while keeping visible map AI reserved', () => {
    const map = mapItem({
      id: 'test',
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      players: [0, 1, 2].map((player) => ({
        player,
        type: player === 0 ? 'human' : 'ai',
        tribeId: 1,
        colorId: player,
        claimable: player === 0,
        hidden: player === 2,
        aiAllowed: true,
        noneAllowed: player === 0,
        hasComputerControl: player === 0,
      })),
    });
    const { room, client } = mount(() => map);
    const base = lobby();
    const view: RoomView = {
      ...base,
      seats: [
        ...base.seats,
        ...[1, 2].map((player) => ({
          player,
          mode: 'map-ai' as const,
          claimable: false,
          offers: ['map-ai'] as const,
          color: player,
          nick: null,
          ready: false,
        })),
      ],
    };
    room.update(view, true);
    const rows = [...room.element.querySelectorAll<HTMLElement>('.network-room__seat')];
    expect(rows.map((row) => row.hidden)).toEqual([false, false, true]);
    const reserved = rows[1];
    if (reserved === undefined) throw new Error('Missing visible map AI seat');
    const claim = [...reserved.querySelectorAll('button')].find(
      (button) => button.textContent === messages().networkRoom.takeSeat,
    );
    expect(claim?.hidden).toBe(true);
    expect(claim?.disabled).toBe(true);
    const modes = [
      ...reserved.querySelectorAll<HTMLButtonElement>(
        `[role="listbox"][aria-label="${messages().networkRoom.seatMode}"] [role="option"]`,
      ),
    ]
      .filter((option) => !option.disabled)
      .map((option) => option.textContent);
    expect(modes).toEqual([messages().networkRoom['map-ai']]);
    expect(view.seats).toHaveLength(3);
    expect(client.setSeat).not.toHaveBeenCalled();
  });

  it('shows the map faction without changing the seat', () => {
    const map = mapItem({
      id: 'test',
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      players: [
        {
          player: 0,
          type: 'human',
          tribeId: 1,
          colorId: 0,
          name: { eng: 'Vikings from Vinland', pol: 'Wikingowie z Vinlandu' },
          claimable: true,
          hidden: false,
          aiAllowed: true,
          noneAllowed: true,
          hasComputerControl: true,
        },
      ],
    });
    const { room, client } = mount(() => map);
    const view = lobby();
    room.update(view, true);
    expect(room.element.querySelector('.network-room__faction')?.textContent).toMatch(/Vinland/);
    expect(client.setSeat).not.toHaveBeenCalled();
  });

  it('shows successful compatibility beside the room title and keeps problems above the roster', () => {
    const { room } = mount();
    const view = lobby();
    room.update(view, true);
    const success = room.element.querySelector<HTMLElement>(
      '.network-room__heading .network-room__compatible',
    );
    const checks = room.element.querySelector<HTMLElement>('.network-room__checks');
    expect(success?.hidden).toBe(false);
    expect(success?.textContent).toBe(messages().networkRoom.compatible);
    expect(checks?.hidden).toBe(true);
    room.update(
      { ...view, members: view.members.map((member) => ({ ...member, compatibility: null })) },
      true,
    );
    expect(success?.hidden).toBe(true);
    expect(checks?.hidden).toBe(false);
    const roster = room.element.querySelector('.network-room__body');
    if (!checks || !roster) throw new Error('Missing room panels');
    expect(checks.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
  it('shows a late map preview and preserves the chosen view across room updates', () => {
    let item: MapSelectItem | null = null;
    const { room } = mount((world) => (world.kind === 'map' ? item : null));
    const view = lobby();
    room.update(view, true);
    const card = room.element.querySelector<HTMLElement>('.network-room__map-card');
    expect(card?.hidden).toBe(true);
    item = mapItem({
      id: 'test',
      fingerprint: TINY_FINGERPRINT,
      picture: true,
      minimap: true,
      mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
    });
    room.update(view, true);
    expect(card?.hidden).toBe(false);
    const image = card?.querySelector<HTMLImageElement>('img');
    expect(image?.getAttribute('src')).toBe('/maps/test.png');
    const mapButton = [...(card?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === messages().mainMenu.mapSelect.previewViews.map,
    );
    mapButton?.click();
    expect(image?.getAttribute('src')).toBe('/maps/test.map.png');
    room.update({ ...view, seats: view.seats.map((seat) => ({ ...seat, ready: true })) }, true);
    expect(image?.getAttribute('src')).toBe('/maps/test.map.png');
    item = null;
    room.update(view, true);
    expect(card?.hidden).toBe(true);
    expect(image?.hasAttribute('src')).toBe(false);
  });
  it('identifies your seat and the host and distinguishes AI seats from empty ones', () => {
    const { room } = mount();
    const view = lobby();
    const base = view.seats[0];
    if (base === undefined) throw new Error('Missing seat');
    room.update(
      {
        ...view,
        seats: [
          { ...base, nick: 'Astrid', mode: 'human' },
          { ...base, player: 1, mode: 'computer' },
          { ...base, player: 2, mode: 'idle' },
        ],
        members: view.members.map((member) => ({ ...member, seat: 0 })),
      },
      true,
    );
    const own = room.element.querySelector('.network-room__seat.is-yours');
    const copy = messages().networkRoom;
    expect(own?.getAttribute('aria-label')).toContain(copy.you);
    expect(own?.querySelector<HTMLElement>('.network-room__badge--you')?.hidden).toBe(false);
    expect(own?.textContent).toContain(copy.host);
    const names = [...room.element.querySelectorAll('.network-room__seat-name')].map((el) => el.textContent);
    expect(names).toEqual(['Astrid', copy.computer, copy.empty]);
    expect(room.element.querySelector('.network-room__guidance strong')?.textContent).toContain('1');
  });

  it('uses switches for explicit rules, preserves inherited rules and disables guest editing', () => {
    const { room, client } = mount();
    const view = lobby();
    const explicit: RoomView = {
      ...view,
      settings: { ...view.settings, rules: { ...view.settings.rules, progression: true, needs: false } },
    };
    room.update(explicit, true);
    const progression = room.element.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${messages().networkRoom.progression}"]`,
    );
    if (progression === null) throw new Error('Missing progression switch');
    expect(progression.getAttribute('aria-checked')).toBe('true');
    expect(progression.parentElement?.hidden).toBe(false);
    progression.click();
    expect(client.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ rules: expect.objectContaining({ progression: false }) }),
    );
    room.update(view, true);
    expect(progression.parentElement?.hidden).toBe(true);
    const fog = room.element.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${messages().mainMenu.lobby.fogOfWarLabel}"]`,
    );
    expect(fog?.parentElement?.hidden).toBe(true);
    room.update({ ...explicit, creator: 'Bjorn' }, true);
    expect(progression.disabled).toBe(true);
  });

  it('keeps departed seats idle when hosting an existing room with AI takeover', () => {
    const { room, client } = mount();
    const view = lobby();
    room.update({ ...view, settings: { ...view.settings, kickedSeatMode: 'computer' } }, true);
    expect(client.setSettings).toHaveBeenCalledWith(expect.objectContaining({ kickedSeatMode: 'idle' }));
  });
  it('guides the host from seat selection through readiness, then handles a lost link', () => {
    const { room, client, button } = mount();
    const copy = messages().networkRoom;
    const view = lobby();
    const hint = (): string | null | undefined =>
      room.element.querySelector('.network-room__actions p')?.textContent;
    room.update(view, true);
    expect(hint()).toBe(messages().mainMenu.lobby.observerDetail);
    expect(button(copy.becomeReady).disabled).toBe(true);
    button(copy.takeSeat).click();
    expect(client.claimSeat).toHaveBeenCalledWith(0);
    const seated: RoomView = {
      ...view,
      seats: view.seats.map((seat) => ({ ...seat, mode: 'human', nick: 'Astrid' })),
      members: view.members.map((member) => ({ ...member, seat: 0 })),
    };
    room.update(seated, true);
    expect(hint()).toBe(copy.readyHint);
    button(copy.becomeReady).click();
    expect(client.setReady).toHaveBeenCalledWith(true);
    room.update({ ...seated, seats: seated.seats.map((seat) => ({ ...seat, ready: true })) }, true);
    expect(hint()).toBe(copy.hostHint);
    expect(button(copy.start).disabled).toBe(false);
    room.update(seated, false);
    expect(hint()).toBe(copy.reconnecting);
    expect(button(copy.start).disabled).toBe(true);
  });

  it('sends a trimmed message and preserves the reader position on incoming chat', () => {
    const { room, client } = mount();
    room.update(lobby(), true);
    const input = room.element.querySelector('input');
    const log = room.element.querySelector<HTMLElement>('[role="log"]');
    const form = room.element.querySelector('form');
    if (input === null || log === null || form === null) throw new Error('Missing chat controls');
    input.value = '  Hello settlers!  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(client.say).toHaveBeenCalledWith('Hello settlers!');
    expect(input.value).toBe('');
    Object.defineProperties(log, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
    log.scrollTop = 100;
    const saidAt = new Date(2026, 0, 1, 21, 47).getTime();
    room.observeChat({ from: 'Bjorn', text: '<b>Hi</b>', at: saidAt, tick: null });
    expect(log.scrollTop).toBe(100);
    expect(log.querySelector('time')?.textContent).toBe(formatClockTime(saidAt));
    expect(log.textContent).toContain('<b>Hi</b>');
    expect(log.querySelector('b')).toBeNull();
    log.scrollTop = 800;
    room.observeChat({ from: 'Bjorn', text: 'Ready?', at: 0, tick: null });
    expect(log.scrollTop).toBe(1000);
    room.update(lobby(), false);
    input.value = 'Offline';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(client.say).toHaveBeenCalledTimes(1);
  });
});

it('always leaves one free observer row after the occupied rows', () => {
  const view = lobby();
  const first = view.members[0];
  if (first === undefined) throw new Error('missing fixture member');
  const { room, client } = mount();
  room.update(view, true);
  expect(room.element.querySelectorAll('.network-room__observer')).toHaveLength(2);
  room.update({ ...view, members: [...view.members, { ...first, nick: 'Guest' }] }, true);
  expect(room.element.querySelectorAll('.network-room__observer')).toHaveLength(3);
  room.update({ ...view, members: [{ ...first, seat: 0 }] }, true);
  const join = room.element.querySelector<HTMLButtonElement>('.network-room__observers button');
  expect(join?.disabled).toBe(false);
  join?.click();
  expect(client.claimSeat).toHaveBeenCalledWith(null);
});
