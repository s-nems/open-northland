import type { ContentSet, MapScript, TerrainMapFile } from '@open-northland/data';
import { type GameSession, localPlayerOf } from '@open-northland/lockstep';
import { type Entity, parseSaveGame, type SaveGame } from '@open-northland/sim';
import { buildingFootprints } from '../../content/ir/joins.js';
import type { ContentIr } from '../../content/ir/rows.js';
import { sessionWorldOptions } from '../../game/session-world.js';
import { mapScriptWorld } from '../../game/world/mission-script.js';
import type { HostedBuild } from '../../session/worker/serve.js';
import { saveDocumentOf } from '../../view/runtime/save-load/codec.js';
import { buildMapWorld, restoreMapWorld } from './world.js';

/**
 * What the `?map=` world is built from: the documents the boot loaded and the session. Plain
 * structured-cloneable data, so the worker that runs the sim builds the world from the same message
 * the main thread would have built it from.
 */
export interface MapWorldInputs {
  readonly map: TerrainMapFile | null;
  readonly ir: ContentIr | null;
  readonly script: MapScript | null;
  readonly goodNames: ReadonlyMap<string, string>;
  /** Real decoded content; null runs the sandbox catalog. */
  readonly content: ContentSet | null;
  readonly session: GameSession;
  /** `?missions=`, a local diagnostic a relayed world never reads; null keeps the map's default. */
  readonly missions: boolean | null;
  /** The staged save the world restores instead of building fresh. */
  readonly save: SaveGame | null;
}

/** The map placements the static layer joins to the sim's entities; empty on a restore, whose
 *  entities come out of the save. */
export interface MapWorldPlacements {
  readonly harvestablePlacements: readonly (readonly [Entity, number])[];
  /** The chest and ground-goods placements the sim draws from tick zero. */
  readonly pooledPlacements: readonly number[];
}

const NO_PLACEMENTS: MapWorldPlacements = { harvestablePlacements: [], pooledPlacements: [] };

/** Build or restore the world standing at a tick boundary; throws when a save does not fit it. */
export function buildMapWorldFromInputs(inputs: MapWorldInputs): HostedBuild<MapWorldPlacements> {
  const { map, ir, script, session, save } = inputs;
  // The render layers read the raw map; the sim runs on the collision resolution of the same map.
  const missionWorld = mapScriptWorld(script, ir);
  const worldOptions = {
    script: missionWorld,
    map,
    ir,
    playerRoster: script?.players ?? [],
    specialItems: script?.specialItems ?? [],
    content: {
      footprints: buildingFootprints(ir),
      goodNames: inputs.goodNames,
      ...(inputs.content !== null ? { content: inputs.content } : {}),
    },
    // Only the no-decodable-map fallback takes ownership from the session seat; a real map takes it
    // from map data.
    demoOwner: localPlayerOf(session),
  };
  if (save !== null) return { sim: restoreMapWorld(worldOptions, save).sim, extras: NO_PLACEMENTS };
  const world = buildMapWorld({
    ...worldOptions,
    ...sessionWorldOptions(session, script, missionWorld),
    seed: session.seed,
    missions: inputs.missions,
  });
  return {
    sim: world.sim,
    extras: { harvestablePlacements: world.harvestablePlacements, pooledPlacements: world.pooledPlacements },
  };
}

/**
 * The worker's boot message: the inputs with the staged save as the text it was staged as. The text
 * crosses as one string; the parsed save of the six-AI magiczny_las world at tick 40000 took about
 * 200 ms of this thread's time to post.
 */
export interface MapWorkerBoot extends Omit<MapWorldInputs, 'save'> {
  readonly saveText: string | null;
}

export function buildMapWorkerWorld(boot: MapWorkerBoot): HostedBuild<MapWorldPlacements> {
  const { saveText, ...inputs } = boot;
  const save = saveText === null ? null : parseSaveGame(saveDocumentOf(saveText));
  return buildMapWorldFromInputs({ ...inputs, save });
}
