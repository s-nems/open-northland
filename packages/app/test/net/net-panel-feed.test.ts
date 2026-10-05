import {
  type ChatLine,
  PROTOCOL_VERSION,
  type RoomMemberView,
  type RoomView,
  type ServerMessage,
  TICK_MS,
  TICKS_PER_SECOND,
} from '@open-northland/net-protocol';
import { LAG_BEHIND_MS } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import {
  CATCHING_UP_BEHIND_MS,
  createRelayPanelFeed,
  unseenHistory,
} from '../../src/entries/relay/net-panel-feed.js';
import { RelayClientMirror } from '../../src/net/net-worker-client.js';
import type { RelayFacts } from '../../src/session/worker/net-protocol.js';
import type { NetReadout } from '../../src/view/runtime/net-readout.js';

const REQUESTED_SPEED = 3;
const GOVERNED_SPEED = 2;
const VOTE_AFTER_MS = 5000;
const SECOND_MS = 1000;
const BUDGET_MS = TICK_MS / GOVERNED_SPEED;

const member = (nick: string, seat: number | null, extra: Partial<RoomMemberView> = {}): RoomMemberView => ({
  nick,
  seat,
  connected: true,
  compatibility: null,
  load: null,
  loading: null,
  roundTripMs: null,
  delayTicks: null,
  behindTicks: 0,
  ...extra,
});

/** Lag thresholds at the governed speed the room below runs at. */
const LAG_TICKS = Math.ceil((CATCHING_UP_BEHIND_MS / TICK_MS) * GOVERNED_SPEED);

const ROOM: RoomView = {
  id: 'r1',
  state: 'running',
  creator: 'Ania',
  settings: {
    name: 'las',
    world: { kind: 'map', mapId: 'las' },
    seed: 7,
    rules: { fog: null, progression: null, needs: null, weather: null },
    speed: REQUESTED_SPEED,
  },
  seats: [],
  members: [
    member('Ania', 1, { roundTripMs: 40, delayTicks: 3, load: { tickMs: BUDGET_MS / 2, buffered: 0 } }),
    member('Bartek', 2, { roundTripMs: 120, delayTicks: 5 }),
    member('Celina', 3, { behindTicks: LAG_TICKS + 1 }),
    member('Dorota', 4, { behindTicks: LAG_TICKS }),
    member('Edek', 5, { load: { tickMs: BUDGET_MS * 2, buffered: 0 } }),
    member('Franek', null, { connected: false, roundTripMs: null }),
  ],
};

const READOUT: NetReadout = {
  connected: true,
  roundTripMs: 40,
  delayTicks: 3,
  delayMs: 150,
  clickToApplyMs: null,
  bufferedTicks: 1,
};

const FACTS: RelayFacts = {
  tick: 0,
  paused: false,
  speed: REQUESTED_SPEED,
  bufferedTicks: 0,
  droppedTicks: 0,
  clickToApplyMs: null,
  resultTick: null,
  endedTick: null,
  isOutOfSync: false,
  worldId: 1,
};

const clock = (governed: Extract<ServerMessage, { kind: 'clock' }>['governed']): ServerMessage => ({
  kind: 'clock',
  tick: 100,
  speed: REQUESTED_SPEED,
  paused: false,
  by: null,
  governed,
});

