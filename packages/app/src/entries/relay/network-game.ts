import type { GameSession } from '@open-northland/lockstep';
import { verifyInitialSave } from '@open-northland/net-client';
import { type ServerMessage, TICK_MS } from '@open-northland/net-protocol';
import { serializeSaveGame } from '@open-northland/sim';
import { errorText } from '../../diag/error-text.js';
import {
  answeredWithin,
  currentDiagGameSession,
  diag,
  REPORT_ANSWER_TIMEOUT_MS,
  setDiagGameSession,
} from '../../diag/index.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { swapToEntry } from '../../launch.js';
import type { NetWorldPort, RelayedWorldHosting } from '../../net/connection.js';
import type { NetworkHandover } from '../../net/handover.js';
import { deliveredMatchEnd, relayedSessionDriver } from '../../net/net-worker-client.js';
import { networkSaveSession } from '../../net/save-session.js';
import { dismissBootProgress } from '../../view/boot-progress.js';
import { bindDisplayMode } from '../../view/fullscreen.js';
import { BUTTON_STYLE, el, mountMessage } from '../../view/overlay.js';
import { menuSearch } from '../../view/params.js';
import type { GameViewHandle } from '../../view/runtime/game-view.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import { type AssembledMapWorld, assembleMapWorld, presentMapWorld, type RestoredSave } from '../map/boot.js';
import { mountNetHud, type NetHud } from './net-hud.js';
import {
  hostRelayedWorld,
  type RelayedMapWorld,
  releaseRelayedWorld,
  type VerifiedStart,
} from './relayed-world.js';
import { roomExitObserver } from './room-exit.js';

/** Within the bundle's wait for the whole net report, so the digests' own bound lands first. */
const DIGESTS_ANSWER_TIMEOUT_MS = REPORT_ANSWER_TIMEOUT_MS / 2;

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
    delayMs: client.delayTicks === null ? null : (client.delayTicks * TICK_MS) / client.speed,
    clickToApplyMs: client.latency.clickToApplyMs,
    bufferedTicks: client.bufferedTicks,
  });

  function clearWorld(): void {
    // Pixi destroys the WebGL context permanently. A later renderer needs a new canvas,
    // including when the previous asynchronous assembly/presentation has not finished yet.
    if (canvasUsed) {
      const next = activeCanvas.cloneNode(false) as HTMLCanvasElement;
      activeCanvas.replaceWith(next);
      activeCanvas = next;
      canvasUsed = false;
    }
    hud?.dispose();
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
    unsubscribe();
    connection.dispose();
    clearWorld();
    dismissBootProgress();
  }
  function returnToMenu(): void {
    void swapToEntry(menuSearch(), dispose).catch((error: unknown) => fail(error));
  }
  function fail(error: unknown): void {
    if (closed) return;
    diag.warn('net', 'network game halted', { error: errorText(error) });
    dispose();
    const back = el('button', BUTTON_STYLE, messages().hud.returnToMenu);
    back.type = 'button';
    back.addEventListener('click', () => {
      void swapToEntry(menuSearch(), () => back.parentElement?.remove());
    });
    mountMessage(formatMessage(copy.bootFailed, { reason: errorText(error) }), '', [back]);
  }
  const exit = roomExitObserver((reason) => fail(reason ?? copy.roomEnded));
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'failure') {
      fail(event.error);
      return;
    }
    if (event.kind === 'link') {
      hud?.link(event.state, event.reason);
      return;
    }
    if (exit(event.message)) return;
    if (event.message.kind === 'desync') lastDesync = event.message;
    if (event.message.kind === 'kicked' && event.message.player === client.session?.localSeat) {
      fail(copy.youWereKicked);
      return;
    }
    hud?.observe(event.message);
  });

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
      net: async () => ({
        desync:
          lastDesync === null
            ? null
            : { tick: lastDesync.tick, domains: lastDesync.domains, reference: lastDesync.reference },
        // A stalled worker costs the report its digests, not the desync notice this thread holds.
        digests: (await answeredWithin(connection.digests(), DIGESTS_ANSWER_TIMEOUT_MS)) ?? [],
        delayTicks: client.delayTicks,
        roundTripMs: client.roundTripMs,
      }),
    });
  }

  const port: NetWorldPort = {
    async open(session, snapshotTick, host) {
      const mine = ++revision;
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
      await build(session, { header }, null, host, ++revision);
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
      onReturnToMenu: returnToMenu,
    })
      .then((presented) => {
        if (closed || mine !== revision) {
          presented.destroy();
          release(world);
          return;
        }
        view = presented;
        hud = mountNetHud({ client, view, readout });
        if (!connection.connected) hud.link('reconnecting');
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
