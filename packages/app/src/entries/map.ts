import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import type { SaveGame } from '@open-northland/sim';
import { mapIdParam, mapSession } from '../game/session-url.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { introParam } from '../view/params.js';
import { takeStagedSession } from '../view/runtime/save-load/index.js';
import { haltOnFailedRestore } from '../view/runtime/world-bootstrap.js';
import { assembleMapWorld, presentMapWorld } from './map/boot.js';

export { MAP_BOOT_PHASES } from './map/boot.js';

/** The decoded-map entry (`?map=<id>`): the search describes the session, and the loopback transport
 *  runs it as a single-player game. */
export async function renderMap(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  // A sub-mission swaps this document's entry, so the binding ends with the world, not the document.
  const scope = new AbortController();
  bindDisplayMode(params, undefined, scope.signal);
  const mapId = mapIdParam(params);
  // Consumed before any other boot work: a staged save that fails from here on halts the boot rather
  // than silently starting a fresh world.
  let stagedSave: SaveGame | null;
  let resume = false;
  try {
    const staged = await takeStagedSession(mapId);
    stagedSave = staged.save;
    resume = staged.resume;
  } catch (err) {
    scope.abort();
    haltOnFailedRestore(err);
    return;
  }
  const world = await assembleMapWorld(canvas, params, {
    mapId,
    stagedSave,
    sessionFor: (roster) => mapSession(params, roster),
  });
  if (world === null) {
    scope.abort();
    return;
  }
  const driver = new LockstepDriver({
    sim: world.sim,
    transport: new LoopbackTransport(),
    speed: world.session.speed,
    paused: stagedSave !== null && !resume,
  });
  const view = await presentMapWorld(world, {
    driver,
    introAtStart: stagedSave === null && introParam(params),
  });
  view.lifetime.addEventListener('abort', () => scope.abort(), { once: true });
}
