import { IR_VERSION } from '@open-northland/data/ir-version';
import { type GameSession, isSpectator, localPlayerOf } from '@open-northland/lockstep';
import { CLIENT_BUILD, GAME_VERSION } from '../build-version.js';
import { scheduleFaultDrills } from '../diag/capture/drills.js';
import { hasDebugFlag } from '../diag/debug-flags.js';
import { diag, HASH_TRACE_DEBUG_FLAG } from '../diag/index.js';
import type { SessionRosterSlot } from '../game/match/session-url.js';
import { drawSessionSeed, mapIdParam, mapSession, seedParam } from '../game/match/session-url.js';
import { endpointPort } from '../session/worker/port.js';
import { startWorkerSession, type WorkerSession } from '../session/worker/worker-session.js';
import { formatSearch, introParam } from '../view/params.js';
import { bindDisplayMode } from '../view/platform/fullscreen.js';
import { replaceEntryUrl } from '../view/platform/navigation-guard.js';
import { type StagedSession, takeStagedSession } from '../view/runtime/save-load/index.js';
import { type ReplayDocument, replayRefusalOn, replaySessionOf } from '../view/runtime/save-load/replay.js';
import { haltOnFailedRestore } from '../view/runtime/world-bootstrap.js';
import { assembleMapWorld, type HostedMapWorld, presentMapWorld } from './map/boot.js';
import { workerReports } from './map/worker-reports.js';
import type { MapWorkerBoot, MapWorldDocuments, MapWorldPlacements } from './map/world-inputs.js';

export { MAP_BOOT_PHASES, RELAYED_MAP_BOOT_PHASES } from './map/boot.js';

/** A world whose sim, driver and clock run in the session worker. */
interface WorkerMapWorld extends HostedMapWorld {
  readonly worker: WorkerSession<MapWorldPlacements>;
}

/** The decoded-map entry (`?map=<id>`): the search describes the session, which a worker runs as a
 *  single-player game over the loopback transport. A boot that staged a replay instead plays the
 *  recording back, whose own descriptor, not the search, describes the session. */
export async function renderMap(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  // This boot's session start, which keys and names the replay its recording writes.
  const startedAt = Date.now();
  // A sub-mission swaps this document's entry, so the binding ends with the world, not the document.
  const scope = new AbortController();
  bindDisplayMode(params, undefined, scope.signal);
  const urlMapId = mapIdParam(params);
  // Consumed before any other boot work: a staged session that fails from here on halts the boot
  // rather than silently starting a fresh world.
  let staged: StagedSession;
  try {
    staged = await takeStagedSession(urlMapId);
  } catch (err) {
    scope.abort();
    haltOnFailedRestore(err);
    return;
  }
  const replayDocument = staged.replay?.document ?? null;
  if (replayDocument !== null) {
    const halt = (message: string): void => {
      scope.abort();
      haltOnFailedRestore(new Error(message));
    };
    if (replayDocument.descriptor.world.kind !== 'map') {
      halt('only a map session records a replay this boot can play');
      return;
    }
    // A build cannot reproduce a run its build or content moved under, so the recording refuses it
    // before the worker stands up; the message names the version that recorded it.
    const refusal = replayRefusalOn(replayDocument, {
      irVersion: IR_VERSION,
      clientBuild: CLIENT_BUILD,
      gameVersion: GAME_VERSION,
    });
    if (refusal !== null) {
      halt(
        `the replay was recorded on game version ${replayDocument.identity.gameVersion}, which this build cannot play`,
      );
      return;
    }
  }
  const replayWorldId =
    replayDocument !== null && replayDocument.descriptor.world.kind === 'map'
      ? replayDocument.descriptor.world.mapId
      : null;
  const mapId = replayWorldId ?? urlMapId;
  // A match named without a seed draws one into the address, so its link replays the match. A staged
  // replay's seed is the one its session was recorded with, never a fresh draw.
  if (replayDocument === null && seedParam(params) === null) {
    params.set('seed', String(drawSessionSeed()));
    replaceEntryUrl(formatSearch(params));
  }
  // Held outside the boot so a boot that fails after the worker stood up still ends it.
  const booted: { session: WorkerSession<MapWorldPlacements> | null } = { session: null };
  const stagedSave = staged.save;
  const replay = staged.replay;
  const hostWorld = async (inputs: MapWorldDocuments): Promise<WorkerMapWorld> => {
    const worker = new Worker(new URL('./map/sim-worker.ts', import.meta.url), { type: 'module' });
    const port = endpointPort(worker, () => worker.terminate());
    const session = await startWorkerSession<MapWorkerBoot, MapWorldPlacements>(
      port,
      { ...inputs, saveText: staged.text, replayText: replay?.text ?? null },
      {
        speed: inputs.session.speed,
        paused: replayDocument === null && stagedSave !== null && !staged.resume,
        // A spectator sees the whole map; its seat pick asks for its masks. A replayed session plays
        // back as one: its recording decides every command.
        fogSeat: isSpectator(inputs.session) ? null : localPlayerOf(inputs.session),
        diagnostics: hasDebugFlag(params, HASH_TRACE_DEBUG_FLAG),
        pauseOnSubMission: true,
      },
      workerReports('sim-worker'),
    );
    booted.session = session;
    diag.info('boot', 'sim worker ready', { ...session.boot });
    return {
      worker: session,
      host: session.host,
      placements: session.extras,
      matchRules: session.matchRules,
      seed: session.seed,
      workerLog: session.workerLog,
    };
  };
  const world = await assembleMapWorld(canvas, params, {
    hostWorld,
    mapId,
    stagedSave,
    sessionFor: (roster) => mapSessionOf(replayDocument, params, roster),
  }).catch((err: unknown) => {
    booted.session?.dispose();
    throw err;
  });
  if (world === null) {
    booted.session?.dispose();
    scope.abort();
    return;
  }
  const { worker } = world.hosted;
  const view = await presentMapWorld(world, {
    driver: worker.driver,
    offThreadTickCost: worker.offThreadTickCost,
    captureSaveFile: worker.captureSaveFile,
    // A playback keeps no replay of its own: the recording is the only command source it admits.
    ...(replay === null ? { captureReplayFile: worker.captureReplayFile } : {}),
    sessionStartedAt: startedAt,
    replayPlayback: replayDocument !== null,
    ...(replayDocument !== null ? { replayUntilTick: replayDocument.untilTick } : {}),
    introAtStart: replayDocument === null && stagedSave === null && introParam(params),
  }).catch((err: unknown) => {
    worker.dispose();
    throw err;
  });
  const end = (): void => {
    worker.dispose();
    scope.abort();
  };
  // The view may have ended while the intro or the boot's finish was awaited.
  if (view.lifetime.aborted) end();
  else {
    view.lifetime.addEventListener('abort', end, { once: true });
    // A release build drops the drills with this branch.
    if (import.meta.env.DEV) scheduleFaultDrills(params, worker.crashDrill, view.lifetime);
  }
}

/** The session a replayed boot plays on: the recording's world, watched as a spectator. */
function mapSessionOf(
  replayDocument: ReplayDocument | null,
  params: URLSearchParams,
  roster: readonly SessionRosterSlot[],
): GameSession {
  if (replayDocument !== null) return replaySessionOf(replayDocument.descriptor);
  return mapSession(params, roster);
}
