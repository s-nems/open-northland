import { LINK_QUIET_MS } from '@open-northland/net-client';
import {
  type ChatLine,
  PROTOCOL_VERSION,
  type RoomMemberView,
  type RoomView,
  type ServerMessage,
  TICK_MS,
  TICKS_PER_SECOND,
} from '@open-northland/net-protocol';
import { KICK_COUNTDOWN_MS, LAG_BEHIND_MS, SILENT_AFTER_MS } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import { mountNetHud } from '../../src/entries/relay/net-hud.js';
import {
  CATCHING_UP_BEHIND_MS,
  createRelayPanelFeed,
  RELAY_SILENT_AFTER_MS,
  unseenHistory,
} from '../../src/entries/relay/net-panel-feed.js';
import { KICK_COUNTDOWN_MS as SHOWN_KICK_COUNTDOWN_MS } from '../../src/hud/network/model.js';
import { messages } from '../../src/i18n/index.js';
import { RelayClientMirror } from '../../src/net/net-worker-client.js';
import type { RelayFacts } from '../../src/session/worker/net-protocol.js';
import type { NetReadout } from '../../src/view/runtime/net-readout.js';

const REQUESTED_SPEED = 3;
const GOVERNED_SPEED = 2;
const VOTE_AFTER_MS = 5000;
const SECOND_MS = 1000;
/** Any tick: the verdict's tick plays no part in the hold. */
const ENDED_TICK = 200;
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

/** The lag threshold at the requested speed, as the relay counts it; above the governed speed's, so a
 *  row counted at the running speed would read Dorota as catching up. */
const LAG_TICKS = Math.ceil((CATCHING_UP_BEHIND_MS / TICK_MS) * REQUESTED_SPEED);

const ROOM: RoomView = {
  id: 'r1',
  state: 'running',
  creator: 'Ania',
  settings: {
    name: 'las',
    world: { kind: 'map', mapId: 'las' },
    seed: 7,
    rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
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
  const wall = { ms: 0 };
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
    wallClock: () => wall.ms,
  });
  const send = (message: ServerMessage): void => {
    client.apply(message);
    feed.observe(message);
  };
  return { client, feed, time, wall, send };
}

const rowOf = (feed: ReturnType<typeof setup>['feed'], nick: string) =>
  feed.model().players.find((row) => row.nick === nick);

