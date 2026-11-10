import type { GameSession } from '@open-northland/lockstep';
import { verifyInitialSave } from '@open-northland/net-client';
import { MAX_LOADING_PROGRESS, type ServerMessage, type SignalNode } from '@open-northland/net-protocol';
import { serializeSaveGame } from '@open-northland/sim';
import { errorText } from '../../diag/error-text.js';
import {
  answeredWithin,
  currentDiagGameSession,
  diag,
  REPORT_ANSWER_TIMEOUT_MS,
  setDiagGameSession,
} from '../../diag/index.js';
import { reportProblem } from '../../diag/report/problem.js';
import type { NetPanelSource } from '../../hud/network/model.js';
import { desyncNotice } from '../../hud/network/text.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { swapToEntry } from '../../launch.js';
import type { NetWorldPort, RelayedWorldHosting } from '../../net/connection.js';
import type { NetworkHandover } from '../../net/handover.js';
import { deliveredMatchEnd, inputDelayMs, relayedSessionDriver } from '../../net/net-worker-client.js';
import {
  ownDepartureText,
  relayCloseText,
  relayFailureText,
  worldFailureTitle,
} from '../../net/relay-reason.js';
import { networkSaveSession } from '../../net/save-session.js';
import { dismissBootProgress } from '../../view/boot/progress.js';
import type { NetSignalSource } from '../../view/map-ping/pings.js';
import type { NetReadout } from '../../view/net/readout.js';
import { mountResyncPlaque, type ResyncPlaque } from '../../view/net/resync-plaque.js';
import { menuSearch } from '../../view/params.js';
import { bindDisplayMode } from '../../view/platform/fullscreen.js';
import { releaseDocument } from '../../view/platform/navigation-guard.js';
import type { GameViewHandle } from '../../view/runtime/game-view.js';
import { type AssembledMapWorld, assembleMapWorld, presentMapWorld, type RestoredSave } from '../map/boot.js';
import { keptView } from './kept-view.js';
import { mountHaltNotice } from './menu-notice.js';
import { mountNetHud, type NetHud } from './net-hud.js';
import {
  hostRelayedWorld,
  type RelayedMapWorld,
  releaseRelayedWorld,
  type VerifiedStart,
} from './relayed-world.js';
import { roomEndText, roomExitObserver } from './room-exit.js';
import { closeKeepsSeat, keptSeat } from './seat-surrender.js';
import { createStartWait } from './start-wait.js';

/** Within the bundle's wait for the whole net report, so the worker's answers' own bound lands first. */
const WORKER_ANSWER_TIMEOUT_MS = REPORT_ANSWER_TIMEOUT_MS / 2;

