import type { GameSession } from '@open-northland/lockstep';
import { verifyInitialSave } from '@open-northland/net-client';
import { MAX_LOADING_PROGRESS, type RelayReason, type ServerMessage } from '@open-northland/net-protocol';
import { serializeSaveGame } from '@open-northland/sim';
import { errorText } from '../../diag/error-text.js';
import {
  answeredWithin,
  currentDiagGameSession,
  diag,
  REPORT_ANSWER_TIMEOUT_MS,
  setDiagGameSession,
} from '../../diag/index.js';
import type { NetPanelSource } from '../../hud/network/model.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { swapToEntry } from '../../launch.js';
import type { NetWorldPort, RelayedWorldHosting } from '../../net/connection.js';
import type { NetworkHandover } from '../../net/handover.js';
import { deliveredMatchEnd, inputDelayMs, relayedSessionDriver } from '../../net/net-worker-client.js';
import {
  relayCloseText,
  relayFailureText,
  relayReasonText,
  worldFailureTitle,
} from '../../net/relay-reason.js';
import { networkSaveSession } from '../../net/save-session.js';
import { dismissBootProgress, mountBootNotice } from '../../view/boot-progress.js';
import { bindDisplayMode } from '../../view/fullscreen.js';
import { BUTTON_STYLE, el, mountMessage } from '../../view/overlay.js';
import { menuSearch } from '../../view/params.js';
import type { GameViewHandle } from '../../view/runtime/game-view.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import { type AssembledMapWorld, assembleMapWorld, presentMapWorld, type RestoredSave } from '../map/boot.js';
import { mountNetHud, type NetHud } from './net-hud.js';
import { rejoinProbe } from './rejoin.js';
import {
  hostRelayedWorld,
  type RelayedMapWorld,
  releaseRelayedWorld,
  type VerifiedStart,
} from './relayed-world.js';
import { roomExitObserver } from './room-exit.js';
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
      view.destroy();
      view = null;
    }
    if (assembled !== null && presentingWorld !== assembled) release(assembled);
    assembled = null;
  }
  function dispose(): void {
    if (closed) return;
    closed = true;
    revision++;
    scope.abort();
    startWait.end();
    unsubscribe();
    connection.dispose();
    clearWorld();
    dismissBootProgress();
  }
  function returnToMenu(): void {
    void swapToEntry(menuSearch(), dispose).catch((error: unknown) => fail(error));
  }
  /** End the game on `error`, under `title`: a world that could not open names that, anything else
   *  ends a game that stood. */
  function fail(error: unknown, title: string = copy.gameEndedTitle): void {
    if (closed) return;
    diag.warn('net', 'network game halted', { error: errorText(error) });
    const starting = startWait.pending;
    dispose();
    if (starting) {
      const remove = mountBootNotice(copy.startFailedTitle, relayFailureText(error), {
        label: messages().hud.returnToMenu,
        onClick: () => void swapToEntry(menuSearch(), remove),
      });
      return;
    }
    const back = el('button', BUTTON_STYLE, messages().hud.returnToMenu);
    back.type = 'button';
    const remove = mountMessage(title, relayFailureText(error), [back]);
    back.addEventListener('click', () => {
      void swapToEntry(menuSearch(), remove);
    });
  }
  const startWait = createStartWait(client);

  const exit = roomExitObserver((reason) => fail(roomEndText(reason)));
  const rejoin = rejoinProbe(client);
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'failure') {
      fail(event.error, worldFailureTitle(event.what, event.error) ?? undefined);
      return;
    }
    if (event.kind === 'link') {
      hud?.link(event.state, event.reason);
      return;
    }
    if (exit(event.message)) return;
    const rejoined = rejoin.observe(event.message);
    if (rejoined === 'consumed') return;
    if (rejoined !== 'passed') {
      fail(rejoined.text);
      return;
    }
    if (event.message.kind === 'desync') lastDesync = event.message;
    if (event.message.kind === 'kicked' && event.message.player === client.session?.localSeat) {
      fail(copy.youWereKicked);
      return;
    }
    startWait.observe(event.message);
    hud?.observe(event.message);
  });
  // A link that closed between the handover and this subscription would otherwise never be heard of.
  if (connection.linkState?.state === 'closed') fail(relayCloseText(connection.linkState.reason));

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
      const world = await assembleMapWorld(activeCanvas, params, {
        hostWorld: (inputs) => hostRelayedWorld(host, inputs, params, start),
        multiplayer: true,
        onBootProgress: (fraction) => {
          const percent = Math.round(fraction * MAX_LOADING_PROGRESS);
          startWait.progress(percent);
          client.reportLoading(percent);
        },
        mapId: map.mapId,
        stagedSave: save,
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
      await build(session, { header }, null, host, mine);
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
      sharedClock: true,
      confirmedMatchEnd: () => deliveredMatchEnd(client, session.host),
      networkSave: networkSaveSession(client, worldId),
      introAtStart: false,
      netReadout: readout,
      netPanel,
      untilStart: () => startWait.untilStart(() => !closed && mine === revision),
      onReturnToMenu: returnToMenu,
    })
      .then((presented) => {
        if (closed || mine !== revision) {
          presented.destroy();
          release(world);
          return;
        }
        view = presented;
        hud = mountNetHud({ client, readout, relayUrl: connection.url });
        // A link event while the world was rebuilt had no HUD to reach.
        const link = connection.linkState;
        if (link === null) hud.link('reconnecting');
        else if (link.state !== 'ok') hud.link(link.state, link.reason);
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

/** Why the room ended, a start that never came worded as such. */
function roomEndText(reason: RelayReason | null): string {
  const copy = messages().net;
  if (reason === null) return copy.roomEnded;
  if (reason.code === 'loadingTimedOut') return formatMessage(copy.startTimedOut, { nick: reason.nick });
  if (reason.code === 'leftBeforeStart') return formatMessage(copy.startLeft, { nick: reason.nick });
  return `${copy.roomEnded}: ${relayReasonText(reason)}`;
}