describe('the relayed network panel feed', () => {
  it('counts catching up from the relay’s own lag threshold, at the requested speed', () => {
    expect(CATCHING_UP_BEHIND_MS).toBe(LAG_BEHIND_MS);
  });

  it('reckons the room’s wait by the relay’s own silence limit and countdown', () => {
    expect(RELAY_SILENT_AFTER_MS).toBe(SILENT_AFTER_MS);
    expect(LINK_QUIET_MS).toBe(SILENT_AFTER_MS);
    expect(SHOWN_KICK_COUNTDOWN_MS).toBe(KICK_COUNTDOWN_MS);
  });

  it('dates a quiet link’s loss from when the relay stopped hearing this client, and keeps it', () => {
    const { feed, time } = setup();
    expect(feed.model().link.loss).toBeNull();
    time.ms = 10_000;
    // Quiet for longer than the relay's limit: the room went without this client that much earlier.
    const quietMs = RELAY_SILENT_AFTER_MS + 2000;
    feed.link({ state: 'quiet', quietMs });
    const lost = feed.model().link;
    expect(lost.loss).toEqual({ kind: 'dropped', waitedSinceMs: time.ms - 2000 });
    expect(lost.notice).toBe(messages().net.reconnecting);
    expect(lost.connected).toBe(true);
    // The socket falls later: the same loss, not a later one.
    time.ms = 15_000;
    feed.link({ state: 'reconnecting', quietMs: 11_000 });
    expect(feed.model().link.loss).toBe(lost.loss);
    feed.link({ state: 'reconnecting', quietMs: 12_000 });
    expect(feed.model().link.loss).toBe(lost.loss);
    // Heard again: no loss, and the next one starts afresh.
    feed.link({ state: 'ok' });
    expect(feed.model().link.loss).toBeNull();
    expect(feed.model().link.notice).toBeNull();
    time.ms = 20_000;
    feed.link({ state: 'reconnecting', quietMs: 300 });
    expect(feed.model().link.loss).toEqual({ kind: 'dropped', waitedSinceMs: 20_000 });
  });

  it('dates a replayed report from when it arrived, not from the replay', () => {
    const { feed, time } = setup();
    time.ms = 30_000;
    // A HUD mounted after a rebuild replays the report the connection kept, 15 s old by then.
    feed.link({ state: 'quiet', quietMs: RELAY_SILENT_AFTER_MS + 1000 }, 15_000);
    expect(feed.model().link.loss).toEqual({ kind: 'dropped', waitedSinceMs: 14_000 });
  });

  it('reports a link that will not reopen with the relay’s reason', () => {
    const { feed } = setup();
    feed.link({ state: 'closed', reason: 'serverRestart' });
    const { loss, notice } = feed.model().link;
    expect(loss?.kind).toBe('closed');
    expect(loss?.kind === 'closed' && loss.reason).toBe(notice);
    expect(notice).not.toBe('');
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
      ['Franek', 'offline'],
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

  it('counts a held member down to its vote, then offers a yes, then its withdrawal', () => {
    const { feed, send, time } = setup();
    send({ kind: 'waiting', for: [{ nick: 'Bartek', reason: 'gone', voteAfterMs: VOTE_AFTER_MS }] });
    time.ms = SECOND_MS + SECOND_MS / 5;
    // Four connected others besides Bartek (Franek is away): a strict majority of them.
    expect(rowOf(feed, 'Bartek')?.vote).toEqual({ voteInSeconds: 4, yes: 0, needed: 3, ballot: null });
    time.ms = VOTE_AFTER_MS;
    expect(rowOf(feed, 'Bartek')?.vote).toEqual({ voteInSeconds: 0, yes: 0, needed: 3, ballot: 'open' });
    send({ kind: 'kickVote', player: 2, nick: 'Bartek', yes: ['Ania'], needed: 3 });
    expect(rowOf(feed, 'Bartek')?.vote).toEqual({ voteInSeconds: 0, yes: 1, needed: 3, ballot: 'cast' });
    send({ kind: 'kickVote', player: 2, nick: 'Bartek', yes: ['Celina'], needed: 3 });
    expect(rowOf(feed, 'Bartek')?.vote).toEqual({ voteInSeconds: 0, yes: 1, needed: 3, ballot: 'open' });
    expect(feed.model().clock.held).toBe(true);

    send({ kind: 'waiting', for: [{ nick: 'Ania', reason: 'loading', voteAfterMs: 0 }] });
    expect(rowOf(feed, 'Ania')?.vote?.ballot).toBeNull();
    send({ kind: 'waiting', for: [] });
    expect(feed.model().clock.held).toBe(false);
  });

  it('reads a member who drops after the verdict as offline, which holds nothing', () => {
    // After a match ends the relay stops waiting for members but still sends their room views.
    const { feed, send } = setup();
    const dropped = ROOM.members.map((row) => (row.nick === 'Bartek' ? { ...row, connected: false } : row));
    send({ kind: 'room', room: { ...ROOM, members: dropped } });
    expect(rowOf(feed, 'Bartek')?.status).toBe('offline');
    expect(feed.model().clock.held).toBe(false);
  });

  it('shows the open tallies the relay replayed before this HUD mounted, and drops them with the wait', () => {
    const { feed, send, time } = setup([
      { kind: 'waiting', for: [{ nick: 'Bartek', reason: 'gone', voteAfterMs: 0 }] },
      { kind: 'kickVote', player: 2, nick: 'Bartek', yes: ['Celina', 'Dorota'], needed: 3 },
    ]);
    time.ms = SECOND_MS;
    expect(rowOf(feed, 'Bartek')?.vote).toMatchObject({ yes: 2, needed: 3, ballot: 'open' });
    send({ kind: 'waiting', for: [] });
    send({ kind: 'waiting', for: [{ nick: 'Bartek', reason: 'silent', voteAfterMs: 0 }] });
    expect(rowOf(feed, 'Bartek')?.vote).toMatchObject({ yes: 0 });
  });

  it('ends the hold at the match’s verdict, though no new wait list came', () => {
    const { feed, send } = setup();
    send({ kind: 'waiting', for: [{ nick: 'Bartek', reason: 'gone', voteAfterMs: VOTE_AFTER_MS }] });
    expect(feed.model().clock.held).toBe(true);
    send({ kind: 'ended', tick: ENDED_TICK, hash: 'verdict' });
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
    const said = (from: string, text: string, at: number, tick: number | null = null): ChatLine => ({
      from,
      text,
      at,
      tick,
    });
    const lobby = said('Bartek', 'cześć', 1);
    const { feed, send, client, wall } = setup([{ kind: 'chatHistory', lines: [lobby] }]);
    expect(feed.model().chat).toEqual([lobby]);
    const before = feed.model().chatVersion;
    send({ kind: 'chat', ...said('Ania', 'gramy', 4, 4) });
    client.follow({ ...FACTS, tick: 9 });
    wall.ms = 9;
    feed.announce('Bartek stracił połączenie');
    const away = said('Celina', 'czekamy', 12, 12);
    send({ kind: 'chatHistory', lines: [lobby, said('Ania', 'gramy', 4, 4), away] });
    const model = feed.model();
    expect(model.chat).toEqual([
      lobby,
      said('Ania', 'gramy', 4, 4),
      { from: null, text: 'Bartek stracił połączenie', at: 9, tick: 9 },
      away,
    ]);
    expect(model.chatVersion - before).toBe(3);
  });
});

describe('unseen history', () => {
  const line = (text: string): ChatLine => ({ from: 'Ania', text, at: 0, tick: null });

  it('takes every line when none was shown, or when the last shown one fell out of the log', () => {
    expect(unseenHistory([], [line('a')])).toEqual([line('a')]);
    expect(unseenHistory([{ from: null, text: 'x', at: 0, tick: null }], [line('a')])).toEqual([line('a')]);
    expect(unseenHistory([line('gone')], [line('a'), line('b')])).toEqual([line('a'), line('b')]);
    expect(unseenHistory([line('a'), line('b')], [line('a'), line('b')])).toEqual([]);
  });
});

describe('the relayed HUD model', () => {
  it('builds once per task, so a frame’s readers share one build', async () => {
    const client = new RelayClientMirror(
      'Ania',
      () => undefined,
      async () => null,
    );
    for (const message of [{ kind: 'room', room: ROOM }, clock(null)] as const) client.apply(message);
    let reads = 0;
    const hud = mountNetHud({
      client,
      readout: () => {
        reads += 1;
        return { ...READOUT, bufferedTicks: reads };
      },
      relayUrl: null,
    });
    const first = hud.model();
    expect(hud.model()).toBe(first);
    expect(reads).toBe(1);
    await Promise.resolve();
    expect(hud.model()).not.toBe(first);
    expect(reads).toBe(2);
  });
});

describe('the chat line cues', () => {
  it("rings another player's line and players coming and going, never the player's own line", () => {
    const client = new RelayClientMirror(
      'Ania',
      () => undefined,
      async () => null,
    );
    for (const message of [{ kind: 'room', room: ROOM }, clock(null)] as const) client.apply(message);
    const hud = mountNetHud({ client, readout: () => READOUT, relayUrl: null });
    const send = (message: ServerMessage): void => {
      client.apply(message);
      hud.observe(message);
    };
    send({ kind: 'chat', from: 'Ania', text: 'hej', at: 5, tick: 5 });
    send({ kind: 'chat', from: 'Edek', text: 'cześć', at: 6, tick: 6 });
    send({ kind: 'room', room: { ...ROOM, members: [...ROOM.members, member('Olek', 6)] } });
    send({ kind: 'kicked', player: 6, nick: 'Olek', mode: 'ai', cause: 'left', tick: 7 });
    expect(
      hud
        .model()
        .chat.slice(-4)
        .map((line) => line.cue ?? null),
    ).toEqual([null, 'chat', 'arrival', 'departure']);
  });
});