export function renderNetworkGame(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  handover: NetworkHandover,
): void {
  const { connection, map, initialSave } = handover;
  const { client } = connection;
  const copy = messages().net;
  const scope = new AbortController();
  bindDisplayMode(params, undefined, scope.signal);
  let activeCanvas = canvas;
  let canvasUsed = false;
  let closed = false;
  let revision = 0;
  let assembled: AssembledMapWorld<RelayedMapWorld> | null = null;
  let view: GameViewHandle | null = null;
  let hud: NetHud | null = null;
  let transition: Promise<unknown> = Promise.resolve();
  let presentation: Promise<void> = Promise.resolve();
  let presentingWorld: AssembledMapWorld<RelayedMapWorld> | null = null;
  let lastDesync: Extract<ServerMessage, { kind: 'desync' }> | null = null;
  /** The desync the next world rebuilds from, said on the plaque until that world shows. */
  let resyncing: Extract<ServerMessage, { kind: 'desync' }> | null = null;
  let plaque: ResyncPlaque | null = null;
  function showPlaque(text: string): void {
    if (plaque === null) plaque = mountResyncPlaque(text);
    else plaque.update(text);
  }
  function dismissPlaque(): void {
    plaque?.dispose();
    plaque = null;
  }
  const roomId = client.room?.id ?? params.get('room');
  const kept = roomId === null ? null : keptView(connection.url, roomId);
  const released = new WeakSet<AssembledMapWorld>();
  function release(world: AssembledMapWorld<RelayedMapWorld>): void {
    if (released.has(world)) return;
    released.add(world);
    releaseRelayedWorld(world);
  }
  const readout = (): NetReadout => ({
    connected: connection.connected,
    roundTripMs: client.roundTripMs,
    delayTicks: client.delayTicks,
    delayMs: inputDelayMs(client),
    clickToApplyMs: client.latency.clickToApplyMs,
    bufferedTicks: client.bufferedTicks,
  });

  // The view mounts before the HUD's model exists; until then the panel and its status line stay empty.
  const netPanel: NetPanelSource = {
    model: () => hud?.model() ?? null,
    kick: (seat, yes) => client.kick(seat, yes),
    say: (text) => client.say(text),
    setResponsiveness: (mode) => client.setResponsiveness(mode),
  };

  // Pings outlive a rebuilt world: the view that listens changes, the link does not.
  const signalListeners = new Set<(seat: number, at: SignalNode) => void>();
  const netSignals: NetSignalSource = {
    send: (at, to) => client.signal(at, to),
    listen: (onSignal) => {
      signalListeners.add(onSignal);
      return () => signalListeners.delete(onSignal);
    },
  };

  function clearWorld(): void {
    // Pixi destroys the WebGL context permanently. A later renderer needs a new canvas,
    // including when the previous asynchronous assembly/presentation has not finished yet.
    if (canvasUsed) {
      const next = activeCanvas.cloneNode(false) as HTMLCanvasElement;
      activeCanvas.replaceWith(next);
      activeCanvas = next;
      canvasUsed = false;
    }
    hud = null;
    if (view !== null) {
      const state = view.viewState();
      if (state !== null) kept?.set(state);
      kept?.setMemory(view.presentation());
      view.destroy();
      view = null;
    }
    if (assembled !== null && presentingWorld !== assembled) release(assembled);
    assembled = null;
  }
  /** `leave` gives the seat up; without it the relay keeps the seat for a reconnect. */
  function dispose(leave: boolean): void {
    if (closed) return;
    closed = true;
    revision++;
    scope.abort();
    startWait.end();
    unsubscribe();
    connection.dispose(leave);
    clearWorld();
    dismissPlaque();
    dismissBootProgress();
  }
  /** The player's own way out: the only one that gives the seat up. */
  function returnToMenu(): void {
    void swapToEntry(menuSearch(), () => {
      dispose(true);
      kept?.set(null);
    }).catch((error: unknown) => fail(error));
  }
  /** End the game on `error`, under `title` when the caller names one, else under where the game
   *  stands: a start that never came, or a game that stood. A halt never gives the seat up: while
   *  `seatKept` says the relay may still hold it, the notice offers to retry or to leave. */
  function fail(error: unknown, title: string | null = null, seatKept = true): void {
    if (closed) return;
    diag.warn('net', 'network game halted', { error: errorText(error) });
    const starting = startWait.pending;
    dispose(false);
    // The game is over; closing the tab on the notice loses nothing.
    releaseDocument();
    mountHaltNotice(
      title ?? (starting ? copy.startFailedTitle : copy.gameEndedTitle),
      relayFailureText(error),
      {
        onCard: starting,
        seat: seatKept && roomId !== null ? keptSeat(connection.url, connection.identity, roomId) : null,
        view: kept,
      },
    );
  }
  const startWait = createStartWait(client);
  window.addEventListener(
    'pagehide',
    () => {
      const state = view?.viewState() ?? null;
      if (state !== null) kept?.set(state);
      if (view !== null) kept?.setMemory(view.presentation());
    },
    { signal: scope.signal },
  );

  const exit = roomExitObserver((reason) => fail(roomEndText(reason), null, false));
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'failure') {
      fail(event.error, worldFailureTitle(event.what, event.error), event.what !== 'room');
      return;
    }
    if (event.kind === 'link') {
      const { kind: _kind, atMs, ...report } = event;
      // Without a HUD (loading, or a world being rebuilt) nothing would say the link is gone for good,
      // and the in-game screen's one way out is the menu: a seat the relay may still hold is offered
      // back by the halt notice instead.
      if (event.state === 'closed' && (hud === null || closeKeepsSeat(event.reason))) {
        failClosed(event.reason);
        return;
      }
      startWait.link(event.state);
      hud?.link(report, atMs);
      return;
    }
    if (exit(event.message)) return;
    if (event.message.kind === 'desync') {
      lastDesync = event.message;
      resyncing = event.message;
      // The report's game part reads the room's digests and verdict through `reportNet`'s `net`.
      const { tick, domains, reference } = event.message;
      // Every client of the room reports its desync; the world's seed and tick line their reports up,
      // and the seat tells them apart. The room id stays out: it is the key that joins the room.
      const seat = client.session?.localSeat ?? null;
      // The reference is a player's nick; a report names players by seat.
      const referenceSeat = client.room?.members.find((member) => member.nick === reference)?.seat ?? null;
      reportProblem({ trigger: 'desync', facts: { tick, domains, referenceSeat, seat } });
      // The frozen game says why, before the snapshot arrives and the loading card replaces it.
      showPlaque(desyncNotice(event.message.reference, event.message.tick).text);
    }
    if (event.message.kind === 'kicked' && event.message.player === client.session?.localSeat) {
      fail(ownDepartureText(event.message), null, false);
      return;
    }
    if (event.message.kind === 'signal') {
      const { seat, at } = event.message;
      for (const listener of signalListeners) listener(seat, at);
      return;
    }
    startWait.observe(event.message);
    hud?.observe(event.message);
  });
  function failClosed(reason: string | undefined): void {
    fail(relayCloseText(reason), null, closeKeepsSeat(reason));
  }
  // A link that closed between the handover and this subscription would otherwise never be heard of.
  if (connection.linkState?.state === 'closed') failClosed(connection.linkState.reason);

  function build(
    session: GameSession,
    save: RestoredSave | null,
    start: VerifiedStart | null,
    host: RelayedWorldHosting,
    mine: number,
  ): Promise<void> {
    const previous = transition;
    const work = async () => {
      await previous.catch(() => undefined);
      await presentation.catch(() => undefined);
      if (closed || mine !== revision) return;
      if (
        session.world.kind !== 'map' ||
        session.world.mapId !== map.mapId ||
        (save !== null && save.header.mapId !== map.mapId)
      )
        throw new Error('The session and verified map differ');
      clearWorld();
      canvasUsed = true;
      // A snapshot's view is its donor's: this client's own groups and fog memory, kept as the last world
      // went, win.
      const resync = save !== null && start === null;
      const ownView = resync ? (kept?.get() ?? null) : null;
      const withView =
        ownView === null || save === null ? save : { ...save, header: { ...save.header, view: ownView } };
      const stagedSave =
        withView === null || !resync ? withView : { ...withView, presentation: kept?.memory() ?? null };
      const world = await assembleMapWorld(activeCanvas, params, {
        hostWorld: (inputs) => hostRelayedWorld(host, inputs, params, start),
        multiplayer: true,
        onBootProgress: (fraction) => {
          const percent = Math.round(fraction * MAX_LOADING_PROGRESS);
          startWait.progress(percent);
          client.reportLoading(percent);
        },
        mapId: map.mapId,
        variant: session.world.variant ?? null,
        stagedSave,
        verifiedMap: map,
        sessionFor: () => session,
      });
      if (closed || mine !== revision) {
        if (world !== null) release(world);
        return;
      }
      if (world === null) throw new Error('The verified map could not be opened');
      if (world.loaded === null) {
        release(world);
        throw new Error('The verified map could not be opened');
      }
      assembled = world;
    };
    const result = work();
    transition = result;
    return result;
  }

  /** The relayed session's part of a diagnostics bundle. */
  function reportNet(): void {
    const diagSession = currentDiagGameSession();
    if (diagSession === null) return;
    setDiagGameSession({
      ...diagSession,
      net: async () => {
        // A stalled worker costs the report its answers, not the desync notice this thread holds.
        const [digests, dispute] = await Promise.all([
          answeredWithin(connection.digests(), WORKER_ANSWER_TIMEOUT_MS),
          answeredWithin(connection.dispute(), WORKER_ANSWER_TIMEOUT_MS),
        ]);
        return {
          desync:
            lastDesync === null
              ? null
              : { tick: lastDesync.tick, domains: lastDesync.domains, reference: lastDesync.reference },
          digests: digests ?? [],
          dispute: dispute ?? null,
          delayTicks: client.delayTicks,
          roundTripMs: client.roundTripMs,
          seats: Object.fromEntries((client.room?.members ?? []).map((member) => [member.nick, member.seat])),
        };
      },
    });
  }

  const port: NetWorldPort = {
    async open(session, snapshotTick, host) {
      const mine = ++revision;
      startWait.release();
      if (session.initialSave) {
        if (initialSave === null || (snapshotTick !== null && snapshotTick !== session.initialSave.tick)) {
          return;
        }
        const save = await verifyInitialSave(initialSave.bytes, session.initialSave, map.mapId);
        const start = { text: serializeSaveGame(save), fingerprint: initialSave.identity.fingerprint };
        await build(session, save, start, host, mine);
        return;
      }
      if (snapshotTick !== null) return;
      await build(session, null, null, host, mine);
    },
    async restore(session, header, host) {
      const mine = ++revision;
      startWait.release();
      if (resyncing !== null)
        showPlaque(formatMessage(copy.resyncing, { nick: resyncing.reference, tick: resyncing.tick }));
      await build(session, { header, presentation: null }, null, host, mine);
    },
  };
  connection.bindWorld(port, ({ worldId, session }) => {
    const world = assembled;
    const mine = revision;
    if (closed || world === null || world.hosted.worker !== session) return;
    presentingWorld = world;
    presentation = presentMapWorld(world, {
      driver: relayedSessionDriver(session.driver, client),
      offThreadTickCost: session.offThreadTickCost,
      captureSaveFile: session.captureSaveFile,
      sharedClock: true,
      confirmedMatchEnd: () => deliveredMatchEnd(client, session.host),
      networkSave: networkSaveSession(client, worldId),
      introAtStart: false,
      netReadout: readout,
      netPanel,
      netSignals,
      untilStart: (shown) => {
        // This display has shown the world: the room may count the client loaded. The card then stays
        // up for the rest of the room.
        if (shown && !closed && mine === revision) connection.worldShown(worldId);
        return startWait.untilStart(() => !closed && mine === revision);
      },
      onReturnToMenu: returnToMenu,
      onWatchAfterResult: () => client.claimSeat(null),
    })
      .then((presented) => {
        if (closed || mine !== revision) {
          presented.destroy();
          release(world);
          return;
        }
        view = presented;
        hud = mountNetHud({ client, readout, relayUrl: connection.url });
        dismissPlaque();
        if (resyncing !== null) {
          hud.resynced(resyncing);
          resyncing = null;
        }
        // A link event while the world was rebuilt had no HUD to reach.
        const link = connection.linkState;
        if (link === null) hud.link({ state: 'reconnecting' });
        else if (link.state !== 'ok') hud.link(link, link.atMs);
        reportNet();
      })
      .catch((error: unknown) => {
        if (!closed && mine === revision) fail(error);
      })
      .finally(() => {
        if (presentingWorld === world) presentingWorld = null;
        if (closed || mine !== revision) release(world);
      });
  });
}
