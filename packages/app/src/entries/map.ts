import { isSpectator, localPlayerOf } from '@open-northland/lockstep';
import { scheduleFaultDrills } from '../diag/capture/drills.js';
import { hasDebugFlag } from '../diag/debug-flags.js';
import { diag, HASH_TRACE_DEBUG_FLAG } from '../diag/index.js';
import { MAP_VARIANT_PARAM, mapVariantParam, mapVariantsSelectable } from '../game/map/variant.js';
import { drawSessionSeed, mapIdParam, mapSession, seedParam } from '../game/match/session-url.js';
import { endpointPort } from '../session/worker/port.js';
import { startWorkerSession, type WorkerSession } from '../session/worker/worker-session.js';
import { formatSearch, introParam } from '../view/params.js';
import { bindDisplayMode } from '../view/platform/fullscreen.js';
import { replaceEntryUrl } from '../view/platform/navigation-guard.js';
import { type StagedSession, takeStagedSession } from '../view/runtime/save-load/index.js';
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
 *  single-player game over the loopback transport. */
export async function renderMap(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  // A sub-mission swaps this document's entry, so the binding ends with the world, not the document.
  const scope = new AbortController();
  bindDisplayMode(params, undefined, scope.signal);
  const mapId = mapIdParam(params);
  // A match named without a seed draws one into the address, so its link replays the match.
  if (seedParam(params) === null) {
    params.set('seed', String(drawSessionSeed()));
    replaceEntryUrl(formatSearch(params));
  }
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
  // A fresh launch chooses its variant, which only a dev server allows; a staged save keeps its own.
  if (stagedSave === null && !mapVariantsSelectable() && params.has(MAP_VARIANT_PARAM)) {
    params.delete(MAP_VARIANT_PARAM);
    replaceEntryUrl(formatSearch(params));
  }
  const hostWorld = async (inputs: MapWorldDocuments): Promise<WorkerMapWorld> => {
    const worker = new Worker(new URL('./map/sim-worker.ts', import.meta.url), { type: 'module' });
    const port = endpointPort(worker, () => worker.terminate());
    const session = await startWorkerSession<MapWorkerBoot, MapWorldPlacements>(
      port,
      { ...inputs, saveText: staged.text },
      {
        speed: inputs.session.speed,
        paused: stagedSave !== null && !staged.resume,
        // A spectator sees the whole map; its seat pick asks for its masks.
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
    variant: mapVariantParam(params, mapId),
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
    captureSaveFile: worker.captureSaveFile,
    introAtStart: stagedSave === null && introParam(params),
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