/** A feed over a mirror of the client, fed the messages a test sends, on a clock the test moves. */
function setup(messages: readonly ServerMessage[] = []) {
  const client = new RelayClientMirror(
    'Ania',
    () => undefined,
    async () => null,
  );
  const time = { ms: 0 };
  const opening: readonly ServerMessage[] = [
    { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania', build: 'relay-7' },
    { kind: 'room', room: ROOM },
    clock({ nick: 'Edek', speed: GOVERNED_SPEED, cause: 'lag' }),
    ...messages,
  ];
  for (const message of opening) client.apply(message);
  client.follow(FACTS);
  const feed = createRelayPanelFeed({
    client,
    readout: () => READOUT,
    relayUrl: 'wss://relay.example',
    now: () => time.ms,
  });
  const send = (message: ServerMessage): void => {
    client.apply(message);
    feed.observe(message);
  };
  return { client, feed, time, send };
}

const rowOf = (feed: ReturnType<typeof setup>['feed'], nick: string) =>
  feed.model().players.find((row) => row.nick === nick);

describe('the relayed network panel feed', () => {
  it('counts catching up from the relay’s own lag threshold', () => {
    expect(CATCHING_UP_BEHIND_MS).toBe(LAG_BEHIND_MS);
  });

  it('reads each row’s status, link and tick cost off the room view and the clock', () => {
    const { feed, send } = setup();
    send({ kind: 'waiting', for: [{ nick: 'Bartek', reason: 'silent', voteAfterMs: VOTE_AFTER_MS }] });
    const rows = feed.model().players;
    expect(rows.map((row) => [row.nick, row.status])).toEqual([
      ['Ania', 'ok'],
      ['Bartek', 'silent'],
      ['Celina', 'catchingUp'],
      ['Dorota', 'ok'],
      ['Edek', 'slowing'],
      ['Franek', 'gone'],
    ]);
    expect(rows.map((row) => [row.pingMs, row.delayTicks])).toEqual([
      [40, 3],
      [120, 5],
      [null, null],
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(rows[0]?.tickCostPct).toBeCloseTo(50);
    expect(rows[4]?.tickCostPct).toBeCloseTo(200);
    expect(rows[2]?.behindTicks).toBe(LAG_TICKS + 1);
  });

  it('counts a held member down to its vote, offers it to the others only then, and once per voter', () => {
    const { feed, send, time } = setup();
    send({ kind: 'waiting', for: [{ nick: 'Bartek', reason: 'gone', voteAfterMs: VOTE_AFTER_MS }] });
    time.ms = SECOND_MS + SECOND_MS / 5;
    // Four connected others besides Bartek (Franek is away): half of them rounded up.
    expect(rowOf(feed, 'Bartek')?.vote).toEqual({ voteInSeconds: 4, yes: 0, needed: 2, canVote: false });
    time.ms = VOTE_AFTER_MS;
    expect(rowOf(feed, 'Bartek')?.vote).toEqual({ voteInSeconds: 0, yes: 0, needed: 2, canVote: true });
    send({ kind: 'kickVote', player: 2, nick: 'Bartek', yes: ['Ania'], needed: 2 });
    expect(rowOf(feed, 'Bartek')?.vote).toEqual({ voteInSeconds: 0, yes: 1, needed: 2, canVote: false });
    expect(feed.model().clock.held).toBe(true);

    send({ kind: 'waiting', for: [{ nick: 'Ania', reason: 'loading', voteAfterMs: 0 }] });
    expect(rowOf(feed, 'Ania')?.vote?.canVote).toBe(false);
    send({ kind: 'waiting', for: [] });
    expect(feed.model().clock.held).toBe(false);
  });

  it('names the governor and what bounds it, and the relay this client is linked to', () => {
    const { feed } = setup();
    const { clock: shown, link } = feed.model();
    expect(shown).toMatchObject({
      requestedSpeed: REQUESTED_SPEED,
      runningSpeed: GOVERNED_SPEED,
      held: false,
      governor: { nick: 'Edek', cause: 'lag' },
    });
    expect(link).toMatchObject({ relayUrl: 'wss://relay.example', relayBuild: 'relay-7', roundTripMs: 40 });
  });

  it('samples the room speed and the world’s own pace once a second, keeping the model between', () => {
    const { client, feed, time, send } = setup();
    const first = feed.model();
    expect(feed.model()).toBe(first);
    time.ms = SECOND_MS;
    client.follow({ ...FACTS, tick: TICKS_PER_SECOND * GOVERNED_SPEED });
    expect(feed.model().clock.history).toEqual([{ roomSpeed: GOVERNED_SPEED, ownSpeed: GOVERNED_SPEED }]);
    send({ kind: 'waiting', for: [{ nick: 'Bartek', reason: 'gone', voteAfterMs: VOTE_AFTER_MS }] });
    feed.model();
    time.ms = 2 * SECOND_MS;
    feed.model();
    expect(feed.model().clock.history.at(-1)).toEqual({ roomSpeed: 0, ownSpeed: 0 });
  });

  it('shows the room’s chat from before it mounted, its announcements in order, and only the unseen lines of a replay', () => {
    const said = (from: string, text: string, tick: number | null): ChatLine => ({ from, text, tick });
    const lobby = said('Bartek', 'cześć', null);
    const { feed, send, client } = setup([{ kind: 'chatHistory', lines: [lobby] }]);
    expect(feed.model().chat).toEqual([lobby]);
    const before = feed.model().chatVersion;
    send({ kind: 'chat', ...said('Ania', 'gramy', 4) });
    client.follow({ ...FACTS, tick: 9 });
    feed.announce('Bartek stracił połączenie');
    const away = said('Celina', 'czekamy', 12);
    send({ kind: 'chatHistory', lines: [lobby, said('Ania', 'gramy', 4), away] });
    const model = feed.model();
    expect(model.chat).toEqual([
      lobby,
      said('Ania', 'gramy', 4),
      { from: null, text: 'Bartek stracił połączenie', tick: 9 },
      away,
    ]);
    expect(model.chatVersion - before).toBe(3);
  });
});

describe('unseen history', () => {
  const line = (text: string): ChatLine => ({ from: 'Ania', text, tick: null });

  it('takes every line when none was shown, or when the last shown one fell out of the log', () => {
    expect(unseenHistory([], [line('a')])).toEqual([line('a')]);
    expect(unseenHistory([{ from: null, text: 'x', tick: null }], [line('a')])).toEqual([line('a')]);
    expect(unseenHistory([line('gone')], [line('a'), line('b')])).toEqual([line('a'), line('b')]);
    expect(unseenHistory([line('a'), line('b')], [line('a'), line('b')])).toEqual([]);
  });
});
