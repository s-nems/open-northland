import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ContentSet, MapScript } from '@open-northland/data';
import type { SessionRules, SessionSeat } from '@open-northland/lockstep';
import type { SaveGame, Simulation } from '@open-northland/sim';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorld, restoreMapWorld } from '../../src/entries/map/world.js';
import { matchParticipants, neverDiesSeats } from '../../src/game/match-participants.js';
import { sessionDiplomacy, sessionSharedVision } from '../../src/game/session-teams.js';
import { type AuthoredJoinRows, mapScriptWorld } from '../../src/game/world/index.js';
import { contentDir, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * The one headless build of a REAL decoded map - the `?map=<id>&ai=<seats>&fog=<mode>` world through the
 * entry's own {@link buildMapWorld}, so a scenario run and the browser boot cannot drift. Only the render
 * half is skipped, and `?speed=` with it - speed multiplies the RAF loop, not the sim.
 */

/** The seed the browser's map entry runs on (`WORLD_SEED` in `entries/map.ts`). */
const MAP_SEED = 7;

export interface RealMapWorldOptions {
  readonly seats?: readonly SessionSeat[];
  /** Decoded map id under `content/maps/<id>.json`. */
  readonly mapId: string;
  /** Seats to flag as AI players. */
  readonly aiSeats: readonly number[];
  /** Seats people play, on this client or another: the match participants and assistant grants a
   *  relayed session declares on every client alike. Omitted runs the observer's world. */
  readonly humanSeats?: readonly number[];
  /** Omitted runs on the browser entry's default seed. */
  readonly seed?: number;
  /** Seats the lobby left off the map, as the browser's `?absent=` does. */
  readonly absentSeats?: readonly number[];
  /** A session's rule overrides; omitted leaves the sim's defaults. */
  readonly rules?: SessionRules;
  /** Also spawn the map's berry bushes (the `?map=` entry does; a scenario that ignores food need not). */
  readonly berryBushes?: boolean;
  /** Optional headless override; map scripts run by default. */
  readonly missions?: boolean;
}

export interface RealMapWorld {
  readonly sim: Simulation;
  /** The merged content the sim runs on - what a caller passes back into the sim's content read views. */
  readonly content: ContentSet;
  /** The raw fetched-IR document, exactly what the browser flow hands these consumers - callers assert
   *  against real ids (building typeIds, good ids) through it rather than inlining decoded numbers. */
  readonly ir: ContentIr & AuthoredJoinRows;
  /** The map's size in visual CELLS, not the half-cell nodes `sim.terrain` is indexed in. */
  readonly mapCells: { readonly width: number; readonly height: number };
}

export function realMapPath(mapId: string): string {
  return resolve(contentDir(), `maps/${mapId}.json`);
}

/** The map's `.script.json` sidecar, absent for a map that ships none - the browser's `loadMapScript`
 *  twin, so the headless world seeds the same diplomacy rows the entry does. */
export function realMapScript(mapId: string): MapScript | null {
  const path = resolve(contentDir(), `maps/${mapId}.script.json`);
  if (!existsSync(path)) return null;
  return MapScript.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Build the world. Throws when the map is absent or resolves no authored placements - a run that
 *  silently started on an empty world would report a clean bill of health it never earned. */
export async function realMapWorld(options: RealMapWorldOptions): Promise<RealMapWorld> {
  const { merge } = await loadContentUnderTest();
  const mapPath = realMapPath(options.mapId);
  // Named explicitly: a mistyped map id otherwise surfaces as a bare ENOENT from inside vitest.
  if (!existsSync(mapPath)) throw new Error(`no decoded map at ${mapPath}`);
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const script = realMapScript(options.mapId);
  const ir = rawIrUnderTest() as ContentIr & AuthoredJoinRows;
  const humanSeats = options.humanSeats ?? [];
  const missionWorld = mapScriptWorld(script, ir);
  const world = buildMapWorld({
    seed: options.seed ?? MAP_SEED,
    map,
    ir,
    // Only `content` matters here: the real-content override replaces the sandbox build whole, so a
    // footprint overlay would be ignored (see resolveWorldContent).
    content: { content: merge.content },
    aiSeats: options.aiSeats,
    absentSeats: options.absentSeats ?? [],
    playerRoster: script?.players ?? [],
    script: missionWorld,
    missions: options.missions ?? null,
    // Each played seat's assistant and each AI seat's, so a headless run measures an economy that
    // dresses itself like the browser's.
    assistantSeats: [...humanSeats, ...options.aiSeats],
    diplomacy: sessionDiplomacy({ seats: options.seats ?? [] }, script?.diplomacy ?? []),
    sharedVision: sessionSharedVision({ seats: options.seats ?? [] }),
    specialItems: script?.specialItems ?? [],
    // The entry declares the match from the same three inputs. Left out, the headless world would run
    // without the match rules the browser plays under.
    matchParticipants:
      (missionWorld.victory === 'script' ? missionWorld.participants : undefined) ??
      matchParticipants({
        controlled: humanSeats,
        aiSeats: options.aiSeats,
        neverDies: script === null ? [] : neverDiesSeats(script),
      }),
    fog: options.rules?.fog ?? null,
    progression: options.rules?.progression ?? null,
    needs: options.rules?.needs ?? null,
    berryBushes: options.berryBushes === true,
  });
  if (world.kind !== 'authored') throw new Error(`${options.mapId} resolved no authored placements`);
  return { sim: world.sim, content: merge.content, ir, mapCells: { width: map.width, height: map.height } };
}

/** Restore a save onto the map it was taken on, through the entry's own restore: what a client does with
 *  a snapshot another client of the same session took. */
export async function restoreRealMapWorld(mapId: string, save: SaveGame): Promise<Simulation> {
  const { merge } = await loadContentUnderTest();
  const mapPath = realMapPath(mapId);
  if (!existsSync(mapPath)) throw new Error(`no decoded map at ${mapPath}`);
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const ir = rawIrUnderTest() as ContentIr & AuthoredJoinRows;
  return restoreMapWorld(
    {
      map,
      ir,
      content: { content: merge.content },
      script: mapScriptWorld(realMapScript(mapId), ir),
      playerRoster: realMapScript(mapId)?.players ?? [],
    },
    save,
  ).sim;
}
