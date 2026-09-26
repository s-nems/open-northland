import { isSpectator, localPlayerOf } from '@open-northland/lockstep';
import { hasDebugFlag } from '../diag/debug-flags.js';
import { diag, HASH_TRACE_DEBUG_FLAG } from '../diag/index.js';
import { mapIdParam, mapSession } from '../game/session-url.js';
import { endpointPort } from '../session/worker/port.js';
import { startWorkerSession, type WorkerSession } from '../session/worker/worker-session.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { introParam } from '../view/params.js';
import { type StagedSession, takeStagedSession } from '../view/runtime/save-load/index.js';
import { haltOnFailedRestore } from '../view/runtime/world-bootstrap.js';
import { DURABLE_EVENT_KINDS } from '../view/runtime/world-events.js';
import { assembleMapWorld, type HostedMapWorld, presentMapWorld } from './map/boot.js';
import { workerStallReports } from './map/stall-reports.js';
import type { MapWorkerBoot, MapWorldDocuments, MapWorldPlacements } from './map/world-inputs.js';

export { MAP_BOOT_PHASES } from './map/boot.js';

/** A world whose sim, driver and clock run in the session worker. */
interface WorkerMapWorld extends HostedMapWorld {
  readonly worker: WorkerSession<MapWorldPlacements>;
}

/** The decoded-map entry (`?map=<id>`): the search describes the session, which a worker runs as a
 *  single-player game over the loopback transport. */
export async function renderMap(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  // A sub-mission swaps this document's entry, so the binding ends with the world, not the document.
  const scope = new AbortController();
  bindDisplayMode(params, undefined, scope.signal);
  const mapId = mapIdParam(params);
  // Consumed before any other boot work: a staged save that fails from here on halts the boot rather
  // than silently starting a fresh world.
  let staged: StagedSession;
  try {
    staged = await takeStagedSession(mapId);
  } catch (err) {
    scope.abort();
    haltOnFailedRestore(err);
    return;
  }
  // Held outside the boot so a boot that fails after the worker stood up still ends it.
  const booted: { session: WorkerSession<MapWorldPlacements> | null } = { session: null };
  const stagedSave = staged.save;
  const hostWorld = async (inputs: MapWorldDocuments): Promise<WorkerMapWorld> => {
    const worker = new Worker(new URL('./map/sim-worker.ts', import.meta.url), { type: 'module' });
    const port = endpointPort(worker, () => worker.terminate());
    const session = await startWorkerSession<MapWorkerBoot, MapWorldPlacements>(
      port,
      { ...inputs, saveText: staged.text },
      {
        speed: inputs.session.speed,
        paused: stagedSave !== null && !staged.resume,
        // The overseer sees the whole map; a spectator's seat pick asks for its masks.
        fogSeat: isSpectator(inputs.session) ? null : localPlayerOf(inputs.session),
        diagnostics: hasDebugFlag(params, HASH_TRACE_DEBUG_FLAG),
        pauseOnSubMission: true,
        // A local session is its own clock, so a runtime that stops drawing stops it too.
        undelivered: 'hold',
        retainedEventKinds: DURABLE_EVENT_KINDS,
      },
      workerStallReports,
    );
    booted.session = session;
    diag.info('boot', 'sim worker ready', { ...session.boot });
    return {
      worker: session,
      host: session.host,
      placements: session.extras,
      matchRules: session.matchRules,
      seed: session.seed,
    };
  };
  const world = await assembleMapWorld(canvas, params, {
    hostWorld,
    mapId,
    stagedSave,
    sessionFor: (roster) => mapSession(params, roster),
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
    introAtStart: stagedSave === null && introParam(params),
  }).catch((err: unknown) => {
    worker.dispose();
    throw err;
  });
  view.lifetime.addEventListener(
    'abort',
    () => {
      worker.dispose();
      scope.abort();
    },
    { once: true },
  );
}
