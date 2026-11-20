import type { ContentSet, MapScript, TerrainMapFile } from '@open-northland/data';
import { assertMapModulesFitMap, type MapModulesContentNames, mapLobbySlots } from '@open-northland/data';
import { type GameSession, localPlayerOf, parseSavedSessionMetadata } from '@open-northland/lockstep';
import { DESCRIPTOR_WORLD } from '@open-northland/net-protocol';
import { type Entity, parseSaveGame, type SaveGame } from '@open-northland/sim';
import { buildingFootprints } from '../../content/ir/joins.js';
import type { ContentIr } from '../../content/ir/rows.js';
import { resolveAiControlPolicy } from '../../game/match/ai-control-policy.js';
import { sessionMapScript } from '../../game/match/seat-tribes.js';
import { assertMapSessionSeats } from '../../game/match/session-roster.js';
import { mapSession } from '../../game/match/session-url.js';
import { sessionWorldOptions } from '../../game/match/session-world.js';
import { servedOverLoopback } from '../../session/worker/loopback.js';
import type { RelayedBuild } from '../../session/worker/net-world-port.js';
import type { WorkerSessionOptions } from '../../session/worker/protocol.js';
import type { BuiltWorld, HostedBuild } from '../../session/worker/serve.js';
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
export function buildMapWorldFromInputs(inputs: MapWorldInputs): BuiltWorld<MapWorldPlacements> {
  const { ir, map, script, session, save } = inputs;
  if (script?.modules !== undefined && map !== null)
    assertMapModulesFitMap(script.modules, map, {
      seats: new Set(script.players.map((row) => row.player)),
      names: contentNamesOf(ir),
    });
  // The render layers read the raw map; the sim runs on the collision resolution of the same map.
  const seated = sessionMapScript(session, script, ir);
  const missionWorld = seated.world;
  const worldOptions = {
    script: missionWorld,
    map,
    ir,
    playerRoster: seated.script?.players ?? [],
    specialItems: script?.specialItems ?? [],
    content: {
      footprints: buildingFootprints(ir),
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
    seatTribes: seated.remap,
  });
  return {
    sim: world.sim,
    extras: { harvestablePlacements: world.harvestablePlacements, pooledPlacements: world.pooledPlacements },
  };
}

/** The slugs the IR names, by kind; null unless it carries every lane the map modules name. */
function contentNamesOf(ir: ContentIr | null): MapModulesContentNames | null {
  if (ir === null) return null;
  const { jobs, tribes, buildings, goods, vehicles } = ir;
  if (jobs === undefined || tribes === undefined || buildings === undefined) return null;
  if (goods === undefined || vehicles === undefined) return null;
  const slugs = (rows: readonly { readonly id?: string | undefined }[]) =>
    new Set(rows.flatMap((row) => (row.id === undefined ? [] : [row.id])));
  return {
    jobs: slugs(jobs),
    tribes: slugs(tribes),
    buildings: slugs(buildings),
    goods: slugs(goods),
    vehicles: slugs(vehicles),
  };
}

/** The inputs a host builds its world from, the save it restores from held on its own side. */
export type MapWorldDocuments = Omit<MapWorldInputs, 'save'>;

/**
 * The worker's boot message: the inputs with the staged save as the text it was staged as. The text
 * crosses as one string; the parsed save of the six-AI magiczny_las world at tick 40000 took about
 * 200 ms of this thread's time to post.
 */
export interface MapWorkerBoot extends MapWorldDocuments {
  readonly saveText: string | null;
}

/** The world a single-player session serves over the loopback transport. */
export function buildMapWorkerWorld(
  boot: MapWorkerBoot,
  options: WorkerSessionOptions,
): HostedBuild<MapWorldPlacements> {
  const { saveText, ...inputs } = boot;
  const save = saveText === null ? null : parseSaveGame(saveDocumentOf(saveText));
  return servedOverLoopback(buildMapWorldFromInputs({ ...inputs, save }), options);
}

/** A relayed session's world: restored from the snapshot the relay served, else from the boot's save
 *  or its descriptor. */
export function buildRelayedMapWorld(
  boot: MapWorkerBoot,
  snapshot: SaveGame | null,
): RelayedBuild<MapWorldPlacements> {
  assertMapSessionSeats(boot.session.seats, boot.script);
  const { saveText, ...inputs } = boot;
  const save = snapshot ?? (saveText === null ? null : parseSaveGame(saveDocumentOf(saveText)));
  const world = buildMapWorldFromInputs({ ...inputs, save });
  const previous =
    save === null
      ? null
      : (parseSavedSessionMetadata(save.header.session)?.descriptor ??
        mapSession(
          new URLSearchParams(save.header.entry ?? ''),
          inputs.script === null ? [] : mapLobbySlots(inputs.script),
        ));
  const seated = sessionMapScript(inputs.session, inputs.script, inputs.ir);
  const initialSeatSetups =
    previous === null
      ? []
      : inputs.session.seats.map((seat) => ({
          previousMode: previous.seats.find((row) => row.player === seat.player)?.mode ?? ('idle' as const),
          command: {
            kind: 'setAiControl' as const,
            player: seat.player,
            enabled: seat.mode === 'computer' || seat.mode === 'map-ai',
            ...resolveAiControlPolicy(
              seat.player,
              seated.script?.players ?? [],
              seated.world,
              seat.mode === 'computer' ? 'computer' : 'map-ai',
            ),
          },
        }));
  return { ...world, generation: save === null ? DESCRIPTOR_WORLD : save.header.tick, initialSeatSetups };
}
