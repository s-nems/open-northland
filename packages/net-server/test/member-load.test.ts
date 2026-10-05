import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_INPUT_DELAY_TICKS, LOAD_VIEW_INTERVAL_MS } from '../src/index.js';
import { digest, LOAD, startedRoom, startingRoom } from './support/message-stage.js';

/** The load each client reports with its acknowledgements, as the room view shows it. */

const SLOW = { tickMs: 38.5, buffered: 4 };
/** The round trip a test's pong reports: answered this long after the ping. */
const MEASURED_TRIP_MS = 120;

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
    s.advance(LOAD_VIEW_INTERVAL_MS);
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

  it('sends no view while the reported load and the lag stand still', () => {
    const s = startedRoom();
    let tick = 0;
    const keepUp = (ms: number): void => {
      for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
        s.advance(TICK_MS);
        tick++;
        for (const peer of [s.a, s.b]) {
          peer.send({ kind: 'ack', tick, digest: digest(1), world: 0, load: LOAD });
          // Answered at once, so every round trip measures the same.
          const ping = peer.last('ping');
          if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
        }
      }
    };
    keepUp(LOAD_VIEW_INTERVAL_MS * 2);
    const viewsBefore = s.a.of('room').length;
    keepUp(LOAD_VIEW_INTERVAL_MS * 3);
    expect(s.a.of('room').length).toBe(viewsBefore);
  });
});

describe('member link and lag', () => {
  it('shows each member’s round trip, delay and ticks behind, and no link for a dropped member', () => {
    const s = startedRoom();
    s.advance(LOAD_VIEW_INTERVAL_MS);
    const ping = s.b.last('ping');
    if (ping === undefined) throw new Error('no ping');
    s.advance(MEASURED_TRIP_MS);
    s.b.send({ kind: 'pong', t: ping.t });
    const emitted = s.a.last('frame')?.tick ?? 0;
    for (let tick = 1; tick <= emitted; tick++)
      s.a.send({ kind: 'ack', tick, digest: digest(1), world: 0, load: LOAD });
    s.advance(LOAD_VIEW_INTERVAL_MS);

    const clockTick = s.a.last('frame')?.tick ?? 0;
    const [ania, bartek] = s.a.last('room')?.room.members ?? [];
    expect(ania).toMatchObject({ behindTicks: clockTick - emitted, delayTicks: INITIAL_INPUT_DELAY_TICKS });
    expect(bartek).toMatchObject({
      roundTripMs: MEASURED_TRIP_MS,
      delayTicks: s.b.last('delay')?.ticks ?? INITIAL_INPUT_DELAY_TICKS,
      behindTicks: clockTick,
    });

    s.relay.disconnect(s.b.handle);
    expect(s.a.last('room')?.room.members[1]).toMatchObject({
      roundTripMs: null,
      delayTicks: null,
      behindTicks: 0,
    });
  });

  it('sends a view for a member falling behind alone, at most once per interval', () => {
    const s = startedRoom();
    const viewsBefore = s.a.of('room').length;
    const advances = Math.floor((LOAD_VIEW_INTERVAL_MS * 3) / TICK_MS);
    for (let advance = 0; advance < advances; advance++) s.advance(TICK_MS);
    const views = s.a.of('room').slice(viewsBefore);
    expect(views.length).toBeGreaterThan(1);
    expect(views.length).toBeLessThanOrEqual(Math.ceil((advances * TICK_MS) / LOAD_VIEW_INTERVAL_MS));
    const behind = views.map((view) => view.room.members[1]?.behindTicks ?? 0);
    expect(behind.every((ticks, i) => ticks > (behind[i - 1] ?? 0))).toBe(true);
  });

  it('reads nothing behind before the clock runs', () => {
    const s = startingRoom();
    s.a.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(LOAD_VIEW_INTERVAL_MS);
    expect(s.a.last('room')?.room.members.map((member) => member.behindTicks)).toEqual([0, 0]);
  });
});
