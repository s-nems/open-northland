import { describe, expect, it } from 'vitest';
import { LOAD_VIEW_INTERVAL_MS } from '../src/index.js';
import { SEATS, SETTINGS, stage, startingRoom, TOKEN_A } from './support/message-stage.js';

/** The boot progress each client reports before its world loads, as the room view shows it. */

const HALFWAY = 50;
const NEARLY = 90;

describe('member boot progress', () => {
  it('shows what each member reported until its world loads, while the clock waits', () => {
    const s = startingRoom();
    s.a.send({ kind: 'loading', progress: NEARLY });
    s.b.send({ kind: 'loading', progress: HALFWAY });
    s.advance(LOAD_VIEW_INTERVAL_MS);
    const progress = () => s.a.last('room')?.room.members.map(({ nick, loading }) => ({ nick, loading }));
    expect(progress()).toEqual([
      { nick: 'Ania', loading: NEARLY },
      { nick: 'Bartek', loading: HALFWAY },
    ]);
    s.a.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(LOAD_VIEW_INTERVAL_MS);
    expect(s.a.last('clock')).toBeUndefined();
    expect(s.a.last('waiting')?.for.map(({ nick, reason }) => ({ nick, reason }))).toEqual([
      { nick: 'Bartek', reason: 'loading' },
    ]);
    s.b.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(LOAD_VIEW_INTERVAL_MS);
    expect(s.a.last('clock')?.paused).toBe(false);
    expect(progress()).toEqual([
      { nick: 'Ania', loading: null },
      { nick: 'Bartek', loading: null },
    ]);
  });

  it('ignores a report from a member whose world has loaded, without refusing it', () => {
    const s = startingRoom();
    s.a.send({ kind: 'loaded', tick: 0, world: 0 });
    s.a.send({ kind: 'loading', progress: HALFWAY });
    expect(s.a.handle.member?.loading).toBeNull();
    expect(s.a.of('rejected')).toEqual([]);
  });

  it('refuses a report in a room that has not started', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'loading', progress: HALFWAY });
    expect(a.last('rejected')?.reason).toEqual({ code: 'gameNotStarted' });
  });
});
