import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { LOAD_VIEW_INTERVAL_MS } from '../src/index.js';
import { digest, LOAD, startedRoom } from './support/message-stage.js';

/** The load each client reports with its acknowledgements, as the room view shows it. */

const SLOW = { tickMs: 38.5, buffered: 4 };

describe('member load', () => {
  it('is null for every member before a first acknowledgement', () => {
    const s = startedRoom();
    s.advance(LOAD_VIEW_INTERVAL_MS);
    expect(s.a.last('room')?.room.members.map((member) => member.load)).toEqual([null, null]);
  });

  it('keeps the load an acknowledgement reported, as sent, and shows it in the room view', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', tick: 1, digest: digest(1), world: 0, load: SLOW });
    expect(s.b.handle.member?.load).toEqual(SLOW);
    s.advance(TICK_MS);
    expect(s.a.last('room')?.room.members.map(({ nick, load }) => ({ nick, load }))).toEqual([
      { nick: 'Ania', load: null },
      { nick: 'Bartek', load: SLOW },
    ]);
  });

  it('sends a view for moved loads at most once per interval', () => {
    const s = startedRoom();
    const viewsBefore = s.a.of('room').length;
    const ticks = Math.floor((LOAD_VIEW_INTERVAL_MS * 2) / TICK_MS);
    for (let tick = 1; tick <= ticks; tick++) {
      s.advance(TICK_MS);
      s.a.send({ kind: 'ack', tick, digest: digest(1), world: 0, load: { ...LOAD, buffered: tick } });
      s.b.send({ kind: 'ack', tick, digest: digest(1), world: 0, load: { ...LOAD, buffered: tick } });
    }
    const views = s.a.of('room').slice(viewsBefore);
    expect(views.length).toBeGreaterThan(0);
    expect(views.length).toBeLessThanOrEqual(Math.ceil((ticks * TICK_MS) / LOAD_VIEW_INTERVAL_MS));
  });

  it('sends no view while the reported load stands still', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.a.send({ kind: 'ack', tick: 1, digest: digest(1), world: 0, load: LOAD });
    s.advance(TICK_MS);
    const viewsBefore = s.a.of('room').length;
    for (let tick = 2; tick * TICK_MS <= LOAD_VIEW_INTERVAL_MS * 3; tick++) {
      s.a.send({ kind: 'ack', tick, digest: digest(1), world: 0, load: LOAD });
      s.advance(TICK_MS);
    }
    expect(s.a.of('room').length).toBe(viewsBefore);
  });
});
