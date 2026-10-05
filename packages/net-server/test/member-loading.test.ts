import { describe, expect, it } from 'vitest';
import { LOAD_VIEW_INTERVAL_MS, LOADING_STALL_MS } from '../src/index.js';
import { SEATS, SETTINGS, stage, startingRoom, TOKEN_A, TOKEN_B } from './support/message-stage.js';

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

  it('drops a member whose boot stood still too long, and the others start without it', () => {
    const s = startingRoom();
    s.a.send({ kind: 'loaded', tick: 0, world: 0 });
    s.b.send({ kind: 'loading', progress: HALFWAY });
    s.advance(LOADING_STALL_MS - 1);
    expect(s.a.last('clock')).toBeUndefined();
    s.advance(1);
    expect(s.b.last('error')?.reason).toEqual({ code: 'loadingTimedOut' });
    expect(s.a.last('kicked')).toMatchObject({ nick: 'Bartek', cause: 'loading' });
    expect(s.a.last('room')?.room.members.map((member) => member.nick)).toEqual(['Ania']);
    expect(s.a.last('clock')?.paused).toBe(false);
  });

  it('counts the stall from the last progress, not from the start', () => {
    const s = startingRoom();
    s.a.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(LOADING_STALL_MS - 1);
    s.b.send({ kind: 'loading', progress: HALFWAY });
    s.advance(LOADING_STALL_MS - 1);
    expect(s.a.of('kicked')).toEqual([]);
    s.b.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(LOADING_STALL_MS);
    expect(s.a.of('kicked')).toEqual([]);
  });

  it('counts the stall afresh from a member returning mid-boot', () => {
    const s = startingRoom();
    s.a.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(LOADING_STALL_MS - 1);
    const back = s.introduce(TOKEN_B, 'Bartek');
    s.advance(LOADING_STALL_MS - 1);
    expect(s.a.of('kicked')).toEqual([]);
    expect(back.last('start')).toBeDefined();
  });
});
