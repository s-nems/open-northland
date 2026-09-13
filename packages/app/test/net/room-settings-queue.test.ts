import type { LobbySettings, RoomView } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { roomSettingsQueue } from '../../src/entries/main-menu/network/room/settings-queue.js';

const original: LobbySettings = {
  name: 'Forest',
  seed: 123,
  speed: 1,
  rules: { fog: null, needs: null, progression: null },
};
function view(settings: LobbySettings = original): RoomView {
  return {
    id: 'first',
    state: 'lobby',
    creator: 'host',
    seats: [],
    members: [],
    settings: { ...settings, world: { kind: 'map', mapId: 'forest' }, mapOrigin: 'user' },
  };
}
function setup() {
  const sent: LobbySettings[] = [];
  const send = vi.fn((settings: LobbySettings) => sent.push(settings));
  const queue = roomSettingsQueue(send);
  queue.update(view(), true);
  return { queue, send, sent };
}

describe('lobby settings replacement queue', () => {
  it('rebases quick rule, speed and fallout edits on the acknowledged replacement', () => {
    const { queue, send, sent } = setup();
    queue.change({ rules: { fog: 0 } });
    queue.change({ rules: { needs: false } });
    queue.change({ speed: 2 });
    queue.change({ kickedSeatMode: 'ai' });
    queue.change({ rules: { progression: true } });
    expect(send).toHaveBeenCalledOnce();
    expect(original.rules.fog).toBe(null);
    const first = sent[0];
    expect(first).toBeDefined();
    queue.update(view(first), true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[1]).toEqual({
      ...original,
      speed: 2,
      kickedSeatMode: 'ai',
      rules: { fog: 0, needs: false, progression: true },
    });
    expect(sent[1]).not.toHaveProperty('world');
    expect(sent[1]).not.toHaveProperty('mapOrigin');
    queue.update(view(sent[1]), true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('ignores unrelated room broadcasts and coalesces repeated queued edits', () => {
    const { queue, send, sent } = setup();
    queue.change({ rules: { fog: 0 } });
    queue.change({ speed: 2 });
    queue.change({ speed: 3 });
    queue.update(
      { ...view(), members: [{ nick: 'guest', seat: null, connected: true, compatibility: null }] },
      true,
    );
    expect(send).toHaveBeenCalledOnce();
    queue.update(view(sent[0]), true);
    expect(sent[1]?.speed).toBe(3);
    expect(sent[1]?.rules.fog).toBe(0);
  });

  it('drops rejected and queued edits, then uses the last authoritative state', () => {
    const { queue, send, sent } = setup();
    queue.change({ rules: { fog: 0 } });
    queue.change({ rules: { needs: false } });
    queue.rejected();
    queue.change({ speed: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[1]).toEqual({ ...original, speed: 2 });
  });

  it.each([
    'offline',
    'otherRoom',
    'running',
    'disposed',
  ] as const)('discards pending edits on %s', (exit) => {
    const { queue, send, sent } = setup();
    queue.change({ rules: { fog: 0 } });
    queue.change({ rules: { needs: false } });
    if (exit === 'disposed') queue.dispose();
    else
      queue.update(
        {
          ...view(),
          id: exit === 'otherRoom' ? 'second' : 'first',
          state: exit === 'running' ? 'running' : 'lobby',
        },
        exit !== 'offline',
      );
    queue.update(view(sent[0]), true);
    expect(send).toHaveBeenCalledOnce();
    queue.change({ speed: 3 });
    if (exit === 'disposed') {
      expect(send).toHaveBeenCalledOnce();
      return;
    }
    expect(sent[1]?.rules).toEqual({ fog: 0, needs: null, progression: null });
  });

  it('does not wait for no-op echoes and can reset fallout to the authored policy', () => {
    const { queue, send, sent } = setup();
    queue.change({ speed: 1 });
    queue.change({ kickedSeatMode: null });
    expect(send).not.toHaveBeenCalled();
    queue.update(view({ ...original, kickedSeatMode: 'ai' }), true);
    queue.change({ kickedSeatMode: null });
    expect(sent[0]).not.toHaveProperty('kickedSeatMode');
    queue.update(view(sent[0]), true);
    queue.change({ speed: 2 });
    expect(sent[1]?.speed).toBe(2);
  });
});
