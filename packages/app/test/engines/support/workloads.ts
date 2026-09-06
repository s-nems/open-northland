import { existsSync } from 'node:fs';
import type { Simulation } from '@open-northland/sim';
import { createSceneSim, getScene } from '../../../src/scenes/index.js';
import { hasRealIr, loadContentUnderTest } from '../../content/helpers.js';
import { realMapPath, realMapWorld } from '../../content/real-map-world.js';

/**
 * The worlds the cross-engine determinism check runs in every JavaScript engine, each paired with the
 * Node build of the same world. A browser boots through the entry the player uses, so a workload's
 * query and its `build` must produce the same sim state. Display names sit outside that state: the
 * browser localizes good names per its language and `hashState()` covers the world alone.
 */

export interface EngineWorkload {
  readonly id: string;
  /** The entry query the browser boots on, without the leading `?`. */
  readonly query: string;
  /** Absolute tick both sides run to. */
  readonly endTick: number;
  /** Ticks between compared hashes. A divergence names the first grid tick that differs. */
  readonly hashEvery: number;
  readonly build: () => Promise<Simulation>;
  /** False when the local content this workload needs is absent. */
  readonly available: () => boolean;
}

const SCENE_ID = 'sandbox';
const MAP_ID = 'magiczny_las';
/** Six AI seats on the map's seven-seat roster; seat 0 stays idle under `?player=observer`. */
const AI_SEATS = [1, 2, 3, 4, 5, 6];
const MAP_TICKS = 2000;
/**
 * `hashState()` walks every entity, and the map world holds about 37k of them, so its cadence is
 * coarser than the scene's: a run that hashed every 20 ticks would spend minutes per engine hashing.
 */
const MAP_HASH_EVERY = 100;
const SCENE_HASH_EVERY = 20;

/** No audio, and no fullscreen prompt to take the session's first gesture away from the probe. */
const COMMON_QUERY = 'sound=off&fullscreen=off';

function scene() {
  const found = getScene(SCENE_ID);
  if (found === undefined) throw new Error(`no registered scene '${SCENE_ID}'`);
  return found;
}

export const ENGINE_WORKLOADS: readonly EngineWorkload[] = [
  {
    id: SCENE_ID,
    query: `scene=${SCENE_ID}&${COMMON_QUERY}`,
    endTick: scene().runTicks,
    hashEvery: SCENE_HASH_EVERY,
    available: hasRealIr,
    build: async () => {
      const { merge } = await loadContentUnderTest();
      // The browser scene entry builds on served content; the headless scene tests' clean-room set
      // would be a different world.
      return createSceneSim(scene(), { content: merge.content });
    },
  },
  {
    id: MAP_ID,
    query: `map=${MAP_ID}&ai=${AI_SEATS.join(',')}&player=observer&${COMMON_QUERY}`,
    endTick: MAP_TICKS,
    hashEvery: MAP_HASH_EVERY,
    available: () => hasRealIr() && existsSync(realMapPath(MAP_ID)),
    build: async () => {
      // `berryBushes` and the observer seat mirror the entry: it spawns the map's bushes and, for an
      // observer, grants the assistant to the AI seats alone.
      const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: AI_SEATS, berryBushes: true });
      return sim;
    },
  },
];

/** A booted session has stepped at least once by the time it is paused, so tick 0 is never compared. */
const FIRST_COMPARABLE_TICK = 1;

/** The compared ticks: every `hashEvery`-th tick from `startTick` to the end, oldest first. */
export function hashGrid(startTick: number, workload: EngineWorkload): readonly number[] {
  const { hashEvery, endTick } = workload;
  const first = Math.ceil(Math.max(startTick, FIRST_COMPARABLE_TICK) / hashEvery) * hashEvery;
  const ticks: number[] = [];
  for (let t = first; t <= endTick; t += hashEvery) ticks.push(t);
  return ticks;
}
