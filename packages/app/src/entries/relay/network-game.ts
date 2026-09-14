import type { GameSession } from '@open-northland/lockstep';
import { decodeSnapshot, verifyInitialSave, type WorldPort } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, TICK_MS } from '@open-northland/net-protocol';
import type { SaveGame } from '@open-northland/sim';
import { errorText } from '../../diag/error-text.js';
import { diag } from '../../diag/index.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { swapToEntry } from '../../launch.js';
import type { NetworkHandover } from '../../net/handover.js';
import { networkSaveSession } from '../../net/save-session.js';
import { dismissBootProgress } from '../../view/boot-progress.js';
import { bindDisplayMode } from '../../view/fullscreen.js';
import { BUTTON_STYLE, el, mountMessage } from '../../view/overlay.js';
import { menuSearch } from '../../view/params.js';
import type { GameViewHandle } from '../../view/runtime/game-view.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import { type AssembledMapWorld, assembleMapWorld, presentMapWorld } from '../map/boot.js';
import { mountNetHud, type NetHud } from './net-hud.js';
import { roomExitObserver } from './room-exit.js';

export function renderNetworkGame(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  handover: NetworkHandover,
): void {
  const { connection, map, initialSave } = handover;
  const { client, socket } = connection;
  const copy = messages().net;
  const scope = new AbortController();
  bindDisplayMode(params, undefined, scope.signal);
  let activeCanvas = canvas;
  let canvasUsed = false;
  let closed = false;
  let revision = 0;
  let assembled: AssembledMapWorld | null = null;
  let view: GameViewHandle | null = null;
  let hud: NetHud | null = null;
  let transition: Promise<unknown> = Promise.resolve();
  let presentation: Promise<void> = Promise.resolve();
  let presentingWorld: AssembledMapWorld | null = null;
  const released = new WeakSet<AssembledMapWorld>();
  function release(world: AssembledMapWorld): void {
    if (released.has(world)) return;
    released.add(world);
    world.app.destroy(false, { children: true });
  }
  const readout = (): NetReadout => ({
    connected: socket.connected,
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
    if (event.message.kind === 'kicked' && event.message.player === client.session?.localSeat) {
      fail(copy.youWereKicked);
      return;
    }
    hud?.observe(event.message);
  });

  function build(session: GameSession, save: SaveGame | null, mine: number) {
    const previous = transition;
    const work = async () => {
      await previous.catch(() => undefined);
      await presentation.catch(() => undefined);
      if (closed || mine !== revision) return null;
      if (
        session.world.kind !== 'map' ||
        session.world.mapId !== map.mapId ||
        (save !== null && save.header.mapId !== map.mapId)
      )
        throw new Error('The session and verified map differ');
      clearWorld();
      canvasUsed = true;
      const world = await assembleMapWorld(activeCanvas, params, {
        multiplayer: true,
        mapId: map.mapId,
        stagedSave: save,
        verifiedMap: map,
        sessionFor: () => session,
      });
      if (closed || mine !== revision) {
        if (world !== null) release(world);
        return null;
      }
      if (world === null) throw new Error('The verified map could not be opened');
      if (world.loaded === null) {
        release(world);
        throw new Error('The verified map could not be opened');
      }
      assembled = world;
      return { sim: world.sim, generation: save === null ? DESCRIPTOR_WORLD : save.header.tick };
    };
    const result = work();
    transition = result;
    return result;
  }

  const port: WorldPort = {
    async open(session, snapshotTick) {
      const mine = ++revision;
      if (session.initialSave) {
        if (initialSave === null || (snapshotTick !== null && snapshotTick !== session.initialSave.tick)) {
          return null;
        }
        const save = await verifyInitialSave(initialSave.bytes, session.initialSave, map.mapId);
        const opened = await build(session, save, mine);
        return opened === null
          ? null
          : { ...opened, initialSaveFingerprint: initialSave.identity.fingerprint };
      }
      if (snapshotTick !== null) return null;
      return build(session, null, mine);
    },
    async restore(session, bytes) {
      const mine = ++revision;
      return build(session, await decodeSnapshot(bytes), mine);
    },
  };
  connection.bindWorld(port, () => {
    const world = assembled;
    const mine = revision;
    if (closed || world === null) return;
    presentingWorld = world;
    presentation = presentMapWorld(world, {
      driver: client,
      sharedClock: true,
      confirmedMatchEnd: () => client.endedTick,
      networkSave: networkSaveSession(client, world.sim),
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
        if (!socket.connected) hud.link('reconnecting');
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
