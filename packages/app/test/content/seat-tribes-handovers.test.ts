import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeMissionResult,
  isCivilizationTribe,
  MapScript,
  type MapScriptLine,
  mapLobbySlots,
  TerrainMapFile,
} from '@open-northland/data';
import { components, type SimEvent, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorldFromInputs } from '../../src/entries/map/world-inputs.js';
import { mapSession } from '../../src/game/session-url.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Every map whose script hands things between seats, played with the person's seat on another
 * civilization: once its spawn, id-stamping and handover lines have all run, the world build has
 * already moved everything that reached the seat, so the handover safety net never fires and no
 * settler of the seat's authored people (heroes aside) is left in it. Point `ON_CONTENT_DIR` at a
 * content set with the campaigns to cover them.
 */

const VIKING = 1;
const BYZANTINE = 3;
const SEED = 7;
/** The script loads on the first tick and runs its forced mission in that pass; one more settles it. */
const FORCED_TICKS = 2;
/** A large campaign map takes several seconds to build on a contended machine. */
const MAP_TIMEOUT_MS = 120_000;

const SPAWNS = new Set(['SetHuman', 'SetHumanX', 'SetVehicle', 'SetHouse']);
const STAMPS = new Set([
  'ChangeHumanObjectIdInArea',
  'ChangeMissionIdOfHumanInRange',
  'ChangeMissionIdOfPlayer',
  'ChangeMissionIdOfVehicles',
  'ChangeMissionIdOfVehiclesInRange',
  'ChangeMissionIdOfPlayersVehiclesOnContinent',
]);
const HANDOVERS = new Set([
  'ChangePlayerPlayerId',
  'ChangePlayerIdInArea',
  'ChangeHumanPlayerId',
  'ChangeHousesPlayerId',
  'ChangeVehiclesPlayerId',
]);

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function readScript(mapId: string): MapScript {
  return MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), `${mapId}.script.json`), 'utf8')));
}

function linesOf(script: MapScript, opcodes: ReadonlySet<string>): MapScriptLine[] {
  return script.missions.flatMap((mission) =>
    mission.results.filter((line) => opcodes.has(decodeMissionResult(line).opcode)),
  );
}

function handoverMaps(): string[] {
  if (!existsSync(mapsDir())) return [];
  return readdirSync(mapsDir())
    .filter((file) => file.endsWith('.script.json'))
    .map((file) => file.slice(0, -'.script.json'.length))
    .filter((mapId) => existsSync(resolve(mapsDir(), `${mapId}.json`)))
    .filter((mapId) => linesOf(readScript(mapId), HANDOVERS).length > 0)
    .sort();
}

/** The script with its own missions idle and one mission that runs every spawn, then every id stamp,
 *  then every handover, in authored order. */
function forcedScript(script: MapScript): MapScript {
  const forced = {
    debugName: 'forced handovers',
    other: [],
    active: true,
    goals: [{ key: 'goal', values: ['True'] }],
    results: [...linesOf(script, SPAWNS), ...linesOf(script, STAMPS), ...linesOf(script, HANDOVERS)],
  };
  return {
    ...script,
    missions: [...script.missions.map((mission) => ({ ...mission, active: false })), forced],
  };
}

describe.runIf(hasRealIr())('a seat played as another civilization through its handovers', () => {
  it.each(handoverMaps())(
    '%s moves everything handed to the seat at world build',
    async (mapId) => {
      const ir = rawIrUnderTest() as ContentIr;
      const { merge } = await loadContentUnderTest();
      const script = readScript(mapId);
      const slots = mapLobbySlots(script);
      const seat = slots.find((slot) => slot.claimable);
      if (seat === undefined || !isCivilizationTribe(seat.tribeId)) return;
      const chosen = seat.tribeId === BYZANTINE ? VIKING : BYZANTINE;
      const map = TerrainMapFile.parse(JSON.parse(readFileSync(resolve(mapsDir(), `${mapId}.json`), 'utf8')));
      const params = new URLSearchParams(
        `map=${mapId}&player=${seat.player}&tribes=${seat.player}:${chosen}&seed=${SEED}`,
      );
      const { sim } = buildMapWorldFromInputs({
        map,
        ir,
        script: forcedScript(script),
        content: merge.content,
        session: mapSession(params, slots),
        missions: true,
        save: null,
      });
      const corrected: SimEvent[] = [];
      for (let tick = 0; tick < FORCED_TICKS; tick++) {
        sim.run(1);
        corrected.push(...sim.events.current().filter((event) => event.kind === 'missionSeatTribeCorrected'));
      }
      expect(corrected).toEqual([]);

      const { Owner, Person, Settler } = components;
      const authoredLeft = [...sim.world.query(Person, Settler, Owner)].filter(
        (e) =>
          sim.world.get(e, Owner).player === seat.player &&
          sim.world.get(e, Settler).tribe === seat.tribeId &&
          !systems.isHeroJob(merge.content, sim.world.get(e, Settler).jobType),
      );
      expect(authoredLeft).toEqual([]);
    },
    MAP_TIMEOUT_MS,
  );
});
